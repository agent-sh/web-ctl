# web-ctl

Browser automation and web testing toolkit for AI agents. Headless browser control, persistent sessions, and human-in-the-loop auth handoff.

## Install

```bash
agentsys install web-ctl
```

Requires [Playwright](https://playwright.dev/) as a peer dependency:

```bash
npm install playwright
npx playwright install chromium
```

## Architecture

```
SKILL.md -> node scripts/web-ctl.js <args> -> Playwright API
```

Each invocation is a single Node.js process. No daemon, no MCP server. Session state persists via Chrome's userDataDir with AES-256-GCM encrypted storage.

## Command Reference

### Session Management

```bash
# Start a new session
node scripts/web-ctl.js session start <name>

# Authenticate (opens headed browser for human login)
node scripts/web-ctl.js session auth <name> --url <login-url> [--success-url <url>] [--timeout <seconds>]

# List sessions
node scripts/web-ctl.js session list

# Check session status
node scripts/web-ctl.js session status <name>

# End session
node scripts/web-ctl.js session end <name>

# Revoke session (delete all data)
node scripts/web-ctl.js session revoke <name>
```

### Browser Actions

```bash
# Navigate to URL
node scripts/web-ctl.js run <session> goto <url>

# Get accessibility tree snapshot
node scripts/web-ctl.js run <session> snapshot

# Click element
node scripts/web-ctl.js run <session> click <selector> [--wait-stable]

# Click and wait for page to settle (SPA-friendly)
node scripts/web-ctl.js run <session> click-wait <selector> [--timeout <ms>]

# Type text
node scripts/web-ctl.js run <session> type <selector> <text>

# Read element content
node scripts/web-ctl.js run <session> read <selector>

# Fill form field
node scripts/web-ctl.js run <session> fill <selector> <value>

# Wait for element
node scripts/web-ctl.js run <session> wait <selector> [--timeout <ms>]

# Execute JavaScript
node scripts/web-ctl.js run <session> evaluate <js-code>

# Take screenshot
node scripts/web-ctl.js run <session> screenshot [--path <file>]

# Get network requests
node scripts/web-ctl.js run <session> network [--filter <pattern>]

# Open headed checkpoint (for CAPTCHAs)
node scripts/web-ctl.js run <session> checkpoint [--timeout <seconds>]
```

### Selector Syntax

- `role=button[name='Submit']` - ARIA role selector
- `css=div.my-class` - CSS selector
- `text=Click here` - Text content selector
- `#my-id` - ID shorthand (becomes `css=#my-id`)

## Error Handling

All error responses include `error` (code), `message` (human-readable), `suggestion` (recovery action), and `snapshot` (current page state).

| Error Code | Meaning | Suggested Recovery |
|------------|---------|-------------------|
| `element_not_found` | Selector didn't match | Use snapshot to find correct selector |
| `timeout` | Action exceeded time limit | Increase `--timeout` |
| `browser_closed` | Session crashed or timed out | `session start <name>` |
| `network_error` | URL unreachable / DNS failure | Check URL and session cookies |
| `no_display` | Headed mode needs a display | Use `--vnc` flag |
| `session_expired` | Session TTL exceeded | Create new session, re-authenticate |
| `action_error` | Other error | Check message and suggestion fields |

## Security Model

- All web content is wrapped in `[PAGE_CONTENT: ...]` delimiters to prevent prompt injection
- Session storage is AES-256-GCM encrypted at rest
- Output sanitization strips cookies, tokens, and session IDs
- Agent instructions explicitly mark web content as untrusted
- No Write/Edit tools on the browsing agent (read-only)

## License

MIT
