'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// getSnapshot is not exported from web-ctl.js (CLI script), so we replicate
// the function here for unit testing - same pattern as web-ctl-actions.test.js.
// Keep this in sync with scripts/web-ctl.js:getSnapshot.

async function getSnapshot(page) {
  try {
    return await page.locator('body').ariaSnapshot();
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[WARN] ariaSnapshot failed:', msg);
    return `(accessibility tree unavailable - ${msg})`;
  }
}

describe('getSnapshot', () => {
  it('returns aria snapshot from body locator', async () => {
    const mockPage = {
      locator(selector) {
        assert.equal(selector, 'body');
        return {
          ariaSnapshot: async () => '- heading "Example" [level=1]\n- link "More"'
        };
      }
    };
    const result = await getSnapshot(mockPage);
    assert.equal(result, '- heading "Example" [level=1]\n- link "More"');
  });

  it('returns fallback and logs warning when ariaSnapshot throws', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const mockPage = {
        locator() {
          return {
            ariaSnapshot: async () => { throw new Error('page crashed'); }
          };
        }
      };
      const result = await getSnapshot(mockPage);
      assert.equal(result, '(accessibility tree unavailable - page crashed)');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][0], '[WARN] ariaSnapshot failed:');
      assert.equal(warnings[0][1], 'page crashed');
    } finally {
      console.warn = origWarn;
    }
  });

  it('handles non-Error thrown values', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const mockPage = {
        locator() {
          return {
            ariaSnapshot: async () => { throw 'string error'; }
          };
        }
      };
      const result = await getSnapshot(mockPage);
      assert.equal(result, '(accessibility tree unavailable - string error)');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][0], '[WARN] ariaSnapshot failed:');
      assert.equal(warnings[0][1], 'string error');
    } finally {
      console.warn = origWarn;
    }
  });

  it('handles page.locator throwing', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const mockPage = {
        locator() { throw new TypeError('Cannot read properties of null'); }
      };
      const result = await getSnapshot(mockPage);
      assert.equal(result, '(accessibility tree unavailable - Cannot read properties of null)');
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = origWarn;
    }
  });
});
