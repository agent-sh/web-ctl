# Changelog

## [Unreleased]

### Fixed

- Use `body` selector instead of `:root` for cleaner ariaSnapshot output (#19)
- Log warning on ariaSnapshot failure instead of silently swallowing errors

## 1.0.0

- Initial release
- Browser automation via Playwright with persistent sessions
- Human-in-the-loop auth handoff with CAPTCHA detection
- Headless browsing: goto, snapshot, click, type, read, fill, wait, evaluate, screenshot, network, checkpoint
- Session encryption with AES-256-GCM
- Output sanitization and prompt injection defense
- WSL detection with Windows Chrome fallback
- Anti-bot measures (webdriver spoofing, random delays)
