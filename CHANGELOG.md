# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] - 2026-02-10

### Changed
- Removed Chinese subtitle from package description

## [0.4.2] - 2026-02-10

### Fixed
- Synced plugin manifest version with package.json
- Corrected author email

## [0.4.1] - 2026-02-09

### Fixed
- Lowercase session key to match OpenClaw internal normalization

## [0.4.0] - 2026-02-09

### Added
- Context reset command (`/reset`, `/重置`)
- Updated README with usage docs

## [0.3.0] - 2026-02-09

### Fixed
- Decrypt WeCom encrypted image data with encodingAESKey

## [0.2.0] - 2026-02-09

### Added
- Image message support (media API download + encrypted image decryption)
- Mixed message handling (text + image)
- Local image cache with automatic cleanup

## [0.1.0] - 2026-02-09

### Added
- Initial release
- Streaming replies via WeCom stream protocol
- AES-256-CBC message encryption/decryption
- Message signature verification
- Auto message deduplication
- Private chat and group chat
- Text and voice message support
- OpenClaw plugin lifecycle management
