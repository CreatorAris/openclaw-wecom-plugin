# OpenClaw WeCom Plugin

企业微信（WeCom）智能助手机器人桥接插件，让你的 OpenClaw AI 助手接入企业微信。

[![npm version](https://img.shields.io/npm/v/@creatoraris/openclaw-wecom.svg)](https://www.npmjs.com/package/@creatoraris/openclaw-wecom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ 特性

- ✅ 支持流式回复（分段发送，体验更流畅）
- ✅ 支持消息加密（符合企微安全规范）
- ✅ 支持单聊和群聊
- ✅ 自动消息去重
- ✅ 生产环境验证

## 📋 前置条件

- OpenClaw 已安装并运行
- Node.js >= 18.0.0
- 企业微信账号（个人也可注册企业版，1-9 人免费）
- 一台可部署 Webhook 服务的机器（或使用 ngrok 本地开发）

## 🚀 快速开始

### 总耗时：约 20 分钟

### 步骤 1：安装插件（2 分钟）

```bash
openclaw plugins install @creatoraris/openclaw-wecom
```

### 步骤 2：申请企微机器人（10 分钟）

#### 2.1 注册企业微信

如果还没有企业微信账号：

1. 访问 [企业微信官网](https://work.weixin.qq.com/)
2. 点击「注册企业」
3. 填写信息（可以用个人身份注册）
4. 验证手机号

#### 2.2 创建智能助手机器人

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/)
2. 左侧菜单：「应用管理」→「应用」
3. 找到「智能助手」，点击进入
4. 点击「创建智能助手」
5. 填写名称（如：OpenClaw AI 助手）
6. 点击「创建」

#### 2.3 配置回调

1. 在智能助手详情页，点击「接收消息」标签
2. 设置回调 URL：
   ```
   https://your-domain.com/wecom/callback
   ```
   > 💡 本地开发可以用 [ngrok](https://ngrok.com/)：`https://xxx.ngrok.io/wecom/callback`

3. 点击「生成 Token 和 EncodingAESKey」
4. **保存这三个值**（下一步要用）：
   - Token: `abc123...`
   - EncodingAESKey: `xyz789...`
   - Webhook URL: `https://your-domain.com/wecom/callback`

5. 点击「保存」

✅ 机器人申请完成！

### 步骤 3：配置 OpenClaw（5 分钟）

#### 3.1 编辑配置文件

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "webhookUrl": "https://your-domain.com/wecom/callback",
      "token": "你的 Token",
      "encodingAESKey": "你的 EncodingAESKey",
      "port": 8788
    }
  }
}
```

#### 3.2 配置环境变量

创建 `.env` 文件（或直接在启动脚本中设置）：

```bash
WECOM_TOKEN=你的Token
WECOM_ENCODING_AES_KEY=你的EncodingAESKey
OPENCLAW_API=http://localhost:18789/v1/chat/completions
OPENCLAW_TOKEN=你的OpenClaw_Gateway_Token
PORT=8788
```

#### 3.3 部署 Webhook 服务

**方式 A：使用 systemd（推荐）**

创建 `/etc/systemd/system/wecom-bridge.service`：

```ini
[Unit]
Description=OpenClaw WeCom Bridge
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/openclaw-wecom-plugin
EnvironmentFile=/path/to/.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable wecom-bridge
sudo systemctl start wecom-bridge
sudo systemctl status wecom-bridge
```

**方式 B：使用 PM2**

```bash
pm2 start index.js --name wecom-bridge
pm2 save
pm2 startup
```

**方式 C：本地开发（ngrok）**

```bash
# 终端 1：启动 webhook 服务
node index.js

# 终端 2：启动 ngrok
ngrok http 8788
# 复制 ngrok 生成的 https URL，配置到企微回调中
```

### 步骤 4：测试（1 分钟）

1. 在企业微信中找到你创建的机器人
2. 发送消息：`你好`
3. 应该会收到 AI 回复

🎉 恭喜！配置完成！

## 📖 配置说明

### 完整配置选项

```json
{
  "channels": {
    "wecom": {
      "enabled": true,              // 是否启用
      "webhookUrl": "https://...",  // 回调 URL（必填）
      "token": "...",               // Token（必填）
      "encodingAESKey": "...",      // EncodingAESKey（必填）
      "port": 8788,                 // 监听端口（可选，默认 8788）
      "streamDelay": 2000           // 流式回复延迟（毫秒，可选）
    }
  }
}
```

### OpenClaw Gateway 配置

确保 OpenClaw Gateway 配置了正确的认证：

```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "your-gateway-token"
    }
  }
}
```

## 🔧 故障排查

### 问题：消息发送后没有回复

**检查清单：**

1. Webhook 服务器是否正常运行？
   ```bash
   curl http://localhost:8788/health
   ```

2. 查看日志：
   ```bash
   # systemd
   sudo journalctl -u wecom-bridge -f
   
   # pm2
   pm2 logs wecom-bridge
   ```

3. 验证 OpenClaw Gateway 连接：
   ```bash
   curl http://localhost:18789/v1/status \
     -H "Authorization: Bearer your-token"
   ```

### 问题：消息乱码

检查 `encodingAESKey` 是否正确配置。

### 问题：回复速度慢

流式回复会分段发送。可以调整 `streamDelay` 参数：

```json
{
  "wecom": {
    "streamDelay": 1000  // 减小延迟（毫秒）
  }
}
```

### 问题：Webhook 服务启动失败

1. 检查端口是否被占用：
   ```bash
   lsof -i :8788
   ```

2. 检查环境变量是否正确：
   ```bash
   echo $WECOM_TOKEN
   echo $WECOM_ENCODING_AES_KEY
   ```

## 🏗️ 架构说明

```
企微客户端 → 企微服务器 → Webhook 服务器 → OpenClaw Gateway → AI 模型
                           ↓
                    加密/解密、去重、流式处理
```

### 消息流程

1. 用户在企微发送消息
2. 企微服务器加密后推送到 Webhook
3. Webhook 服务解密、验证、去重
4. 转发到 OpenClaw Gateway
5. AI 生成回复（流式）
6. Webhook 服务分段加密发送到企微
7. 用户收到 AI 回复

## 🔒 安全性

- ✅ 使用 AES-256-CBC 加密
- ✅ 消息签名验证
- ✅ 自动消息去重（防止重放攻击）
- ✅ 环境变量存储敏感信息

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 📄 License

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [OpenClaw](https://openclaw.ai) - 强大的 AI 助手框架
- [企业微信](https://work.weixin.qq.com/) - 提供企业级通讯平台

## 📞 支持

- 提交 Issue：[GitHub Issues](https://github.com/CreatorAris/openclaw-wecom-plugin/issues)
- 查看文档：[OpenClaw 文档](https://docs.openclaw.ai)

---

**注意：** 本项目为 beta 版本，欢迎反馈和建议！
