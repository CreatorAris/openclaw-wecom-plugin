# OpenClaw WeCom Plugin

企业微信（WeCom）智能助手机器人桥接插件，让你的 OpenClaw AI 助手接入企业微信。

[![npm version](https://img.shields.io/npm/v/@creatoraris/openclaw-wecom.svg)](https://www.npmjs.com/package/@creatoraris/openclaw-wecom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 特性

- 支持流式回复（分段发送，体验更流畅）
- 支持消息加密（符合企微安全规范）
- 支持单聊和群聊
- 支持图片消息（自动解密 WeCom 加密图片）
- 支持上下文重置（发送 `/reset` 或 `/重置`）
- 自动消息去重
- 作为 OpenClaw 插件运行，随 OpenClaw Gateway 自动启停

## 前置条件

- OpenClaw 已安装并运行
- Node.js >= 18.0.0
- 企业微信账号（个人也可注册企业版，1-9 人免费）
- 一台可部署 Webhook 服务的机器（或使用 ngrok / Tailscale 进行内网穿透）

## 快速开始

### 步骤 1：安装插件

```bash
openclaw plugins install @creatoraris/openclaw-wecom
```

### 步骤 2：创建企微智能助手机器人

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/)
2. 左侧菜单：「应用管理」 -> 「应用」
3. 找到「智能助手」，点击进入
4. 点击「创建智能助手」，填写名称（如：OpenClaw AI 助手）
5. 在智能助手详情页，点击「接收消息」标签
6. 设置回调 URL：`https://your-domain.com/callback`
7. 点击「生成 Token 和 EncodingAESKey」
8. 记录 Token 和 EncodingAESKey（下一步配置要用）
9. 点击「保存」

> 本地开发可以用 ngrok：`ngrok http 8788`，将生成的 URL 填入回调

### 步骤 3：配置插件

编辑 `~/.openclaw/openclaw.json`，在 `plugins.entries` 中添加：

```json
{
  "plugins": {
    "entries": {
      "openclaw-wecom": {
        "enabled": true,
        "config": {
          "token": "你的 Token",
          "encodingAESKey": "你的 EncodingAESKey",
          "corpId": "你的企业 ID",
          "port": 8788
        }
      }
    }
  }
}
```

企业 ID (corpId) 可在企业微信管理后台「我的企业」页面底部找到。

### 步骤 4：重启 OpenClaw

```bash
systemctl --user restart openclaw-gateway
```

### 步骤 5：测试

在企业微信中找到你创建的智能助手机器人，发送消息，应该会收到 AI 回复。

## 配置说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `token` | 是 | - | 企微回调 Token |
| `encodingAESKey` | 是 | - | 企微回调 EncodingAESKey |
| `corpId` | 否 | `""` | 企业 ID，图片功能需要 |
| `corpSecret` | 否 | `""` | 应用 Secret（智能助手机器人通常不需要） |
| `port` | 否 | `8788` | 本地监听端口 |

## 内置命令

在企微聊天窗口中发送以下命令：

| 命令 | 说明 |
|------|------|
| `/reset` | 重置当前对话上下文 |
| `/重置` | 同上（中文别名） |

上下文被污染或需要开始新话题时，发送重置命令即可清除历史对话。

## 架构说明

```
企微客户端 -> 企微服务器 -> 本插件 (HTTP Server) -> OpenClaw Gateway -> AI 模型
                              |
                       加密/解密、去重、流式处理、图片解密
```

本插件作为 OpenClaw 的内置服务运行，随 OpenClaw Gateway 自动启停，无需单独部署。

## 安全性

- 使用 AES-256-CBC 加密通信
- 消息签名验证
- 自动消息去重（防止重放攻击）
- 敏感信息通过 OpenClaw 配置文件管理，不使用环境变量

## 故障排查

查看日志：

```bash
journalctl --user -u openclaw-gateway -f
```

常见问题：

- **端口被占用**：检查 `lsof -i :8788`，修改配置中的 port 或停止冲突进程
- **消息无回复**：确认 OpenClaw Gateway 正常运行，检查日志中的错误信息
- **回调验证失败**：确认 token 和 encodingAESKey 与企微后台一致

## License

MIT License - 详见 [LICENSE](LICENSE) 文件
