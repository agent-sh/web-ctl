# Changelog

## [Unreleased]

### Added
- `session verify` command to check if session is still authenticated before multi-step flows
- 12 action macros for common UI patterns: `select-option`, `tab-switch`, `modal-dismiss`, `form-fill`, `search-select`, `date-pick`, `file-upload`, `hover-reveal`, `scroll-to`, `wait-toast`, `iframe-action`, `login`
- `file-upload` macro enforces path allowlist (`/tmp`, cwd, `WEB_CTL_UPLOAD_DIR`) and blocks dotfile paths
- `login` macro supports `WEB_CTL_USER` / `WEB_CTL_PASS` environment variables as a safer alternative to CLI flags

### Fixed
- `getSnapshot` fallback string now includes the error message (e.g. `(accessibility tree unavailable - <reason>)`) instead of the opaque `(accessibility tree unavailable)`, making snapshot failures easier to diagnose (#22)
- Persist navigation state (`lastUrl`) between `run` commands so each invocation resumes at the last visited URL (#20)
- Use `body` selector instead of `:root` for cleaner ariaSnapshot output (#19)
- Log warning on ariaSnapshot failure instead of silently swallowing errors
- Security hardening across macro implementations: input validation, path traversal prevention, credential hygiene
- `date-pick` validates YYYY-MM-DD format and rejects out-of-range dates before opening the calendar
- `wait-toast` validates `--timeout` is a positive integer

## 1.0.0

- Initial release
- Browser automation via Playwright with persistent sessions
- Human-in-the-loop auth handoff with CAPTCHA detection
- Headless browsing: goto, snapshot, click, type, read, fill, wait, evaluate, screenshot, network, checkpoint
- Session encryption with AES-256-GCM
- Output sanitization and prompt injection defense
- WSL detection with Windows Chrome fallback
- Anti-bot measures (webdriver spoofing, random delays)
