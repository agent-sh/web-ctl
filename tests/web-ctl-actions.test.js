'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Extract classifyError for testing by requiring the module internals
// Since classifyError is not exported, we test it via the error patterns it handles
// by simulating the same logic. We also test the CLI argument parsing.

describe('error classification patterns', () => {
  // Replicate classifyError logic for unit testing
  // (The function lives in web-ctl.js and is not exported, so we test the patterns)
  function classifyError(err, { action, selector, snapshot } = {}) {
    const msg = err.message || '';

    if (msg.includes('browser has been closed') || msg.includes('Target closed') ||
        msg.includes('Target page, context or browser has been closed')) {
      return {
        error: 'browser_closed',
        message: 'Browser closed unexpectedly. The session may have timed out or crashed.',
        suggestion: 'Run: session start <name> to create a fresh session'
      };
    }

    if (msg.includes('no usable sandbox') || msg.includes('Cannot open display') ||
        msg.includes('Missing X server')) {
      return {
        error: 'no_display',
        message: 'No display available for headed browser.',
        suggestion: 'Use --vnc flag or install: sudo apt-get install xvfb x11vnc'
      };
    }

    if (msg.includes('not found') || msg.includes('waiting for locator') ||
        msg.includes('strict mode violation') || msg.includes('resolved to') ||
        msg.includes('Timeout') && selector) {
      const hint = snapshot
        ? 'Current page snapshot available in response for element discovery.'
        : 'Run: snapshot to see current page elements, then adjust selector.';
      return {
        error: 'element_not_found',
        message: `Selector '${selector || 'unknown'}' not found on current page.`,
        suggestion: hint
      };
    }

    if (msg.includes('Timeout') || msg.includes('timeout')) {
      return {
        error: 'timeout',
        message: `Action '${action}' timed out.`,
        suggestion: 'Increase --timeout value or verify the page is loading correctly'
      };
    }

    if (msg.includes('net::ERR_') || msg.includes('NS_ERROR_')) {
      return {
        error: 'network_error',
        message: `Network error during '${action}': ${msg.split('\n')[0]}`,
        suggestion: 'Check URL is accessible. If auth is needed, verify session cookies with: session status <name>'
      };
    }

    if (msg.includes('expired')) {
      return {
        error: 'session_expired',
        message: 'Session has expired.',
        suggestion: 'Run: session start <name> to create a new session, then re-authenticate'
      };
    }

    return {
      error: 'action_error',
      message: msg.split('\n')[0],
      suggestion: null
    };
  }

  it('classifies browser closed errors', () => {
    const result = classifyError(new Error('Target page, context or browser has been closed'), { action: 'click' });
    assert.equal(result.error, 'browser_closed');
    assert.ok(result.suggestion.includes('session start'));
  });

  it('classifies no display errors', () => {
    const result = classifyError(new Error('Cannot open display'), { action: 'checkpoint' });
    assert.equal(result.error, 'no_display');
    assert.ok(result.suggestion.includes('--vnc'));
  });

  it('classifies element not found errors', () => {
    const result = classifyError(
      new Error('waiting for locator("role=button[name=Save]")'),
      { action: 'click', selector: 'role=button[name=Save]' }
    );
    assert.equal(result.error, 'element_not_found');
    assert.ok(result.message.includes('role=button'));
    assert.ok(result.suggestion.includes('snapshot'));
  });

  it('includes snapshot hint when snapshot available', () => {
    const result = classifyError(
      new Error('element not found'),
      { action: 'click', selector: '#btn', snapshot: '- button "OK"' }
    );
    assert.equal(result.error, 'element_not_found');
    assert.ok(result.suggestion.includes('snapshot available'));
  });

  it('classifies strict mode violations', () => {
    const result = classifyError(
      new Error('strict mode violation: locator resolved to 3 elements'),
      { action: 'click', selector: 'button' }
    );
    assert.equal(result.error, 'element_not_found');
  });

  it('classifies timeout errors without selector', () => {
    const result = classifyError(new Error('Timeout 30000ms exceeded'), { action: 'goto' });
    assert.equal(result.error, 'timeout');
    assert.ok(result.message.includes('goto'));
  });

  it('classifies network errors', () => {
    const result = classifyError(new Error('net::ERR_NAME_NOT_RESOLVED'), { action: 'goto' });
    assert.equal(result.error, 'network_error');
    assert.ok(result.suggestion.includes('session status'));
  });

  it('classifies session expired errors', () => {
    const result = classifyError(new Error('Session expired'), { action: 'goto' });
    assert.equal(result.error, 'session_expired');
  });

  it('falls back to action_error for unknown errors', () => {
    const result = classifyError(new Error('Something unexpected happened'), { action: 'click' });
    assert.equal(result.error, 'action_error');
    assert.equal(result.suggestion, null);
  });

  it('truncates multi-line error messages', () => {
    const result = classifyError(new Error('First line\nSecond line\nThird line'), { action: 'click' });
    assert.equal(result.message, 'First line');
  });
});

describe('click-wait action recognition', () => {
  it('click-wait is listed in available actions', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes("case 'click-wait':"), 'click-wait case should exist in switch');
  });

  it('--wait-stable flag is supported on click action', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes('opts.waitStable'), '--wait-stable should be parsed as waitStable');
  });
});

describe('macros integration in web-ctl', () => {
  it('web-ctl.js imports macros module', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes("require('./macros')"), 'should import macros');
  });

  it('default case delegates to macro map', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes('macros[action]'), 'default case should check macro map');
  });

  it('help text includes macros section', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes('Macros (higher-level actions):'), 'help should list macros');
  });

  it('error message includes macro names in available actions', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'web-ctl.js'), 'utf8');
    assert.ok(source.includes('...Object.keys(macros)'), 'error should list macro names');
  });
});

describe('waitForStable export', () => {
  it('is exported from browser-launcher', () => {
    const launcher = require('../scripts/browser-launcher');
    assert.equal(typeof launcher.waitForStable, 'function');
  });
});

describe('snapshot option flag parsing', () => {
  const BOOLEAN_FLAGS = new Set([
    '--allow-evaluate', '--no-snapshot', '--wait-stable', '--vnc',
    '--exact', '--accept', '--submit', '--dismiss',
    '--snapshot-collapse', '--snapshot-text-only', '--snapshot-compact',
    '--snapshot-full',
  ]);

  // Replicate parseOptions for unit testing
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

  it('no boolean flag consumes next positional arg', () => {
    assert.ok(BOOLEAN_FLAGS.size > 0, 'BOOLEAN_FLAGS should not be empty');
    for (const flag of BOOLEAN_FLAGS) {
      const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const opts = parseOptions([flag, 'positional-value']);
      assert.equal(opts[key], true, `${flag} should be boolean true`);
    }
  });

  it('non-boolean flags still consume next arg', () => {
    const opts = parseOptions(['--timeout', '5000']);
    assert.equal(opts.timeout, '5000');
  });

  it('boolean flags work alongside value-bearing flags', () => {
    const opts = parseOptions(['--allow-evaluate', '--timeout', '3000', '--no-snapshot']);
    assert.equal(opts.allowEvaluate, true);
    assert.equal(opts.timeout, '3000');
    assert.equal(opts.noSnapshot, true);
  });

  it('parses --snapshot-depth as snapshotDepth', () => {
    const opts = parseOptions(['--snapshot-depth', '3']);
    assert.equal(opts.snapshotDepth, '3');
  });

  it('parses --no-snapshot as noSnapshot boolean', () => {
    const opts = parseOptions(['--no-snapshot']);
    assert.equal(opts.noSnapshot, true);
  });

  it('parses --snapshot-selector as snapshotSelector', () => {
    const opts = parseOptions(['--snapshot-selector', 'css=nav']);
    assert.equal(opts.snapshotSelector, 'css=nav');
  });

  it('parses all three flags together', () => {
    const opts = parseOptions(['--snapshot-depth', '2', '--snapshot-selector', '#main']);
    assert.equal(opts.snapshotDepth, '2');
    assert.equal(opts.snapshotSelector, '#main');
  });

  it('combines snapshot flags with other flags', () => {
    const opts = parseOptions(['--timeout', '5000', '--snapshot-depth', '4', '--no-snapshot']);
    assert.equal(opts.timeout, '5000');
    assert.equal(opts.snapshotDepth, '4');
    assert.equal(opts.noSnapshot, true);
  });

  it('parses --snapshot-max-lines as snapshotMaxLines', () => {
    const opts = parseOptions(['--snapshot-max-lines', '50']);
    assert.equal(opts.snapshotMaxLines, '50');
  });

  it('parses --snapshot-collapse as snapshotCollapse boolean', () => {
    const opts = parseOptions(['--snapshot-collapse']);
    assert.equal(opts.snapshotCollapse, true);
  });

  it('parses --snapshot-text-only as snapshotTextOnly boolean', () => {
    const opts = parseOptions(['--snapshot-text-only']);
    assert.equal(opts.snapshotTextOnly, true);
  });

  it('--snapshot-collapse does not consume next positional arg', () => {
    const opts = parseOptions(['--snapshot-collapse', 'css=nav']);
    assert.equal(opts.snapshotCollapse, true);
    // css=nav should NOT be consumed as the value of --snapshot-collapse
    assert.equal(opts['css=nav'], undefined);
  });

  it('--snapshot-text-only does not consume next positional arg', () => {
    const opts = parseOptions(['--snapshot-text-only', 'css=nav']);
    assert.equal(opts.snapshotTextOnly, true);
  });

  it('parses --snapshot-compact as snapshotCompact boolean', () => {
    const opts = parseOptions(['--snapshot-compact']);
    assert.equal(opts.snapshotCompact, true);
  });

  it('--snapshot-compact does not consume next positional arg', () => {
    const opts = parseOptions(['--snapshot-compact', 'css=nav']);
    assert.equal(opts.snapshotCompact, true);
    assert.equal(opts['css=nav'], undefined);
  });

  it('parses --snapshot-full as snapshotFull boolean', () => {
    const opts = parseOptions(['--snapshot-full']);
    assert.equal(opts.snapshotFull, true);
  });

  it('--snapshot-full does not consume next positional arg', () => {
    const opts = parseOptions(['--snapshot-full', 'css=nav']);
    assert.equal(opts.snapshotFull, true);
    assert.equal(opts['css=nav'], undefined);
  });

  it('combines all new snapshot flags', () => {
    const opts = parseOptions([
      '--snapshot-depth', '3',
      '--snapshot-compact',
      '--snapshot-collapse',
      '--snapshot-text-only',
      '--snapshot-max-lines', '100'
    ]);
    assert.equal(opts.snapshotDepth, '3');
    assert.equal(opts.snapshotCompact, true);
    assert.equal(opts.snapshotCollapse, true);
    assert.equal(opts.snapshotTextOnly, true);
    assert.equal(opts.snapshotMaxLines, '100');
  });

  // Replicate cleanArgs extraction for unit testing
  function extractCleanArgs(args, startIndex) {
    const cleanArgs = [];
    for (let i = startIndex; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        if (args[i + 1] && !args[i + 1].startsWith('--') && !BOOLEAN_FLAGS.has(args[i])) i++;
      } else {
        cleanArgs.push(args[i]);
      }
    }
    return cleanArgs;
  }

  it('cleanArgs extracts positional args after boolean flags', () => {
    const args = ['session', 'evaluate', '--allow-evaluate', 'document.title'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['document.title']);
  });

  it('cleanArgs skips value-bearing flag values', () => {
    const args = ['session', 'click', '--timeout', '5000', 'css=button'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['css=button']);
  });

  it('cleanArgs handles mixed boolean and value flags', () => {
    const args = ['session', 'click', '--wait-stable', '--timeout', '3000', 'css=button'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['css=button']);
  });

  it('cleanArgs handles multiple consecutive boolean flags', () => {
    const args = ['session', 'evaluate', '--allow-evaluate', '--no-snapshot', 'document.body.innerText'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['document.body.innerText']);
  });

  it('cleanArgs handles boolean flag at end of args', () => {
    const args = ['session', 'evaluate', 'code', '--allow-evaluate'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['code']);
  });

  it('cleanArgs handles multiple value-bearing flags', () => {
    const args = ['session', 'click', '--timeout', '5000', '--path', '/tmp/file', 'css=button'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['css=button']);
  });

  it('cleanArgs does not consume positional after --snapshot-collapse', () => {
    const args = ['session', 'snapshot', '--snapshot-collapse', '--snapshot-text-only'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, []);
  });

  it('cleanArgs preserves positional arg after --snapshot-text-only', () => {
    const args = ['session', 'click', '--snapshot-text-only', 'css=button'];
    const cleanArgs = extractCleanArgs(args, 2);
    assert.deepEqual(cleanArgs, ['css=button']);
  });
});

describe('snapshot options in web-ctl source', () => {
  const fs = require('fs');
  const path = require('path');
  const webCtlSource = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    'utf8'
  );

  it('help text contains --snapshot-depth flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-depth'), 'help should document --snapshot-depth');
  });

  it('help text contains --snapshot-selector flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-selector'), 'help should document --snapshot-selector');
  });

  it('help text contains --no-snapshot flag', () => {
    assert.ok(webCtlSource.includes('--no-snapshot'), 'help should document --no-snapshot');
  });

  it('help text contains Snapshot options section', () => {
    assert.ok(webCtlSource.includes('Snapshot options'), 'help should have Snapshot options section');
  });

  it('getSnapshot accepts opts parameter', () => {
    assert.ok(webCtlSource.includes('async function getSnapshot(page, opts'), 'getSnapshot should accept opts');
  });

  it('trimByDepth function exists', () => {
    assert.ok(webCtlSource.includes('function trimByDepth(snapshot, maxDepth)'), 'trimByDepth should be defined');
  });

  it('snapshot action ignores noSnapshot', () => {
    assert.ok(webCtlSource.includes("action === 'snapshot'") && webCtlSource.includes('delete opts.noSnapshot'),
      'snapshot action should delete noSnapshot from opts');
  });

  it('validates snapshotDepth is positive integer', () => {
    assert.ok(webCtlSource.includes('snapshotDepth') && webCtlSource.includes('positive integer'),
      'should validate snapshotDepth');
  });

  it('uses spread pattern for conditional snapshot inclusion', () => {
    assert.ok(webCtlSource.includes('...(snapshot != null && { snapshot })'),
      'should use spread pattern for null snapshot exclusion');
  });

  it('curries getSnapshot for macro helpers', () => {
    assert.ok(webCtlSource.includes('getSnapshot: (page) => getSnapshot(page, opts)'),
      'macro helpers should curry getSnapshot with opts');
  });

  it('trimByLines function exists', () => {
    assert.ok(webCtlSource.includes('function trimByLines(snapshot, maxLines)'), 'trimByLines should be defined');
  });

  it('collapseRepeated function exists', () => {
    assert.ok(webCtlSource.includes('function collapseRepeated(snapshot)'), 'collapseRepeated should be defined');
  });

  it('textOnly function exists', () => {
    assert.ok(webCtlSource.includes('function textOnly(snapshot)'), 'textOnly should be defined');
  });

  it('help text contains --snapshot-max-lines flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-max-lines'), 'help should document --snapshot-max-lines');
  });

  it('help text contains --snapshot-collapse flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-collapse'), 'help should document --snapshot-collapse');
  });

  it('help text contains --snapshot-text-only flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-text-only'), 'help should document --snapshot-text-only');
  });

  it('validates snapshotMaxLines is positive integer', () => {
    assert.ok(webCtlSource.includes('snapshotMaxLines') && webCtlSource.includes('--snapshot-max-lines must be'),
      'should validate snapshotMaxLines');
  });

  it('BOOLEAN_FLAGS includes --snapshot-collapse', () => {
    assert.ok(webCtlSource.includes("'--snapshot-collapse'"), '--snapshot-collapse should be in BOOLEAN_FLAGS');
  });

  it('BOOLEAN_FLAGS includes --snapshot-text-only', () => {
    assert.ok(webCtlSource.includes("'--snapshot-text-only'"), '--snapshot-text-only should be in BOOLEAN_FLAGS');
  });

  it('BOOLEAN_FLAGS includes --snapshot-compact', () => {
    assert.ok(webCtlSource.includes("'--snapshot-compact'"), '--snapshot-compact should be in BOOLEAN_FLAGS');
  });

  it('compactFormat function exists', () => {
    assert.ok(webCtlSource.includes('function compactFormat(snapshot)'), 'compactFormat should be defined');
  });

  it('help text contains --snapshot-compact flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-compact'), 'help should document --snapshot-compact');
  });

  it('getSnapshot pipeline applies all five transforms in order', () => {
    // Verify the pipeline: depth -> compact -> collapse -> text-only -> max-lines
    const depthIdx = webCtlSource.indexOf('opts.snapshotDepth) result = trimByDepth');
    const compactIdx = webCtlSource.indexOf('opts.snapshotCompact) result = compactFormat');
    const collapseIdx = webCtlSource.indexOf('opts.snapshotCollapse) result = collapseRepeated');
    const textOnlyIdx = webCtlSource.indexOf('opts.snapshotTextOnly) result = textOnly');
    const maxLinesIdx = webCtlSource.indexOf('opts.snapshotMaxLines) result = trimByLines');
    assert.ok(depthIdx > 0, 'trimByDepth should be in pipeline');
    assert.ok(compactIdx > depthIdx, 'compactFormat should follow trimByDepth');
    assert.ok(collapseIdx > compactIdx, 'collapseRepeated should follow compactFormat');
    assert.ok(textOnlyIdx > collapseIdx, 'textOnly should follow collapseRepeated');
    assert.ok(maxLinesIdx > textOnlyIdx, 'trimByLines should follow textOnly');
  });

  it('BOOLEAN_FLAGS includes --snapshot-full', () => {
    assert.ok(webCtlSource.includes("'--snapshot-full'"), '--snapshot-full should be in BOOLEAN_FLAGS');
  });

  it('help text contains --snapshot-full flag', () => {
    assert.ok(webCtlSource.includes('--snapshot-full'), 'help should document --snapshot-full');
  });

  it('detectMainContent function exists', () => {
    assert.ok(webCtlSource.includes('async function detectMainContent(page)'), 'detectMainContent should be defined');
  });

  it('detectMainContent handles complementary regions', () => {
    assert.ok(webCtlSource.includes('complementary'), 'detectMainContent should handle complementary regions');
  });
});

describe('web-ctl navigation state persistence', () => {
  const fs = require('fs');
  const path = require('path');
  const webCtlSource = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    'utf8'
  );

  it('saves lastUrl before closeBrowser on success path', () => {
    assert.ok(
      webCtlSource.includes("sessionStore.updateSession(sessionName, { lastUrl: currentUrl })"),
      'web-ctl.js must save lastUrl via updateSession before closing browser'
    );
  });

  it('restores lastUrl for non-goto actions after browser launch', () => {
    assert.ok(
      webCtlSource.includes("action !== 'goto' && session.lastUrl"),
      'web-ctl.js must check for lastUrl and restore it for non-goto actions'
    );
    assert.ok(
      webCtlSource.includes("await page.goto(session.lastUrl"),
      'web-ctl.js must navigate to session.lastUrl on restore'
    );
  });

  it('validates lastUrl before restoring', () => {
    assert.ok(
      webCtlSource.includes("validateUrl(session.lastUrl)"),
      'web-ctl.js must validate lastUrl scheme before navigating'
    );
  });

  it('saves lastUrl in both success and error paths', () => {
    const matches = webCtlSource.match(/sessionStore\.updateSession\(sessionName, \{ lastUrl: currentUrl \}\)/g);
    assert.ok(matches && matches.length >= 2,
      'web-ctl.js must save lastUrl in both success and error paths'
    );
  });
});

describe('auto-create session on first run command', () => {
  const fs = require('fs');
  const path = require('path');
  const webCtlSource = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    'utf8'
  );

  it('runAction calls createSession when session not found', () => {
    assert.ok(
      webCtlSource.includes('sessionStore.createSession(sessionName)'),
      'runAction should call createSession for auto-creation'
    );
  });

  it('sets autoCreated flag on successful auto-creation', () => {
    assert.ok(
      webCtlSource.includes('autoCreated = true'),
      'runAction should set autoCreated = true after creating session'
    );
  });

  it('includes autoCreated in success output', () => {
    assert.ok(
      webCtlSource.includes("...(autoCreated && { autoCreated: true }), result"),
      'success output should conditionally include autoCreated'
    );
  });

  it('includes autoCreated in error output', () => {
    const errorOutputPattern = /\.\.\.\(autoCreated && \{ autoCreated: true \}\),\s*\n\s*\.\.\.classified/;
    assert.ok(
      errorOutputPattern.test(webCtlSource),
      'error output should conditionally include autoCreated before classified'
    );
  });

  it('handles race condition with catch-and-retry', () => {
    assert.ok(
      webCtlSource.includes("err.message.includes('already exists')"),
      'catch block should check for already-exists error'
    );
    const catchBlock = webCtlSource.indexOf("already exists");
    const retryGet = webCtlSource.indexOf('session = sessionStore.getSession(sessionName)', catchBlock);
    assert.ok(retryGet > catchBlock && retryGet - catchBlock < 200,
      'catch block should retry getSession after already-exists error'
    );
  });

  it('uses let instead of const for session variable', () => {
    assert.ok(
      webCtlSource.includes('let session = sessionStore.getSession(sessionName)'),
      'session should be declared with let to allow reassignment'
    );
  });
});

describe('auto-create session CLI integration', () => {
  const { beforeEach, afterEach } = require('node:test');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execFileSync } = require('child_process');

  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ctl-autocreate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCliSafe(...args) {
    try {
      const result = execFileSync(process.execPath, [
        path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
        ...args
      ], {
        env: { ...process.env, AI_STATE_DIR: tmpDir },
        encoding: 'utf8',
        timeout: 10000
      });
      return JSON.parse(result);
    } catch (err) {
      if (err.stdout) {
        try { return JSON.parse(err.stdout); } catch { /* fall through */ }
      }
      throw err;
    }
  }

  it('auto-creates session on run command instead of session_not_found', () => {
    const result = runCliSafe('run', 'newsession', 'goto', 'https://example.com');
    assert.notEqual(result.error, 'session_not_found',
      'run should auto-create session, not return session_not_found');
  });

  it('creates session directory on disk during auto-create', () => {
    runCliSafe('run', 'newsession', 'goto', 'https://example.com');
    const sessionDir = path.join(tmpDir, 'web-ctl', 'sessions', 'newsession');
    assert.ok(fs.existsSync(sessionDir),
      'session directory should exist after auto-create');
    assert.ok(fs.existsSync(path.join(sessionDir, 'metadata.json')),
      'metadata.json should exist after auto-create');
  });

  it('sets autoCreated flag in response', () => {
    const result = runCliSafe('run', 'newsession', 'goto', 'https://example.com');
    assert.equal(result.autoCreated, true,
      'response should include autoCreated: true');
  });

  it('includes autoCreated in response for new session regardless of outcome', () => {
    const result = runCliSafe('run', 'errtest', 'goto', 'https://example.com');
    assert.equal(result.autoCreated, true,
      'response should include autoCreated when session was auto-created');
  });

  it('does not auto-create when session already exists', () => {
    // First call auto-creates
    runCliSafe('run', 'existing', 'goto', 'https://example.com');
    // Second call should reuse the existing session
    const result = runCliSafe('run', 'existing', 'goto', 'https://example.com');
    assert.equal(result.autoCreated, undefined,
      'response should not include autoCreated when session already exists');
  });
});

describe('auth wall detection in goto', () => {
  const fs = require('fs');
  const path = require('path');
  const webCtlSource = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    'utf8'
  );

  it('web-ctl.js imports auth-wall-detect module', () => {
    assert.ok(
      webCtlSource.includes("require('./auth-wall-detect')"),
      'web-ctl.js should require auth-wall-detect'
    );
  });

  it('BOOLEAN_FLAGS includes --no-auth-wall-detect', () => {
    assert.ok(
      webCtlSource.includes("'--no-auth-wall-detect'"),
      '--no-auth-wall-detect should be in BOOLEAN_FLAGS'
    );
  });

  it('auth-wall-detect.js exports detectAuthWall as function', () => {
    const { detectAuthWall } = require('../scripts/auth-wall-detect');
    assert.equal(typeof detectAuthWall, 'function');
  });

  it('goto case calls detectAuthWall', () => {
    assert.ok(
      webCtlSource.includes('detectAuthWall(page, context, url)'),
      'goto case should call detectAuthWall'
    );
  });

  it('goto case checks noAuthWallDetect opt-out', () => {
    assert.ok(
      webCtlSource.includes('opts.noAuthWallDetect'),
      'goto case should check noAuthWallDetect flag'
    );
  });

  it('goto case relaunches headed browser on detection', () => {
    assert.ok(
      webCtlSource.includes('canLaunchHeaded()'),
      'goto case should call canLaunchHeaded on auth wall detection'
    );
    assert.ok(
      webCtlSource.includes("launchBrowser(sessionName, { headless: false })"),
      'goto case should relaunch browser headed'
    );
  });

  it('goto case includes authWallDetected in result', () => {
    assert.ok(
      webCtlSource.includes('authWallDetected: true'),
      'result should include authWallDetected flag'
    );
  });
});

describe('--ensure-auth flag', () => {
  const fs = require('fs');
  const path = require('path');
  const webCtlSource = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    'utf8'
  );

  it('BOOLEAN_FLAGS includes --ensure-auth', () => {
    assert.ok(
      webCtlSource.includes("'--ensure-auth'"),
      '--ensure-auth should be in BOOLEAN_FLAGS'
    );
  });

  it('help text contains --ensure-auth flag', () => {
    assert.ok(
      webCtlSource.includes('--ensure-auth'),
      'help text should document --ensure-auth'
    );
  });

  it('goto case references opts.ensureAuth', () => {
    assert.ok(
      webCtlSource.includes('opts.ensureAuth'),
      'goto case should check ensureAuth flag'
    );
  });

  it('goto case calls checkAuthSuccess when ensureAuth is set', () => {
    // Verify checkAuthSuccess is called within the ensureAuth block
    const ensureAuthIdx = webCtlSource.indexOf('if (opts.ensureAuth)');
    const checkAuthIdx = webCtlSource.indexOf('checkAuthSuccess(page, context, url, { loginUrl: url })', ensureAuthIdx);
    assert.ok(ensureAuthIdx > 0, 'opts.ensureAuth guard should exist');
    assert.ok(checkAuthIdx > ensureAuthIdx, 'checkAuthSuccess should be called after ensureAuth check');
  });

  it('result includes ensureAuthCompleted on success path', () => {
    assert.ok(
      webCtlSource.includes('ensureAuthCompleted: true'),
      'success result should include ensureAuthCompleted: true'
    );
  });

  it('result includes ensureAuthCompleted on timeout path', () => {
    assert.ok(
      webCtlSource.includes('ensureAuthCompleted: false'),
      'timeout result should include ensureAuthCompleted: false'
    );
  });

  it('timeout result includes descriptive message', () => {
    assert.ok(
      webCtlSource.includes('Auth did not complete within timeout'),
      'timeout path should include descriptive message'
    );
  });

  it('no-display path returns ensureAuthCompleted false', () => {
    assert.ok(
      webCtlSource.includes('no display available for headed browser'),
      'no-display path should include descriptive message when ensureAuth is set'
    );
  });

  it('ensureAuth overrides noAuthWallDetect in guard condition', () => {
    assert.ok(
      webCtlSource.includes('opts.ensureAuth || !opts.noAuthWallDetect'),
      'guard should allow ensureAuth to override noAuthWallDetect'
    );
  });

  it('relaunches headless browser after auth success', () => {
    const ensureAuthIdx = webCtlSource.indexOf('if (opts.ensureAuth)');
    const headlessRelaunch = webCtlSource.indexOf("launchBrowser(sessionName, { headless: true })", ensureAuthIdx);
    assert.ok(headlessRelaunch > ensureAuthIdx, 'should relaunch headless browser after successful auth');
  });

  it('polls at 2s intervals', () => {
    assert.ok(
      webCtlSource.includes('const pollInterval = 2000'),
      'poll interval should be 2000ms'
    );
  });

  it('checks page.isClosed() before polling', () => {
    const ensureAuthIdx = webCtlSource.indexOf('if (opts.ensureAuth)');
    const isClosedIdx = webCtlSource.indexOf('page.isClosed()', ensureAuthIdx);
    assert.ok(isClosedIdx > ensureAuthIdx, 'should check page.isClosed() in polling loop');
  });

  it('wraps checkAuthSuccess in try-catch during polling', () => {
    const ensureAuthIdx = webCtlSource.indexOf('if (opts.ensureAuth)');
    const nextCheckpoint = webCtlSource.indexOf('} else {', ensureAuthIdx + 200);
    const pollBlock = webCtlSource.slice(ensureAuthIdx, nextCheckpoint);
    assert.ok(
      pollBlock.includes('try {') && pollBlock.includes('checkAuthSuccess'),
      'checkAuthSuccess should be wrapped in try-catch within polling loop'
    );
  });

  it('guards closeBrowser with context null check on normal exit', () => {
    assert.ok(
      webCtlSource.includes('if (context) await closeBrowser(sessionName, context)'),
      'normal exit should guard closeBrowser with context null check'
    );
  });
});

describe('--ensure-auth flag parsing', () => {
  const BOOLEAN_FLAGS = new Set([
    '--allow-evaluate', '--no-snapshot', '--wait-stable', '--vnc',
    '--exact', '--accept', '--submit', '--dismiss', '--auto',
    '--snapshot-collapse', '--snapshot-text-only', '--snapshot-compact',
    '--snapshot-full', '--no-auth-wall-detect', '--ensure-auth',
  ]);

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

  it('--ensure-auth parses as boolean true', () => {
    const opts = parseOptions(['--ensure-auth']);
    assert.equal(opts.ensureAuth, true);
  });

  it('--ensure-auth does not consume next positional arg', () => {
    const opts = parseOptions(['--ensure-auth', 'https://example.com']);
    assert.equal(opts.ensureAuth, true);
    assert.equal(opts['https://example.com'], undefined);
  });

  it('--ensure-auth works alongside --timeout', () => {
    const opts = parseOptions(['--ensure-auth', '--timeout', '60']);
    assert.equal(opts.ensureAuth, true);
    assert.equal(opts.timeout, '60');
  });

  it('--ensure-auth works alongside --no-auth-wall-detect', () => {
    const opts = parseOptions(['--ensure-auth', '--no-auth-wall-detect']);
    assert.equal(opts.ensureAuth, true);
    assert.equal(opts.noAuthWallDetect, true);
  });
});

describe('--ensure-auth CLI integration', () => {
  const { beforeEach, afterEach } = require('node:test');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execFileSync } = require('child_process');

  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ctl-ensure-auth-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCliSafe(...args) {
    try {
      const result = execFileSync(process.execPath, [
        path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
        ...args
      ], {
        env: { ...process.env, AI_STATE_DIR: tmpDir },
        encoding: 'utf8',
        timeout: 15000
      });
      return JSON.parse(result);
    } catch (err) {
      if (err.stdout) {
        try { return JSON.parse(err.stdout); } catch { /* fall through */ }
      }
      throw err;
    }
  }

  it('goto with --ensure-auth against example.com runs without error', () => {
    const result = runCliSafe('run', 'authtest', 'goto', 'https://example.com', '--ensure-auth');
    assert.ok(result, 'should return a result');
    assert.notEqual(result.error, 'invalid_flag',
      '--ensure-auth should not cause an invalid flag error');
  });
});
