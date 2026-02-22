# Changelog

## [Unreleased]

- Add `session verify` command to check if session is still authenticated
- Support `--provider` flag for verify command to use pre-configured success detection
- Return structured JSON responses for session verification (authenticated status, error codes, expiry detection)

## 1.0.0

- Initial release
- Browser automation via Playwright with persistent sessions
- Human-in-the-loop auth handoff with CAPTCHA detection
- Headless browsing: goto, snapshot, click, type, read, fill, wait, evaluate, screenshot, network, checkpoint
- Session encryption with AES-256-GCM
- Output sanitization and prompt injection defense
- WSL detection with Windows Chrome fallback
- Anti-bot measures (webdriver spoofing, random delays)
