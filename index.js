import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { WeComCrypto } from './crypto.js';

const plugin = {
  register(api) {
    const cfg = api.pluginConfig || {};
    const token = cfg.token || process.env.WECOM_TOKEN;
    const encodingAESKey = cfg.encodingAESKey || process.env.WECOM_ENCODING_AES_KEY;
    const corpId = cfg.corpId || process.env.WECOM_CORP_ID || '';
    const port = Number(cfg.port || process.env.PORT || 8788);

    if (!token || !encodingAESKey) {
      api.logger.warn('wecom: missing token or encodingAESKey, plugin disabled');
      return;
    }

    // Derive OpenClaw gateway URL from config
    const gwCfg = api.config?.gateway || {};
    const gwPort = gwCfg.port || 18789;
    const gwToken = gwCfg.auth?.token || process.env.OPENCLAW_TOKEN;
    const openclawApi = `http://127.0.0.1:${gwPort}/v1/responses`;

    const botCrypto = new WeComCrypto(token, encodingAESKey, corpId);
    const log = api.logger;

    // ── Stream state management ──
    const streams = new Map();

    function cleanupStreams() {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [k, v] of streams) {
        if (v.createdAt < cutoff) streams.delete(k);
      }
    }

    // ── Dedup ──
    const processedMsgIds = new Map();
    function isDuplicate(msgid) {
      if (!msgid) return false;
      if (processedMsgIds.has(msgid)) return true;
      processedMsgIds.set(msgid, Date.now());
      if (processedMsgIds.size > 1000) {
        const cutoff = Date.now() - 600000;
        for (const [k, v] of processedMsgIds) {
          if (v < cutoff) processedMsgIds.delete(k);
        }
      }
      return false;
    }

    // ── Helpers ──

    function readBody(req) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    }

    function makeStreamId() {
      return crypto.randomBytes(12).toString('hex');
    }

    function encryptReply(jsonObj, nonce) {
      const plaintext = JSON.stringify(jsonObj);
      const encrypted = botCrypto.encrypt(plaintext);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const msgsignature = botCrypto.sign(timestamp, nonce, encrypted);
      return JSON.stringify({ encrypt: encrypted, msgsignature, timestamp: Number(timestamp), nonce });
    }

    function extractUserText(msg, isGroup = false) {
      const cleanMention = (text) => isGroup ? text.replace(/@[^\s@]+\s*/g, '').trim() : text.trim();

      if (msg.msgtype === 'text') return cleanMention(msg.text?.content || '');
      if (msg.msgtype === 'voice') return msg.voice?.content?.trim() || '';
      if (msg.msgtype === 'mixed') {
        const parts = msg.mixed?.msg_item || [];
        const text = parts.filter(p => p.msgtype === 'text').map(p => p.text?.content || '').join(' ');
        return cleanMention(text);
      }
      if (msg.msgtype === 'image') return '[图片消息] 暂不支持图片回复';
      return '';
    }

    // ── OpenClaw SSE streaming call ──

    async function callOpenClawStream(text, sessionId, streamId) {
      const state = streams.get(streamId);
      if (!state) return;

      const headers = { 'Content-Type': 'application/json' };
      if (gwToken) headers['Authorization'] = `Bearer ${gwToken}`;

      log.info(`[OpenClaw ->] session=${sessionId} text=${text.slice(0, 100)}`);

      try {
        const res = await fetch(openclawApi, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: 'openclaw', input: text, user: sessionId, stream: true }),
        });

        if (!res.ok) {
          const err = await res.text();
          log.error(`[OpenClaw] HTTP ${res.status}: ${err.slice(0, 200)}`);
          state.content = '\u26a0\ufe0f \u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
          state.finished = true;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'response.output_text.delta') {
                state.content += event.delta || '';
              } else if (event.type === 'response.completed') {
                const output = event.response?.output;
                if (output && Array.isArray(output)) {
                  const texts = [];
                  for (const item of output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                      for (const part of item.content) {
                        if (part.type === 'output_text' && part.text) texts.push(part.text);
                      }
                    }
                  }
                  const fullText = texts.join('\n').trim();
                  if (fullText) state.content = fullText;
                }
                state.finished = true;
              }
            } catch {}
          }
        }

        if (!state.finished) state.finished = true;
        if (!state.content) state.content = '(\u65e0\u56de\u590d)';

        log.info(`[OpenClaw <-] stream=${streamId} len=${state.content.length} done`);
      } catch (err) {
        log.error(`[OpenClaw] error: ${err.message}`);
        state.content = '\u26a0\ufe0f \u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5';
        state.finished = true;
      }
    }

    // ── HTTP Server (managed as OpenClaw service) ──

    let server;

    const requestHandler = async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const msgSignature = url.searchParams.get('msg_signature');
      const timestamp = url.searchParams.get('timestamp');
      const nonce = url.searchParams.get('nonce');

      try {
        // GET: URL verification
        if (req.method === 'GET') {
          const echostr = url.searchParams.get('echostr');
          if (!botCrypto.verifySignature(msgSignature, timestamp, nonce, echostr)) {
            res.writeHead(403);
            res.end('signature mismatch');
            return;
          }
          const { message } = botCrypto.decrypt(echostr);
          log.info('[Verify] OK');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(message);
          return;
        }

        // POST: message callback
        if (req.method === 'POST') {
          const body = await readBody(req);
          const trimmed = body.trim();

          let encrypt;
          if (trimmed.startsWith('{')) {
            try { encrypt = JSON.parse(trimmed).encrypt; } catch {}
          }
          if (!encrypt) {
            res.writeHead(400);
            res.end('bad request');
            return;
          }

          if (!botCrypto.verifySignature(msgSignature, timestamp, nonce, encrypt)) {
            res.writeHead(403);
            res.end('signature mismatch');
            return;
          }

          const { message: decrypted } = botCrypto.decrypt(encrypt);
          const msg = JSON.parse(decrypted);

          const { msgid, chatid, chattype, from, response_url, msgtype } = msg;
          const source = chattype === 'group' ? `group:${chatid}` : `user:${from?.userid}`;

          // ── Stream refresh callback ──
          if (msgtype === 'stream') {
            const sid = msg.stream?.id;
            const state = streams.get(sid);

            if (!state) {
              log.debug(`[Stream] unknown id=${sid}, reply empty`);
              res.writeHead(200);
              res.end('');
              return;
            }

            if (isDuplicate(msgid)) {
              res.writeHead(200);
              res.end('');
              return;
            }

            const replyObj = {
              msgtype: 'stream',
              stream: {
                id: sid,
                finish: state.finished,
                content: state.content || '\u601d\u8003\u4e2d...',
              },
            };

            const encrypted = encryptReply(replyObj, nonce);
            log.debug(`[Stream ~] id=${sid} finish=${state.finished} len=${(state.content || '').length}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(encrypted);

            if (state.finished) {
              setTimeout(() => streams.delete(sid), 30000);
            }
            return;
          }

          // ── User message callback ──
          if (isDuplicate(msgid)) {
            res.writeHead(200);
            res.end('');
            return;
          }

          // Handle enter_chat event
          if (msgtype === 'event') {
            log.debug(`[Event] ${msg.event?.eventtype} from=${from?.userid}`);
            res.writeHead(200);
            res.end('');
            return;
          }

          const isGroup = chattype === 'group';
          const text = extractUserText(msg, isGroup);
          log.info(`[<- ${source}] (${msgtype}) ${text.slice(0, 100)}`);

          if (!text) {
            res.writeHead(200);
            res.end('');
            return;
          }

          // Create stream state and start OpenClaw request
          const streamId = makeStreamId();
          const sessionId = chattype === 'group' ? `wecom_group_${chatid}` : `wecom_bot_${from?.userid}`;

          streams.set(streamId, {
            content: '',
            finished: false,
            responseUrl: response_url,
            createdAt: Date.now(),
          });

          const replyObj = {
            msgtype: 'stream',
            stream: {
              id: streamId,
              finish: false,
              content: '\u601d\u8003\u4e2d...',
            },
          };

          const encrypted = encryptReply(replyObj, nonce);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(encrypted);

          log.info(`[Stream ->] id=${streamId} started`);

          callOpenClawStream(text, sessionId, streamId).catch(err => {
            log.error(`[OpenClaw] unhandled: ${err.message}`);
            const state = streams.get(streamId);
            if (state && !state.finished) {
              state.content = '\u26a0\ufe0f \u5185\u90e8\u9519\u8bef';
              state.finished = true;
            }
          });

          cleanupStreams();
          return;
        }

        res.writeHead(405);
        res.end('method not allowed');
      } catch (err) {
        log.error(`[Server] error: ${err.message}`);
        res.writeHead(500);
        res.end('internal error');
      }
    };

    api.registerService({
      id: 'wecom-server',
      async start() {
        server = http.createServer(requestHandler);

        return new Promise((resolve) => {
          server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              log.error(`Port ${port} already in use. Change port in plugins.entries.wecom.config.port or stop the conflicting process.`);
            } else {
              log.error(`Server error: ${err.message}`);
            }
            // Resolve instead of reject — don't crash OpenClaw
            resolve();
          });

          server.listen(port, '127.0.0.1', () => {
            log.info(`wecom-bridge listening on 127.0.0.1:${port}`);
            log.info(`  Callback: /callback`);
            log.info(`  OpenClaw: ${openclawApi}`);
            resolve();
          });
        });
      },

      async stop() {
        if (server) {
          return new Promise((resolve) => server.close(resolve));
        }
      },
    });
  },
};

export default plugin;
