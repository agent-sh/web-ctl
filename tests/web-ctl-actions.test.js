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
  // Replicate parseOptions for unit testing
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
