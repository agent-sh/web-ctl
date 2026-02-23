#!/usr/bin/env node
'use strict';

const sessionStore = require('./session-store');
const { launchBrowser, closeBrowser, randomDelay, waitForStable } = require('./browser-launcher');
const { runAuthFlow } = require('./auth-flow');
const { checkAuthSuccess } = require('./auth-check');
const { sanitizeWebContent, wrapOutput } = require('./redact');
const { listProviders, resolveAuthOptions, loadCustomProviders } = require('./auth-providers');
const { macros } = require('./macros');

const path = require('path');

const [,, ...args] = process.argv;

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_SCHEMES = /^https?:\/\//i;

const BOOLEAN_FLAGS = new Set([
  '--allow-evaluate', '--no-snapshot', '--wait-stable', '--vnc',
  '--exact', '--accept', '--submit', '--dismiss',
]);

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
      if (next && !next.startsWith('--') && !BOOLEAN_FLAGS.has(args[i])) {
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
 * Uses Playwright's ariaSnapshot API (page.accessibility was removed in v1.50+).
 *
 * @param {object} page - Playwright page object
 * @param {object} [opts={}] - Snapshot options
 * @param {boolean} [opts.noSnapshot] - Return null to omit snapshot entirely
 * @param {string} [opts.snapshotSelector] - Scope snapshot to a DOM subtree
 * @param {number} [opts.snapshotDepth] - Limit ARIA tree depth
 */
async function getSnapshot(page, opts = {}) {
  if (opts.noSnapshot) return null;
  try {
    const root = opts.snapshotSelector
      ? resolveSelector(page, opts.snapshotSelector)
      : page.locator('body');
    const raw = await root.ariaSnapshot();
    return opts.snapshotDepth ? trimByDepth(raw, opts.snapshotDepth) : raw;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[WARN] ariaSnapshot failed:', msg);
    return `(accessibility tree unavailable - ${msg})`;
  }
}

/**
 * Trim ARIA snapshot output by indentation depth.
 * Lines at depth >= maxDepth are removed; truncation markers are inserted
 * at the first cut point of each contiguous removed block.
 *
 * @param {string} snapshot - ARIA snapshot text
 * @param {number} maxDepth - Maximum depth to keep (depth 0 = top-level)
 * @returns {string} Trimmed snapshot
 */
function trimByDepth(snapshot, maxDepth) {
  if (maxDepth == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');
  const result = [];
  let prevCut = false;

  for (const line of lines) {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);

    if (depth < maxDepth) {
      result.push(line);
      prevCut = false;
    } else if (!prevCut) {
      // Insert truncation marker at the parent's indentation + one level
      const markerIndent = ' '.repeat(depth * 2);
      result.push(`${markerIndent}- ...`);
      prevCut = true;
    }
    // else: consecutive cut lines, skip (no duplicate markers)
  }

  return result.join('\n');
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
  if (opts.providersFile) loadCustomProviders(opts.providersFile);
  let resolved;
  try {
    resolved = resolveAuthOptions(opts.provider, opts);
  } catch (err) {
    output({ ok: false, command: 'session auth', session: name, error: 'unknown_provider', message: err.message });
    return;
  }

  if (!resolved.url) {
    output({ ok: false, command: 'session auth', session: name, error: 'missing_url', message: '--url is required (or use --provider to set it automatically)' });
    return;
  }

  try { validateUrl(resolved.url); } catch (err) {
    output({ ok: false, command: 'session auth', session: name, error: 'invalid_url', message: err.message });
    return;
  }

  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session auth', session: name, error: 'session_not_found', message: `Session "${name}" not found. Run: session start ${name}` });
    return;
  }

  const result = await runAuthFlow(name, resolved.url, {
    successUrl: resolved.successUrl,
    successSelector: resolved.successSelector,
    successCookie: resolved.successCookie,
    captchaSelectors: resolved.captchaSelectors,
    captchaTextPatterns: resolved.captchaTextPatterns,
    twoFactorHint: resolved.twoFactorHint,
    timeout: resolved.timeout ? parseInt(resolved.timeout, 10) : undefined,
    vnc: !!resolved.vnc,
    port: resolved.port ? parseInt(resolved.port, 10) : undefined,
    verifyUrl: resolved.verifyUrl,
    verifySelector: resolved.verifySelector,
    minWait: resolved.minWait != null ? Math.max(0, Math.min(300, parseInt(resolved.minWait, 10) || 0)) : undefined
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

async function sessionVerify(name, opts) {
  try { validateSessionName(name); } catch (err) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_name', message: err.message });
    return;
  }

  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session verify', session: name, error: 'session_not_found', message: `Session "${name}" not found. Run: session start ${name}` });
    return;
  }

  if (session.status === 'expired') {
    output({ ok: false, command: 'session verify', session: name, error: 'session_expired', message: 'Session has expired. Start a new one.' });
    return;
  }

  if (opts.providersFile) loadCustomProviders(opts.providersFile);

  let authOpts = {};
  if (opts.provider) {
    try {
      authOpts = resolveAuthOptions(opts.provider, opts);
    } catch (err) {
      output({ ok: false, command: 'session verify', session: name, error: 'unknown_provider', message: err.message });
      return;
    }
  }

  const url = opts.url || authOpts.successUrl;
  if (!url) {
    output({ ok: false, command: 'session verify', session: name, error: 'missing_url', message: '--url is required (or use --provider with a successUrl)' });
    return;
  }

  try { validateUrl(url); } catch (err) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_url', message: err.message });
    return;
  }

  const expectedStatus = opts.expectStatus ? parseInt(opts.expectStatus, 10) : null;
  if (expectedStatus !== null && (isNaN(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_expect_status', message: '--expect-status must be a numeric HTTP status code (100-599)' });
    return;
  }

  let context;
  try {
    sessionStore.lockSession(name);
    const browser = await launchBrowser(name, { headless: true });
    context = browser.context;
    const page = browser.page;

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response ? response.status() : null;

    if (expectedStatus !== null && status !== expectedStatus) {
      try { await closeBrowser(name, context); } catch { /* ignore */ }
      try { sessionStore.unlockSession(name); } catch { /* ignore */ }
      output({ ok: false, command: 'session verify', session: name, authenticated: false, reason: `Expected status ${expectedStatus}, got ${status}`, url, status });
      return;
    }

    const authResult = await checkAuthSuccess(page, context, url, {
      successUrl: authOpts.successUrl,
      successSelector: opts.expectSelector || authOpts.successSelector,
      successCookie: authOpts.successCookie,
      successLocalStorage: authOpts.successLocalStorage
    });

    try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }

    output({
      ok: authResult.success,
      command: 'session verify',
      session: name,
      authenticated: authResult.success,
      reason: authResult.success ? 'Auth check passed' : 'Auth check failed',
      url,
      currentUrl: authResult.currentUrl,
      status
    });
  } catch (err) {
    if (context) try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }
    output({ ok: false, command: 'session verify', session: name, error: 'verify_error', message: err.message });
  }
}

// ============ Error Classification ============

/**
 * Classify a Playwright/action error into an actionable error response.
 * Returns { error, message, suggestion } with context-aware recovery hints.
 */
function classifyError(err, { action, selector, snapshot } = {}) {
  const msg = err.message || '';

  // Browser/context closed
  if (msg.includes('browser has been closed') || msg.includes('Target closed') ||
      msg.includes('Target page, context or browser has been closed')) {
    return {
      error: 'browser_closed',
      message: 'Browser closed unexpectedly. The session may have timed out or crashed.',
      suggestion: 'Run: session start <name> to create a fresh session'
    };
  }

  // No display for headed mode
  if (msg.includes('no usable sandbox') || msg.includes('Cannot open display') ||
      msg.includes('Missing X server')) {
    return {
      error: 'no_display',
      message: 'No display available for headed browser.',
      suggestion: 'Use --vnc flag or install: sudo apt-get install xvfb x11vnc'
    };
  }

  // Element not found / strict mode violation
  if (msg.includes('not found') || msg.includes('waiting for locator') ||
      msg.includes('strict mode violation') || msg.includes('resolved to') ||
      msg.includes('Timeout') && selector) {
    const hint = snapshot
      ? `Current page snapshot available in response for element discovery.`
      : 'Run: snapshot to see current page elements, then adjust selector.';
    return {
      error: 'element_not_found',
      message: `Selector '${selector || 'unknown'}' not found on current page.`,
      suggestion: hint
    };
  }

  // Timeout (general)
  if (msg.includes('Timeout') || msg.includes('timeout')) {
    return {
      error: 'timeout',
      message: `Action '${action}' timed out.`,
      suggestion: 'Increase --timeout value or verify the page is loading correctly'
    };
  }

  // Network errors
  if (msg.includes('net::ERR_') || msg.includes('NS_ERROR_')) {
    return {
      error: 'network_error',
      message: `Network error during '${action}': ${msg.split('\n')[0]}`,
      suggestion: 'Check URL is accessible. If auth is needed, verify session cookies with: session status <name>'
    };
  }

  // Session expired (caught before runAction, but just in case)
  if (msg.includes('expired')) {
    return {
      error: 'session_expired',
      message: 'Session has expired.',
      suggestion: 'Run: session start <name> to create a new session, then re-authenticate'
    };
  }

  // Default
  return {
    error: 'action_error',
    message: msg.split('\n')[0],
    suggestion: null
  };
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

  // Validate and normalize snapshot options
  if (opts.snapshotDepth != null) {
    const depth = parseInt(opts.snapshotDepth, 10);
    if (isNaN(depth) || depth <= 0 || depth > 100) {
      output({ ok: false, command: `run ${action}`, session: sessionName, error: 'invalid_option', message: '--snapshot-depth must be a positive integer (max 100)' });
      return;
    }
    opts.snapshotDepth = depth;
  }
  if (opts.snapshotSelector != null && (typeof opts.snapshotSelector !== 'string' || opts.snapshotSelector.length === 0 || opts.snapshotSelector === 'true')) {
    output({ ok: false, command: `run ${action}`, session: sessionName, error: 'invalid_option', message: '--snapshot-selector requires a non-empty selector value' });
    return;
  }
  // Explicit snapshot action should always produce a snapshot
  if (action === 'snapshot') {
    delete opts.noSnapshot;
  }

  let context;
  let page;

  try {
    sessionStore.lockSession(sessionName);

    const headless = action !== 'checkpoint';
    const browser = await launchBrowser(sessionName, { headless });
    context = browser.context;
    page = browser.page;

    if (action !== 'goto' && session.lastUrl && session.lastUrl !== 'about:blank') {
      try {
        validateUrl(session.lastUrl);
        await page.goto(session.lastUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch { /* ignore - best effort restoration */ }
    }

    await randomDelay();

    let result;

    switch (action) {
      case 'goto': {
        const url = actionArgs[0];
        if (!url) throw new Error('URL required: run <session> goto <url>');
        validateUrl(url);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), status: response ? response.status() : null, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'snapshot': {
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'click': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> click <selector>');
        const locator = resolveSelector(page, selector);
        await locator.click({ timeout: 10000 });
        if (opts.waitStable) {
          const stableTimeout = opts.timeout ? parseInt(opts.timeout, 10) : 5000;
          await waitForStable(page, { timeout: stableTimeout });
        } else {
          await randomDelay();
        }
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), clicked: selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'click-wait': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> click-wait <selector>');
        const locator = resolveSelector(page, selector);
        await locator.click({ timeout: 10000 });
        const stableTimeout = opts.timeout ? parseInt(opts.timeout, 10) : 5000;
        await waitForStable(page, { timeout: stableTimeout });
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), clicked: selector, settled: true, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'type': {
        const selector = actionArgs[0];
        const text = actionArgs.slice(1).join(' ');
        if (!selector || !text) throw new Error('Selector and text required: run <session> type <selector> <text>');
        const locator = resolveSelector(page, selector);
        await locator.type(text, { delay: 50 + Math.random() * 100 });
        await randomDelay();
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), typed: '[INPUT]', selector, ...(snapshot != null && { snapshot }) };
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
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), filled: selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'wait': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> wait <selector>');
        const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 30000;
        const locator = resolveSelector(page, selector);
        await locator.waitFor({ state: 'visible', timeout });
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), found: selector, ...(snapshot != null && { snapshot }) };
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

      default: {
        const macro = macros[action];
        if (macro) {
          const helpers = { resolveSelector, waitForStable, randomDelay, getSnapshot: (page) => getSnapshot(page, opts), sanitizeWebContent };
          result = await macro(page, actionArgs, opts, helpers);
          // Clean up null snapshot from macros when --no-snapshot is active
          if (result && result.snapshot == null) delete result.snapshot;
        } else {
          const allActions = ['goto', 'snapshot', 'click', 'click-wait', 'type', 'read', 'fill', 'wait', 'evaluate', 'screenshot', 'network', 'checkpoint', ...Object.keys(macros)];
          throw new Error(`Unknown action: ${action}. Available: ${allActions.join(', ')}`);
        }
        break;
      }
    }

    try {
      const currentUrl = page.url();
      if (currentUrl && currentUrl !== 'about:blank') {
        sessionStore.updateSession(sessionName, { lastUrl: currentUrl });
      }
    } catch { /* ignore - page may have closed before URL read */ }

    await closeBrowser(sessionName, context);
    sessionStore.unlockSession(sessionName);
    output({ ok: true, command: `run ${action}`, session: sessionName, result });

  } catch (err) {
    let snapshot = null;
    if (page) {
      try { snapshot = await getSnapshot(page, opts); } catch { /* getSnapshot handles internally; guard against unexpected state */ }
      try {
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== 'about:blank') {
          sessionStore.updateSession(sessionName, { lastUrl: currentUrl });
        }
      } catch { /* ignore */ }
    }
    if (context) {
      try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
    }
    try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }

    const classified = classifyError(err, { action, selector: actionArgs[0], snapshot });
    output({
      ok: false,
      command: `run ${action}`,
      session: sessionName,
      ...classified,
      ...(snapshot != null && { snapshot })
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
    [--provider <name>]         Use pre-built provider (sets url, success checks)
    [--success-url <url>]       URL to detect auth completion
    [--success-selector <sel>]  DOM selector to detect auth completion
    [--success-cookie <json>]   Cookie presence to detect auth completion
    [--providers-file <path>]   Load custom providers from JSON file
    [--timeout <seconds>]       Timeout in seconds (default: 300)
    [--min-wait <seconds>]      Grace period before auth checks (default: 5)
  providers                     List available auth providers
  save <name>                   Save session state
  list                          List all sessions
  status <name>                 Show session status
  end <name>                    End and delete session
  revoke <name>                 Delete all session data
  verify <name> --url <url>     Verify session is still authenticated
    [--provider <name>]         Use provider defaults for success checks
    [--expect-status <code>]    Assert HTTP status code
    [--expect-selector <sel>]   Assert DOM element presence

Run actions:
  goto <url>                    Navigate to URL
  snapshot                      Get accessibility tree
  click <selector>              Click element
    [--wait-stable]             Wait for DOM + network to settle after click
    [--timeout <ms>]            Stability wait timeout (default: 5000)
  click-wait <selector>         Click and wait for page to settle
    [--timeout <ms>]            Stability wait timeout (default: 5000)
  type <selector> <text>        Type text into element
  read <selector>               Read element text content
  fill <selector> <value>       Fill form field
  wait <selector>               Wait for element to appear
    [--timeout <ms>]            Wait timeout (default: 30000)
  evaluate <js-code>            Execute JavaScript
  screenshot [--path <file>]    Take screenshot
  network [--filter <pattern>]  Capture network requests
  checkpoint [--timeout <sec>]  Open headed browser for interaction

Macros (higher-level actions):
  select-option <sel> <text>    Click trigger, pick option by text
  tab-switch <name>             Switch to tab by name
  modal-dismiss [--accept]      Auto-detect and dismiss modal/dialog
  form-fill --fields '<json>'   Fill form fields by label
    [--submit] [--submit-text]
  search-select <sel> <q>       Type query, pick from suggestions
    --pick <text>
  date-pick <sel> --date <d>    Pick date from calendar widget
  file-upload <sel> <path>      Upload file to input element
  hover-reveal <sel>            Hover trigger, click revealed target
    --click <target>
  scroll-to <sel>               Scroll element into view
  wait-toast [--dismiss]        Wait for toast/notification
  iframe-action <sel> <action>  Perform action inside iframe
  login --user <u> --pass <p>   Auto-detect and fill login form

Snapshot options (apply to any action that returns a snapshot):
  --snapshot-depth <N>          Limit ARIA tree depth (e.g. 3 for top 3 levels)
  --snapshot-selector <sel>     Scope snapshot to a DOM subtree
  --no-snapshot                 Omit snapshot from output entirely

Selector syntax:
  role=button[name='Submit']    ARIA role selector
  css=div.my-class              CSS selector
  text=Click here               Text content selector
  #my-id                        ID shorthand

Examples:
  web-ctl session start github
  web-ctl session auth github --provider github
  web-ctl session auth github --url https://github.com/login
  web-ctl session providers
  web-ctl run github goto https://github.com
  web-ctl run github snapshot
  web-ctl run github click "role=link[name='Settings']"
  web-ctl run github click-wait "role=button[name='Save']"
  web-ctl run github click "role=tab[name='Code']" --wait-stable
  web-ctl run github snapshot --snapshot-depth 3
  web-ctl run github goto https://github.com --snapshot-selector "css=nav"
  web-ctl run github click "#btn" --no-snapshot
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
      case 'providers':
        if (opts && opts.providersFile) loadCustomProviders(opts.providersFile);
        output({ ok: true, command: 'session providers', providers: listProviders() });
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
      case 'verify':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionVerify(name, opts);
        break;
      default:
        output({ ok: false, error: 'unknown_command', message: `Unknown session command: ${subcommand}. Use: start, auth, providers, save, list, status, end, revoke, verify` });
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
        if (args[i + 1] && !args[i + 1].startsWith('--') && !BOOLEAN_FLAGS.has(args[i])) i++;
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
