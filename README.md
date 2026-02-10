# OpenClaw WeCom Plugin

[中文文档](README_ZH.md)

Enterprise WeChat (WeCom) channel plugin for [OpenClaw](https://openclaw.ai). Connect your OpenClaw AI assistant to WeCom.

[![npm version](https://img.shields.io/npm/v/@creatoraris/openclaw-wecom.svg)](https://www.npmjs.com/package/@creatoraris/openclaw-wecom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Streaming replies (chunked delivery for a smoother experience)
- AES-256-CBC message encryption (WeCom security compliance)
- Private chat and group chat
- Image message support (auto-decrypt WeCom encrypted images)
- Context reset (`/reset`)
- Auto message deduplication
- Runs as an OpenClaw plugin, auto start/stop with Gateway

## Prerequisites

- OpenClaw installed and running
- Node.js >= 18.0.0
- A WeCom (Enterprise WeChat) account (individuals can register for free, 1–9 users)
- A machine with a public webhook endpoint (or use ngrok / Tailscale for tunneling)

## Quick Start

### Step 1: Install Plugin

```bash
openclaw plugins install @creatoraris/openclaw-wecom
```

### Step 2: Create a WeCom Intelligent Bot

1. Log in to [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/)
2. Navigate to "App Management" -> "Apps"
3. Find "Intelligent Assistant", click to enter
4. Click "Create Intelligent Assistant", fill in a name (e.g. "OpenClaw AI Assistant")
5. In the assistant detail page, click the "Receive Messages" tab
6. Set Callback URL: `https://your-domain.com/callback`
7. Click "Generate Token and EncodingAESKey"
8. Save the Token and EncodingAESKey (needed for configuration)
9. Click "Save"

> For local development, use ngrok: `ngrok http 8788`, then paste the generated URL as the callback

### Step 3: Configure

Edit `~/.openclaw/openclaw.json`, add to `plugins.entries`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-wecom": {
        "enabled": true,
        "config": {
          "token": "your_token",
          "encodingAESKey": "your_encoding_aes_key",
          "corpId": "your_corp_id",
          "port": 8788
        }
      }
    }
  }
}
```

Corp ID can be found at the bottom of the "My Enterprise" page in WeCom Admin Console.

### Step 4: Restart OpenClaw

```bash
systemctl --user restart openclaw-gateway
```

### Step 5: Test

Find the bot in WeCom and send a message. You should receive an AI reply.

## Configuration

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `token` | Yes | - | WeCom callback Token |
| `encodingAESKey` | Yes | - | WeCom callback EncodingAESKey |
| `corpId` | No | `""` | Corp ID (required for image download) |
| `corpSecret` | No | `""` | App Secret (usually not needed for Intelligent Bots) |
| `port` | No | `8788` | Local HTTP listen port |

## Commands

| Command | Description |
|---------|-------------|
| `/reset` | Reset conversation context |

## Architecture

```
WeCom Client -> WeCom Server -> Plugin (HTTP Server) -> OpenClaw Gateway -> AI Model
                                    |
                            Encrypt/Decrypt, Dedup, Streaming, Image Decryption
```

## Security

- AES-256-CBC encrypted communication
- Message signature verification
- Auto message deduplication (replay attack prevention)
- Sensitive config managed via OpenClaw config file, no environment variables

## Troubleshooting

View logs:

```bash
journalctl --user -u openclaw-gateway -f
```

Common issues:

- **Port in use**: Check `lsof -i :8788`, change port in config or stop the conflicting process
- **No reply**: Verify OpenClaw Gateway is running, check logs for errors
- **Callback verification failed**: Ensure token and encodingAESKey match the WeCom console

## License

MIT
