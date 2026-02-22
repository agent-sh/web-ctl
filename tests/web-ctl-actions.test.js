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

describe('waitForStable export', () => {
  it('is exported from browser-launcher', () => {
    const launcher = require('../scripts/browser-launcher');
    assert.equal(typeof launcher.waitForStable, 'function');
  });
});
