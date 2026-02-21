#!/usr/bin/env node
'use strict';

const sessionStore = require('./session-store');
const { launchBrowser, closeBrowser, randomDelay } = require('./browser-launcher');
const { runAuthFlow } = require('./auth-flow');
const { sanitizeWebContent, wrapOutput } = require('./redact');

const path = require('path');

const [,, ...args] = process.argv;

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_SCHEMES = /^https?:\/\//i;

function validateSessionName(name) {
  if (!name || !SESSION_NAME_RE.test(name)) {
    throw new Error(`Invalid session name "${name}". Use only letters, numbers, hyphens, underscores (max 64 chars).`);
  }
}

function validateUrl(url) {
  if (!url || !ALLOWED_SCHEMES.test(url)) {
    throw new Error(`Invalid URL scheme. Only http:// and https:// URLs are allowed. Got: ${url}`);
  }
}

function output(data) {
  console.log(JSON.stringify(wrapOutput(data), null, 2));
}

function parseOptions(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

/**
 * Convert selector string to Playwright locator.
 */
function resolveSelector(page, selector) {
  if (!selector) return null;

  if (selector.startsWith('role=')) {
    const match = selector.match(/^role=(\w+)(?:\[name=['"](.+)['"]\])?/);
    if (match) {
      const opts = match[2] ? { name: match[2] } : {};
      return page.getByRole(match[1], opts);
    }
  }

  if (selector.startsWith('text=')) {
    return page.getByText(selector.slice(5));
  }

  if (selector.startsWith('css=')) {
    return page.locator(selector.slice(4));
  }

  if (selector.startsWith('#')) {
    return page.locator(selector);
  }

  // Default: treat as CSS selector
  return page.locator(selector);
}

/**
 * Get accessibility tree snapshot formatted as text.
 */
async function getSnapshot(page) {
  try {
    const snapshot = await page.accessibility.snapshot();
    if (!snapshot) return '(empty accessibility tree)';
    return formatAccessibilityTree(snapshot, 0);
  } catch {
    return '(accessibility tree unavailable)';
  }
}

function formatAccessibilityTree(node, depth) {
  const indent = '  '.repeat(depth);
  let line = `${indent}${node.role || 'unknown'}`;
  if (node.name) line += ` "${node.name}"`;
  if (node.value) line += ` value="${node.value}"`;
  if (node.checked !== undefined) line += ` checked=${node.checked}`;
  if (node.pressed !== undefined) line += ` pressed=${node.pressed}`;

  let result = line;

  if (node.children) {
    for (const child of node.children) {
      result += '\n' + formatAccessibilityTree(child, depth + 1);
    }
  }

  return result;
}

// ============ Session Commands ============

async function sessionStart(name) {
  try {
    validateSessionName(name);
    const metadata = sessionStore.createSession(name);
    output({ ok: true, command: 'session start', session: name, result: metadata });
  } catch (err) {
    output({ ok: false, command: 'session start', session: name, error: 'session_exists', message: err.message });
  }
}

async function sessionAuth(name, opts) {
  if (!opts.url) {
    output({ ok: false, command: 'session auth', session: name, error: 'missing_url', message: '--url is required' });
    return;
  }

  try { validateUrl(opts.url); } catch (err) {
    output({ ok: false, command: 'session auth', session: name, error: 'invalid_url', message: err.message });
    return;
  }

  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session auth', session: name, error: 'session_not_found', message: `Session "${name}" not found. Run: session start ${name}` });
    return;
  }

  const result = await runAuthFlow(name, opts.url, {
    successUrl: opts.successUrl,
    successSelector: opts.successSelector,
    timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined
  });

  output({ command: 'session auth', ...result });
}

async function sessionSave(name) {
  let context;
  try {
    sessionStore.lockSession(name);
    const browser = await launchBrowser(name, { headless: true });
    context = browser.context;
    await closeBrowser(name, context);
    sessionStore.unlockSession(name);
    output({ ok: true, command: 'session save', session: name });
  } catch (err) {
    if (context) try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }
    output({ ok: false, command: 'session save', session: name, error: 'save_error', message: err.message });
  }
}

async function sessionList() {
  const sessions = sessionStore.listSessions();
  output({ ok: true, command: 'session list', sessions });
}

async function sessionStatus(name) {
  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session status', session: name, error: 'session_not_found', message: `Session "${name}" not found` });
    return;
  }
  output({ ok: true, command: 'session status', session: name, result: session });
}

async function sessionEnd(name) {
  try {
    sessionStore.deleteSession(name);
    output({ ok: true, command: 'session end', session: name });
  } catch (err) {
    output({ ok: false, command: 'session end', session: name, error: 'end_error', message: err.message });
  }
}

async function sessionRevoke(name) {
  try {
    sessionStore.deleteSession(name);
    output({ ok: true, command: 'session revoke', session: name, message: 'All session data deleted' });
  } catch (err) {
    output({ ok: false, command: 'session revoke', session: name, error: 'revoke_error', message: err.message });
  }
}

// ============ Run Commands ============

async function runAction(sessionName, action, actionArgs, opts) {
  const session = sessionStore.getSession(sessionName);
  if (!session) {
    output({ ok: false, command: `run ${action}`, session: sessionName, error: 'session_not_found', message: `Session "${sessionName}" not found` });
    return;
  }

  if (session.status === 'expired') {
    output({ ok: false, command: `run ${action}`, session: sessionName, error: 'session_expired', message: 'Session has expired. Start a new one.' });
    return;
  }

  let context;
  let page;

  try {
    sessionStore.lockSession(sessionName);

    const headless = action !== 'checkpoint';
    const browser = await launchBrowser(sessionName, { headless });
    context = browser.context;
    page = browser.page;

    await randomDelay();

    let result;

    switch (action) {
      case 'goto': {
        const url = actionArgs[0];
        if (!url) throw new Error('URL required: run <session> goto <url>');
        validateUrl(url);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), status: response ? response.status() : null, snapshot };
        break;
      }

      case 'snapshot': {
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), snapshot };
        break;
      }

      case 'click': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> click <selector>');
        const locator = resolveSelector(page, selector);
        await locator.click({ timeout: 10000 });
        await randomDelay();
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), clicked: selector, snapshot };
        break;
      }

      case 'type': {
        const selector = actionArgs[0];
        const text = actionArgs.slice(1).join(' ');
        if (!selector || !text) throw new Error('Selector and text required: run <session> type <selector> <text>');
        const locator = resolveSelector(page, selector);
        await locator.type(text, { delay: 50 + Math.random() * 100 });
        await randomDelay();
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), typed: '[INPUT]', selector, snapshot };
        break;
      }

      case 'read': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> read <selector>');
        const locator = resolveSelector(page, selector);
        const text = await locator.textContent({ timeout: 10000 });
        result = { url: page.url(), selector, content: sanitizeWebContent(text || '') };
        break;
      }

      case 'fill': {
        const selector = actionArgs[0];
        const value = actionArgs.slice(1).join(' ');
        if (!selector || !value) throw new Error('Selector and value required: run <session> fill <selector> <value>');
        const locator = resolveSelector(page, selector);
        await locator.fill(value);
        await randomDelay();
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), filled: selector, snapshot };
        break;
      }

      case 'wait': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> wait <selector>');
        const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 30000;
        const locator = resolveSelector(page, selector);
        await locator.waitFor({ state: 'visible', timeout });
        const snapshot = await getSnapshot(page);
        result = { url: page.url(), found: selector, snapshot };
        break;
      }

      case 'evaluate': {
        // WARNING: Only execute agent-authored code. NEVER pass web page content as code.
        const code = actionArgs.join(' ');
        if (!code) throw new Error('JS code required: run <session> evaluate <code>');
        if (!opts.allowEvaluate) throw new Error('evaluate requires --allow-evaluate flag for safety. This action executes arbitrary JS in the browser context.');
        const evalResult = await page.evaluate(code);
        const stringResult = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult);
        result = { url: page.url(), result: sanitizeWebContent(stringResult || '') };
        break;
      }

      case 'screenshot': {
        const sessionDir = sessionStore.getSessionDir(sessionName);
        const defaultPath = path.join(sessionDir, `screenshot-${Date.now()}.png`);
        let screenshotPath = opts.path || defaultPath;
        // Prevent path traversal — resolve and verify within session dir
        if (opts.path) {
          const resolved = path.resolve(opts.path);
          const resolvedSession = path.resolve(sessionDir);
          if (!resolved.startsWith(resolvedSession + path.sep) && resolved !== resolvedSession) {
            throw new Error('Screenshot path must be within the session directory. Use --path relative to session dir.');
          }
          screenshotPath = resolved;
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result = { url: page.url(), path: screenshotPath };
        break;
      }

      case 'network': {
        const filter = opts.filter;
        const requests = [];

        page.on('request', req => {
          if (!filter || req.url().includes(filter)) {
            requests.push({ method: req.method(), url: req.url() });
          }
        });

        // Wait a brief moment to collect ongoing requests
        await new Promise(resolve => setTimeout(resolve, 2000));

        result = { url: page.url(), requests: requests.slice(0, 50) };
        break;
      }

      case 'checkpoint': {
        // Open headed browser for user to interact (solve CAPTCHAs etc.)
        const timeout = (opts.timeout ? parseInt(opts.timeout, 10) : 120) * 1000;
        // Note: browser is already headed (action !== 'checkpoint' check above sets headless=false)
        await new Promise(resolve => setTimeout(resolve, timeout));
        result = { url: page.url(), message: `Checkpoint complete after ${timeout / 1000}s` };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}. Available: goto, snapshot, click, type, read, fill, wait, evaluate, screenshot, network, checkpoint`);
    }

    await closeBrowser(sessionName, context);
    sessionStore.unlockSession(sessionName);
    output({ ok: true, command: `run ${action}`, session: sessionName, result });

  } catch (err) {
    let snapshot = null;
    if (page) {
      try { snapshot = await getSnapshot(page); } catch { /* ignore */ }
    }
    if (context) {
      try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
    }
    try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }

    output({
      ok: false,
      command: `run ${action}`,
      session: sessionName,
      error: err.message.includes('not found') ? 'element_not_found' : 'action_error',
      message: err.message,
      snapshot
    });
  }
}

// ============ Help ============

function printHelp() {
  console.log(`web-ctl - Browser automation for AI agents

Usage:
  web-ctl session <command> <name> [options]
  web-ctl run <session> <action> [args] [options]

Session commands:
  start <name>                  Create a new session
  auth <name> --url <url>       Open headed browser for auth
    [--success-url <url>]       URL to detect auth completion
    [--success-selector <sel>]  DOM selector to detect auth completion
    [--timeout <seconds>]       Timeout in seconds (default: 300)
  save <name>                   Save session state
  list                          List all sessions
  status <name>                 Show session status
  end <name>                    End and delete session
  revoke <name>                 Delete all session data

Run actions:
  goto <url>                    Navigate to URL
  snapshot                      Get accessibility tree
  click <selector>              Click element
  type <selector> <text>        Type text into element
  read <selector>               Read element text content
  fill <selector> <value>       Fill form field
  wait <selector>               Wait for element to appear
    [--timeout <ms>]            Wait timeout (default: 30000)
  evaluate <js-code>            Execute JavaScript
  screenshot [--path <file>]    Take screenshot
  network [--filter <pattern>]  Capture network requests
  checkpoint [--timeout <sec>]  Open headed browser for interaction

Selector syntax:
  role=button[name='Submit']    ARIA role selector
  css=div.my-class              CSS selector
  text=Click here               Text content selector
  #my-id                        ID shorthand

Examples:
  web-ctl session start github
  web-ctl session auth github --url https://github.com/login
  web-ctl run github goto https://github.com
  web-ctl run github snapshot
  web-ctl run github click "role=link[name='Settings']"
  web-ctl session end github`);
}

// ============ Main Router ============

async function main() {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  const command = args[0];

  if (command === 'session') {
    const subcommand = args[1];
    const name = args[2];
    const opts = parseOptions(args.slice(3));

    switch (subcommand) {
      case 'start':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionStart(name);
        break;
      case 'auth':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionAuth(name, opts);
        break;
      case 'save':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionSave(name);
        break;
      case 'list':
        await sessionList();
        break;
      case 'status':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionStatus(name);
        break;
      case 'end':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionEnd(name);
        break;
      case 'revoke':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionRevoke(name);
        break;
      default:
        output({ ok: false, error: 'unknown_command', message: `Unknown session command: ${subcommand}. Use: start, auth, save, list, status, end, revoke` });
    }
  } else if (command === 'run') {
    const sessionName = args[1];
    const action = args[2];
    const opts = parseOptions(args.slice(3));
    // Extract non-option args after action
    const cleanArgs = [];
    for (let i = 3; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        // Skip option and its value
        if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
      } else {
        cleanArgs.push(args[i]);
      }
    }

    if (!sessionName || !action) {
      output({ ok: false, error: 'missing_args', message: 'Usage: run <session> <action> [args]' });
      return;
    }

    try { validateSessionName(sessionName); } catch (err) {
      output({ ok: false, error: 'invalid_name', message: err.message });
      return;
    }

    await runAction(sessionName, action, cleanArgs, opts);
  } else {
    output({ ok: false, error: 'unknown_command', message: `Unknown command: ${command}. Use: session, run, --help` });
  }
}

main().catch(err => {
  output({ ok: false, error: 'fatal', message: err.message });
  process.exit(1);
});
