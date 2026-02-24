# Changelog

## [Unreleased]

### Added
- `--snapshot-max-lines <N>` flag to truncate snapshot output to a maximum number of lines, with a `... (K more lines)` marker when lines are omitted
- `--snapshot-collapse` flag to collapse repeated consecutive siblings of the same ARIA type - keeps first 2 with subtrees, replaces the rest with `... (K more <type>)` markers. Works recursively on nested structures
- `--snapshot-text-only` flag to strip structural container nodes (list, listitem, group, region, main, form, table, row, grid, generic, etc.) and keep only content-bearing nodes. Labeled structural nodes are preserved. Indentation is re-compressed
- `extract` macro for structured data extraction from repeated list items with two modes: selector mode (`--selector <sel> --fields f1,f2,...`) for targeted extraction and auto-detect mode (`--auto`) that finds repeated patterns automatically using structural signature matching. Auto-detect is table-aware - when a table with `<th>` headers is detected, returns per-column data (e.g., `{ Service: "Runtime", Description: "..." }`) instead of a single concatenated `text` field
- Auto-create sessions on first `run` command - sessions are created automatically if they don't exist, eliminating the need for explicit `session start` before browsing. Response includes `autoCreated: true` flag when a session was auto-created.
- `next-page` macro to auto-detect and follow pagination links using multiple heuristics (rel="next", ARIA roles, CSS patterns, page numbers)
- `paginate` macro to collect items across paginated pages with `--selector`, `--max-pages` (default 5, max 20), and `--max-items` (default 100, max 500) options
- `--snapshot-depth N` flag to limit ARIA tree depth in snapshot output, replacing deep subtrees with `- ...` truncation markers
- `--snapshot-selector <sel>` flag to scope snapshots to a DOM subtree instead of the full page body
- `--no-snapshot` flag to omit snapshot from action responses entirely, saving tokens when only the side-effect matters
- `session verify` command to check if session is still authenticated before multi-step flows
- 15 action macros for common UI patterns: `select-option`, `tab-switch`, `modal-dismiss`, `form-fill`, `search-select`, `date-pick`, `file-upload`, `hover-reveal`, `scroll-to`, `wait-toast`, `iframe-action`, `login`, `next-page`, `paginate`, `extract`
- `file-upload` macro enforces path allowlist (`/tmp`, cwd, `WEB_CTL_UPLOAD_DIR`) and blocks dotfile paths
- `login` macro supports `WEB_CTL_USER` / `WEB_CTL_PASS` environment variables as a safer alternative to CLI flags
- Post-auth headless verification automatically tests target service accessibility after successful authentication, returning optional `headlessVerification` object in auth response
- `--verify-url` and `--verify-selector` flags for `session auth` to configure post-auth verification on a per-invocation basis
- `verifyUrl` and `verifySelector` provider fields for built-in providers (github, gitlab, microsoft) to automatically verify API/dashboard access after login
- `--min-wait <seconds>` flag for `session auth` to configure grace period before auth success polling starts (default: 5 seconds, clamped to 0-300)
- `--max-field-length <N>` flag for `extract` macro to configure maximum characters per extracted field (default: 500, max: 2000)

### Fixed
- `extract` auto-detect `buildSelector` no longer produces double ` > > ` combinators in CSS selectors (#52)
- `extract` auto-detect `buildSelector` skips auto-generated IDs (numeric, hex strings, framework prefixes like `ext-`, `ember`, `ng-`, patterns with `:` or `.`) and anchors on stable human-readable IDs instead, making detected selectors reusable across page reloads (#52)
- Auth success detection no longer triggers false positives when the login page URL matches the successUrl pattern (e.g. Instagram, Reddit, Facebook whose login pages are sub-paths of the site root) (#40)
- Boolean flags (`--allow-evaluate`, `--no-snapshot`, `--wait-stable`, `--vnc`, `--exact`, `--accept`, `--submit`, `--dismiss`) no longer consume the next positional argument as their value (#27)
- `getSnapshot` fallback string now includes the error message (e.g. `(accessibility tree unavailable - <reason>)`) instead of the opaque `(accessibility tree unavailable)`, making snapshot failures easier to diagnose (#22)
- Persist navigation state (`lastUrl`) between `run` commands so each invocation resumes at the last visited URL (#20)
- Use `body` selector instead of `:root` for cleaner ariaSnapshot output (#19)
- Log warning on ariaSnapshot failure instead of silently swallowing errors
- Security hardening across macro implementations: input validation, path traversal prevention, credential hygiene
- `date-pick` validates YYYY-MM-DD format and rejects out-of-range dates before opening the calendar
- `wait-toast` validates `--timeout` is a positive integer
- URL credential redaction regex no longer false-positives on port numbers (e.g., `host:443/path`) or multi-line content with `@` characters (#30)

## 1.0.0

- Initial release
- Browser automation via Playwright with persistent sessions
- Human-in-the-loop auth handoff with CAPTCHA detection
- Headless browsing: goto, snapshot, click, type, read, fill, wait, evaluate, screenshot, network, checkpoint
- Session encryption with AES-256-GCM
- Output sanitization and prompt injection defense
- WSL detection with Windows Chrome fallback
- Anti-bot measures (webdriver spoofing, random delays)
