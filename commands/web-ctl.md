---
name: web-ctl
description: "Browser automation for AI agents - navigate, authenticate, and interact with web pages."
codex-description: 'Use when user asks to "open a webpage", "browse website", "log into site", "scrape page", "interact with web", "web automation", "browser control".'
argument-hint: "[session] [action] [--url [url]] [--headed]"
allowed-tools: Skill, Task, Bash(node:*), Read, AskUserQuestion
---

# /web-ctl Command

Browser automation for AI agents. Navigate websites, authenticate with human handoff, and interact with web pages.

## Intent Routing

Parse the user's request and route appropriately:

### Simple Actions (Direct Skill Invocation)

For single-step requests like "go to example.com" or "take a screenshot":

1. Ensure a session exists (create one with a sensible name if not)
2. Invoke the **web-browse** skill with the appropriate action

### Auth Requests

For "log into X" or "authenticate to Y":

1. Create a session named after the service
2. Invoke the **web-auth** skill

### Multi-Step Flows

For complex requests like "find information on a website" or "fill out a form":

1. Delegate to the **web-session** agent via Task tool

## Quick Reference

```bash
# Session lifecycle
node ${PLUGIN_ROOT}/scripts/web-ctl.js session start <name>
node ${PLUGIN_ROOT}/scripts/web-ctl.js session auth <name> --provider <provider>
node ${PLUGIN_ROOT}/scripts/web-ctl.js session auth <name> --url <url>
node ${PLUGIN_ROOT}/scripts/web-ctl.js session auth <name> --provider <slug> --providers-file <path>
node ${PLUGIN_ROOT}/scripts/web-ctl.js session providers
node ${PLUGIN_ROOT}/scripts/web-ctl.js session list
node ${PLUGIN_ROOT}/scripts/web-ctl.js session end <name>

# Browser actions
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> goto <url>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> snapshot
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> click <selector>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> read <selector>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> screenshot

# Macros
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> select-option <sel> <text>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> tab-switch <name>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> modal-dismiss [--accept]
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> form-fill --fields '<json>' [--submit]
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> search-select <sel> <query> --pick <text>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> date-pick <sel> --date <YYYY-MM-DD>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> file-upload <sel> <path>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> hover-reveal <sel> --click <target>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> scroll-to <sel>
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> wait-toast [--dismiss]
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> iframe-action <iframe> <action> [args]
node ${PLUGIN_ROOT}/scripts/web-ctl.js run <session> login --user <u> --pass <p>
```

## Examples

User: "Open github.com and show me my profile"
1. Start session "github"
2. Auth if needed (web-auth skill)
3. Navigate to github.com/profile
4. Snapshot and report

User: "Take a screenshot of example.com"
1. Start session "quick"
2. Goto example.com
3. Screenshot
4. End session

User: "Log into Twitter"
1. Start session "twitter"
2. Auth with `--provider twitter` (auto-configures URL and success detection)
3. Report success/failure

User: "Log into GitHub"
1. Start session "github"
2. Auth with `--provider github`
3. Report success/failure
