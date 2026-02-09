import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { WeComCrypto } from './crypto.js';

const {
  WECOM_TOKEN,
  WECOM_ENCODING_AES_KEY,
  OPENCLAW_API,
  OPENCLAW_TOKEN,
  PORT = '8788',
} = process.env;

const botCrypto = new WeComCrypto(WECOM_TOKEN, WECOM_ENCODING_AES_KEY, '');

// ── Stream state management ──
// Map<streamId, { content: string, finished: boolean, responseUrl: string }>
const streams = new Map();

function cleanupStreams() {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 min
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

function extractUserText(msg) {
  if (msg.msgtype === 'text') {
    return msg.text?.content?.replace(/@\S+\s?/g, '').trim() || '';
  }
  if (msg.msgtype === 'voice') {
    return msg.voice?.content?.trim() || '';
  }
  if (msg.msgtype === 'mixed') {
    const parts = msg.mixed?.msg_item || [];
    return parts
      .filter(p => p.msgtype === 'text')
      .map(p => p.text?.content || '')
      .join(' ')
      .replace(/@\S+\s?/g, '')
      .trim();
  }
  return '';
}

// ── OpenClaw SSE streaming call ──

async function callOpenClawStream(text, sessionId, streamId) {
  const state = streams.get(streamId);
  if (!state) return;

  const headers = { 'Content-Type': 'application/json' };
  if (OPENCLAW_TOKEN) headers['Authorization'] = `Bearer ${OPENCLAW_TOKEN}`;

  console.log(`[OpenClaw →] session=${sessionId} text=${text.slice(0, 100)}`);

  try {
    const res = await fetch(OPENCLAW_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'openclaw', input: text, user: sessionId, stream: true }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[OpenClaw] HTTP ${res.status}: ${err.slice(0, 200)}`);
      state.content = '⚠️ 服务暂时不可用，请稍后再试';
      state.finished = true;
      return;
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          // OpenResponses streaming: response.output_text.delta / response.completed
          if (event.type === 'response.output_text.delta') {
            state.content += event.delta || '';
          } else if (event.type === 'response.completed') {
            // Extract final text from completed response
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

    // If stream ended without explicit completion
    if (!state.finished) {
      state.finished = true;
    }

    if (!state.content) {
      state.content = '(无回复)';
    }

    console.log(`[OpenClaw ←] stream=${streamId} len=${state.content.length} done`);
  } catch (err) {
    console.error(`[OpenClaw] error: ${err.message}`);
    state.content = '⚠️ 请求失败，请稍后再试';
    state.finished = true;
  }
}

// ── HTTP Server ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

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
      console.log('[Verify] OK');
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
          console.log(`[Stream] unknown id=${sid}, reply empty`);
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
            content: state.content || '思考中...',
          },
        };

        const encrypted = encryptReply(replyObj, nonce);
        console.log(`[Stream ↻] id=${sid} finish=${state.finished} len=${(state.content || '').length}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(encrypted);

        // Cleanup finished streams after final reply
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
        console.log(`[Event] ${msg.event?.eventtype} from=${from?.userid}`);
        res.writeHead(200);
        res.end('');
        return;
      }

      const text = extractUserText(msg);
      console.log(`[← ${source}] (${msgtype}) ${text.slice(0, 100)}`);

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

      // Reply with initial stream message (encrypted)
      const replyObj = {
        msgtype: 'stream',
        stream: {
          id: streamId,
          finish: false,
          content: '思考中...',
        },
      };

      const encrypted = encryptReply(replyObj, nonce);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(encrypted);

      console.log(`[Stream →] id=${streamId} started`);

      // Fire off OpenClaw request asynchronously
      callOpenClawStream(text, sessionId, streamId).catch(err => {
        console.error(`[OpenClaw] unhandled: ${err.message}`);
        const state = streams.get(streamId);
        if (state && !state.finished) {
          state.content = '⚠️ 内部错误';
          state.finished = true;
        }
      });

      cleanupStreams();
      return;
    }

    res.writeHead(405);
    res.end('method not allowed');
  } catch (err) {
    console.error('[Server] error:', err.message);
    res.writeHead(500);
    res.end('internal error');
  }
});

server.listen(Number(PORT), '127.0.0.1', () => {
  console.log(`wecom-bridge v1.0.0 listening on 127.0.0.1:${PORT}`);
  console.log(`  Mode:      智能机器人 (流式回复)`);
  console.log(`  Callback:  /callback`);
  console.log(`  OpenClaw:  ${OPENCLAW_API}`);
});

process.on('SIGINT', () => {
  console.log('\nshutting down...');
  server.close();
  process.exit(0);
});
