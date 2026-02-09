# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-beta] - 2026-02-09

### Added
- 🎉 Initial release
- ✅ 企业微信智能助手机器人桥接
- ✅ 支持流式回复（分段发送）
- ✅ 支持消息加密解密（AES-256-CBC）
- ✅ 支持消息签名验证
- ✅ 自动消息去重
- ✅ 支持单聊和群聊
- ✅ 支持文本、语音、混合消息

### Features
- Stream state management with automatic cleanup
- Message deduplication (防止重复处理)
- Encrypted message handling (符合企微安全规范)
- OpenClaw Gateway integration via SSE

### Known Issues
- Beta 版本，可能存在未发现的 bug
- 暂不支持图片消息
- 流式回复延迟可能需要根据实际情况调整

### Roadmap
- [ ] 支持图片消息
- [ ] 支持文件消息
- [ ] 优化流式回复性能
- [ ] 添加单元测试
- [ ] 添加更多配置选项
