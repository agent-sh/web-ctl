# Migration Guide

## 1.0.0 -> 1.1.0

This release flips three user-facing defaults in the name of security. Existing setups will break until you opt in to the new behavior. Copy-paste one-liners below.

### 1. `evaluate` no longer accepts a bare `--allow-evaluate` flag

Evaluate now requires both an environment variable AND either a TTY confirmation or a precomputed sha256 hash of the expression.

```bash
# Interactive (TTY will prompt for confirmation):
WEB_CTL_ALLOW_EVALUATE=1 web-ctl run <session> evaluate "<expr>"

# Non-interactive (CI / scripts) - precompute sha256-16 of the expression:
HASH=$(printf '%s' "<expr>" | sha256sum | cut -c1-16)
WEB_CTL_ALLOW_EVALUATE=1 WEB_CTL_EVALUATE_CONFIRM="$HASH" web-ctl run <session> evaluate "<expr>"
```

The `--allow-evaluate` CLI flag has been removed and will error if passed.

### 2. `ensure-deps` auto-install is opt-in

The first browser operation no longer auto-installs `playwright` + Chromium. Either install them yourself or set the env var to restore the old behavior.

```bash
# Option A: explicit install (recommended)
npm install playwright@1.58.2 && npx playwright install chromium

# Option B: restore auto-install (equivalent to 1.0.0 behavior)
export WEB_CTL_AUTO_INSTALL=1
```

### 3. VNC now binds to loopback only

`web-ctl` VNC sessions bind to `127.0.0.1` by default. Remote access requires an explicit opt-in flag.

```bash
# Old (1.0.0) implicit behavior - now loopback only:
web-ctl run <session> goto <url> --vnc

# To expose VNC beyond localhost (restores prior exposure):
web-ctl run <session> goto <url> --vnc --bind-remote
```

Additionally, every VNC session now uses a per-session random password token written to a `0700` tempdir (cleaned up on process exit).

### Also in 1.1.0

- `playwright` is now pinned to exact `1.58.2` (previously floor `>=1.40.0`). If you depend on a newer Playwright, override in your own `package.json`.
- SSRF denylist now blocks `127.0.0.1`, RFC1918, `169.254.169.254` (cloud metadata), link-local, and IPv6 private ranges (including IPv4-mapped hex form). Requests to these targets will be rejected.
- Output redaction expanded to bare JWTs, AWS `AKIA` keys, GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`), and OpenAI / Anthropic API keys.
