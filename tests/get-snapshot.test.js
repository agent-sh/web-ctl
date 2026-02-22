'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// getSnapshot is not exported from web-ctl.js (CLI script), so we replicate
// the function here for unit testing - same pattern as web-ctl-actions.test.js.

async function getSnapshot(page) {
  try {
    return await page.locator('body').ariaSnapshot();
  } catch (e) {
    console.error('[WARN] ariaSnapshot failed:', e.message);
    return '(accessibility tree unavailable)';
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

  it('returns fallback when ariaSnapshot throws', async () => {
    const mockPage = {
      locator() {
        return {
          ariaSnapshot: async () => { throw new Error('page crashed'); }
        };
      }
    };
    const result = await getSnapshot(mockPage);
    assert.equal(result, '(accessibility tree unavailable)');
  });

  it('uses body selector not :root', async () => {
    let usedSelector = null;
    const mockPage = {
      locator(selector) {
        usedSelector = selector;
        return { ariaSnapshot: async () => '' };
      }
    };
    await getSnapshot(mockPage);
    assert.equal(usedSelector, 'body');
  });
});
