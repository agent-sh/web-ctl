# web-ctl

Browser automation for AI agents - navigate, authenticate, and interact with web pages.

## Overview

web-ctl gives agents persistent, session-based browser control through a single CLI. Agents navigate pages, fill forms, click buttons, and read content - all headlessly. When login or CAPTCHAs are needed, the browser opens for the human, then goes back to headless.

## Architecture

```
/web-ctl
    │
    ├─→ /web-ctl:web-browse  → Headless actions (goto, click, type, read, snapshot)
    └─→ /web-ctl:web-auth    → Human-in-the-loop auth (headed browser, polls for success)
```

```
Agent
 └─ Skill("web-ctl", "run github click 'role=button[name=Post]'")
      └─ SKILL.md executes: node scripts/web-ctl.js run github click "..."
           └─ web-ctl.js:
                1. Loads session from state dir
                2. Opens Playwright launchPersistentContext(userDataDir)
                3. Executes action
                4. Closes context (cookies flush to disk)
                5. Returns JSON result to agent
```

Each invocation is a single Node.js process. No daemon, no MCP server, no IPC. Session state persists via Chrome's userDataDir with AES-256-GCM encrypted storage.

## Installation

```bash
# Claude Code
agentsys install web-ctl

# Peer dependency
npm install playwright
npx playwright install chromium
```

## Commands

### `/web-ctl`

Describe what you want to do; the web-session agent orchestrates multi-step browsing.

```
/web-ctl                    # Agent-driven browsing session
/web-ctl goto <url>         # Navigate directly
/web-ctl auth <name>        # Authenticate to a site
```

### `/web-ctl:web-auth`

Human-in-the-loop authentication. Opens a headed browser for the user to complete login (including 2FA), then captures and encrypts the session.

```
/web-ctl:web-auth github --url "https://github.com/login"
/web-ctl:web-auth twitter --url "https://x.com/i/flow/login" --success-url "https://x.com/home"
```

### `/web-ctl:web-browse`

Headless browser actions for navigation and interaction.

```
/web-ctl:web-browse github goto "https://github.com"
/web-ctl:web-browse github click "role=link[name='Settings']"
/web-ctl:web-browse github click-wait "role=button[name='Save']"
/web-ctl:web-browse github snapshot
```

## Session Lifecycle

```bash
# 1. Create session
web-ctl session start github

# 2. Authenticate (opens headed browser, user logs in)
web-ctl session auth github --url "https://github.com/login" --success-url "https://github.com"

# 3. Browse headlessly (session cookies persist across invocations)
web-ctl run github goto "https://github.com/settings"
web-ctl run github snapshot
web-ctl run github click "role=link[name='Profile']"

# 4. End session
web-ctl session end github
```

## Action Reference

| Action | Usage | Returns |
|--------|-------|---------|
| `goto` | `run <s> goto <url> [--no-auth-wall-detect]` | `{ url, status, authWallDetected, checkpointCompleted, snapshot }` |
| `snapshot` | `run <s> snapshot` | `{ url, snapshot }` |
| `click` | `run <s> click <sel> [--wait-stable]` | `{ url, clicked, snapshot }` |
| `click-wait` | `run <s> click-wait <sel> [--timeout]` | `{ url, clicked, settled, snapshot }` |
| `type` | `run <s> type <sel> <text>` | `{ url, typed, selector, snapshot }` |
| `read` | `run <s> read <sel>` | `{ url, selector, content }` |
| `fill` | `run <s> fill <sel> <value>` | `{ url, filled, snapshot }` |
| `wait` | `run <s> wait <sel> [--timeout]` | `{ url, found, snapshot }` |
| `evaluate` | `run <s> evaluate <js>` | `{ url, result }` |
| `screenshot` | `run <s> screenshot [--path]` | `{ url, path }` |
| `network` | `run <s> network [--filter]` | `{ url, requests }` |
| `checkpoint` | `run <s> checkpoint [--timeout]` | `{ url, message }` |

### Macros

| Macro | Usage | Returns |
|-------|-------|---------|
| `select-option` | `run <s> select-option <sel> <text> [--exact]` | `{ url, selected, snapshot }` |
| `tab-switch` | `run <s> tab-switch <name> [--wait-for <sel>]` | `{ url, tab, snapshot }` |
| `modal-dismiss` | `run <s> modal-dismiss [--accept] [--selector <sel>]` | `{ url, dismissed, snapshot }` |
| `form-fill` | `run <s> form-fill --fields '<json>' [--submit]` | `{ url, filled, snapshot }` |
| `search-select` | `run <s> search-select <sel> <query> --pick <text>` | `{ url, query, picked, snapshot }` |
| `date-pick` | `run <s> date-pick <sel> --date <YYYY-MM-DD>` | `{ url, date, snapshot }` |
| `file-upload` | `run <s> file-upload <sel> <path> [--wait-for <sel>]` | `{ url, uploaded, snapshot }` |
| `hover-reveal` | `run <s> hover-reveal <sel> --click <target>` | `{ url, hovered, clicked, snapshot }` |
| `scroll-to` | `run <s> scroll-to <sel> [--container <sel>]` | `{ url, scrolledTo, snapshot }` |
| `wait-toast` | `run <s> wait-toast [--timeout <ms>] [--dismiss]` | `{ url, toast, snapshot }` |
| `iframe-action` | `run <s> iframe-action <iframe> <action> [args]` | `{ url, iframe, ..., snapshot }` |
| `login` | `run <s> login --user <u> --pass <p>` | `{ url, loggedIn, snapshot }` |
| `next-page` | `run <s> next-page` | `{ url, previousUrl, nextPageDetected, snapshot }` |
| `paginate` | `run <s> paginate --selector <sel> [--max-pages N] [--max-items N]` | `{ url, startUrl, pages, totalItems, items, hasMore, snapshot }` |
| `extract` | `run <s> extract --selector <sel> [--fields f1,f2] [--max-items N] [--max-field-length N]` | `{ url, mode, selector, fields, count, items, snapshot }` |
| `extract` | `run <s> extract --auto [--max-items N] [--max-field-length N]` | `{ url, mode, selector, fields, count, items, snapshot }` |

**Table-aware extraction**: When `--auto` detects a table with `<th>` headers, items include per-column data (e.g., `{ Service: "Runtime", Description: "..." }`). Tables without headers use column-indexed keys (`column_1`, `column_2`, etc.). In selector mode, use `--fields column_1,column_2` to extract specific columns by index.

### click vs click-wait

`click` fires the click and captures a snapshot immediately. For SPAs where React/Vue re-renders asynchronously, use `click-wait` or `click --wait-stable` - these wait for network idle and DOM stability (no mutations for 500ms) before returning.

This eliminates the common click-snapshot-check loop that wastes agent turns on dynamic pages.

## Session Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `start` | `session start <name>` | Create new session |
| `auth` | `session auth <name> --url <url>` | Human auth handoff |
| `save` | `session save <name>` | Save session state |
| `list` | `session list` | List all sessions |
| `status` | `session status <name>` | Check session status |
| `end` | `session end <name>` | Delete session |
| `verify` | `session verify <name> --url <url>` | Verify session is still authenticated |
| `revoke` | `session revoke <name>` | Delete all session data |

## Selector Syntax

| Pattern | Example | Description |
|---------|---------|-------------|
| `role=` | `role=button[name='Submit']` | ARIA role with optional name |
| `css=` | `css=div.composer textarea` | CSS selector |
| `text=` | `text=Sign in` | Text content match |
| `#id` | `#username` | ID shorthand |
| (other) | `div.class` | Treated as CSS selector |

## Common Flags

| Flag | Applies To | Description |
|------|-----------|-------------|
| `--wait-stable` | `click` | Wait for DOM + network stability after click |
| `--timeout <ms>` | `click-wait`, `wait`, `checkpoint` | Action timeout |
| `--success-url <url>` | `session auth` | URL to detect auth completion |
| `--success-selector <sel>` | `session auth` | DOM selector to detect auth completion |
| `--min-wait <seconds>` | `session auth` | Grace period before auth polling starts (default: 5) |
| `--vnc` | `session auth` | Use VNC for headed browser on remote servers |
| `--filter <pattern>` | `network` | Filter captured requests by URL pattern |
| `--path <file>` | `screenshot` | Custom screenshot path (within session dir) |
| `--allow-evaluate` | `evaluate` | Required safety flag for JS execution |
| `--no-auth-wall-detect` | `goto` | Disable automatic auth wall detection and checkpoint opening |
| `--snapshot-depth <N>` | Any action with snapshot | Limit ARIA tree depth (e.g. 3 for top 3 levels) |
| `--snapshot-selector <sel>` | Any action with snapshot | Scope snapshot to a DOM subtree |
| `--snapshot-max-lines <N>` | Any action with snapshot | Truncate snapshot to N lines |
| `--snapshot-compact` | Any action with snapshot | Compact format: collapse links, inline headings, remove decorative images, dedup URLs |
| `--snapshot-collapse` | Any action with snapshot | Collapse repeated siblings (keep first 2, summarize rest) |
| `--snapshot-text-only` | Any action with snapshot | Strip structural nodes, keep content only |
| `--max-field-length <N>` | `extract` | Max characters per field (default: 500, max: 2000) |
| `--snapshot-full` | Any action with snapshot | Use full page body (default: auto-scope to `<main>` and complementary landmarks) |
| `--no-snapshot` | Any action with snapshot | Omit snapshot from output entirely |

## Error Handling

All error responses include actionable recovery suggestions:

```json
{
  "ok": false,
  "error": "element_not_found",
  "message": "Selector 'role=button[name=Save]' not found on current page.",
  "suggestion": "Run: snapshot to see current page elements, then adjust selector",
  "snapshot": "- heading 'Settings' [level=1]\n- button 'Cancel'\n- button 'Apply'"
}
```

| Error Code | Meaning | Recovery |
|------------|---------|----------|
| `element_not_found` | Selector didn't match any element | Use snapshot in response to find correct selector |
| `timeout` | Action exceeded time limit | Increase `--timeout` or verify page is loading |
| `browser_closed` | Session crashed or timed out | `session start <name>` for fresh session |
| `network_error` | URL unreachable / DNS failure | Check URL; verify cookies with `session status` |
| `no_display` | Headed mode needs a display | Use `--vnc` flag or install xvfb |
| `session_expired` | Session TTL exceeded | Create new session and re-authenticate |
| `action_error` | Other Playwright error | Check `message` and `suggestion` fields |

## Agents

| Agent | Purpose | Model |
|-------|---------|-------|
| `web-session` | Orchestrate multi-step browsing workflows | sonnet |

## Skills

| Skill | Purpose |
|-------|---------|
| `web-browse` | Headless actions: goto, click, click-wait, snapshot, type, read, fill, wait, evaluate, screenshot, network, checkpoint + 15 macros |
| `web-auth` | Human-in-the-loop auth: headed browser, polls for success URL/selector, encrypts session |

## Auth Handoff Protocol

1. `session auth <name> --url <login-url> --success-url <target>`
2. Headed Chrome opens - user completes login (including 2FA)
3. Script polls for success URL/selector
4. On success: storageState captured, AES-256-GCM encrypted, context closed
5. Next `run <name> goto ...` reuses the same userDataDir headlessly - cookies persist

### CAPTCHA / Mid-Session Challenge

```bash
web-ctl run <session> checkpoint --reason captcha --timeout 120
```

Browser switches to headed mode. Agent pauses, tells user to interact. Script polls for resolution.

## Security Model

- **Prompt injection defense** - All web content wrapped in `[PAGE_CONTENT: ...]` delimiters; agent treats it as untrusted data
- **Encryption at rest** - Session storage is AES-256-GCM encrypted (master key from OS keyring or HKDF fallback)
- **Output sanitization** - `redact.js` strips cookies, tokens, session IDs, auth headers, URL credentials from all stdout
- **Read-only agent** - The web-browse agent has no Write/Edit tools
- **Anti-bot measures** - `navigator.webdriver = false`, `--disable-blink-features=AutomationControlled`, random action delays (200-800ms)
- **Path traversal prevention** - Screenshot paths validated within session directory
- **JS execution gated** - `evaluate` action requires explicit `--allow-evaluate` flag

## Cross-Platform

- **macOS/Linux** - System Chrome (`channel: 'chrome'`) with Playwright Chromium fallback
- **WSL** - Auto-detects Windows Chrome at `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`
- **Remote/CI** - `--vnc` flag for headed auth on headless servers (xvfb + x11vnc + novnc)
- **State directory** - Platform-aware via `lib/platform/state-dir.js`

## Output Format

All commands return structured JSON:

```json
{ "ok": true,  "command": "run click", "session": "github", "result": { "url": "...", "clicked": "...", "snapshot": "..." } }
{ "ok": false, "command": "run click", "session": "github", "error": "element_not_found", "message": "...", "suggestion": "...", "snapshot": "..." }
```

## Integration

Can be invoked by:
- Direct command: `/web-ctl`
- Skills: `web-browse`, `web-auth`
- Agent: `web-session` (multi-step orchestration)
- Other plugins: any agent can call web-ctl scripts directly

## Requirements

- Node.js 18+
- Playwright (`npm install playwright`)
- Chromium (`npx playwright install chromium`)

## License

MIT
