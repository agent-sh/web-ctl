'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// getSnapshot and trimByDepth are not exported from web-ctl.js (CLI script),
// so we replicate the functions here for unit testing - same pattern as
// web-ctl-actions.test.js. Keep this in sync with scripts/web-ctl.js.

function resolveSelector(page, selector) {
  if (!selector) return null;
  if (selector.startsWith('role=')) {
    const match = selector.match(/^role=(\w+)(?:\[name=['"](.+)['"]\])?/);
    if (match) {
      const opts = match[2] ? { name: match[2] } : {};
      return page.getByRole(match[1], opts);
    }
  }
  if (selector.startsWith('text=')) return page.getByText(selector.slice(5));
  if (selector.startsWith('css=')) return page.locator(selector.slice(4));
  if (selector.startsWith('#')) return page.locator(selector);
  return page.locator(selector);
}

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

function trimByDepth(snapshot, maxDepth) {
  if (maxDepth == null || maxDepth === undefined) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');
  const result = [];
  let prevCut = false;

  for (const line of lines) {
    const stripped = line.replace(/^ */, '');
    const spaces = line.length - stripped.length;
    const depth = Math.floor(spaces / 2);

    if (depth < maxDepth) {
      result.push(line);
      prevCut = false;
    } else if (!prevCut) {
      const markerIndent = ' '.repeat(depth * 2);
      result.push(`${markerIndent}- ...`);
      prevCut = true;
    }
  }

  return result.join('\n');
}

// ============ trimByDepth tests ============

describe('trimByDepth', () => {
  it('passes through when maxDepth is null', () => {
    const input = '- heading "Title"\n  - link "Home"';
    assert.equal(trimByDepth(input, null), input);
  });

  it('passes through when maxDepth is undefined', () => {
    const input = '- heading "Title"\n  - link "Home"';
    assert.equal(trimByDepth(input, undefined), input);
  });

  it('passes through fallback strings starting with (', () => {
    const fallback = '(accessibility tree unavailable - page crashed)';
    assert.equal(trimByDepth(fallback, 1), fallback);
  });

  it('handles single-line input', () => {
    const input = '- heading "Title"';
    assert.equal(trimByDepth(input, 1), '- heading "Title"');
  });

  it('handles empty string', () => {
    assert.equal(trimByDepth('', 1), '');
  });

  it('trims at depth 1 - keeps only top level', () => {
    const input = [
      '- navigation "Main"',
      '  - link "Home"',
      '  - link "About"',
      '- heading "Title" [level=1]'
    ].join('\n');
    const expected = [
      '- navigation "Main"',
      '  - ...',
      '- heading "Title" [level=1]'
    ].join('\n');
    assert.equal(trimByDepth(input, 1), expected);
  });

  it('trims at depth 2 - keeps two levels', () => {
    const input = [
      '- navigation "Main"',
      '  - list',
      '    - listitem',
      '      - link "Home"',
      '    - listitem',
      '      - link "About"',
      '- heading "Title" [level=1]'
    ].join('\n');
    const expected = [
      '- navigation "Main"',
      '  - list',
      '    - ...',
      '- heading "Title" [level=1]'
    ].join('\n');
    assert.equal(trimByDepth(input, 2), expected);
  });

  it('does not insert duplicate truncation markers for consecutive cut lines', () => {
    const input = [
      '- navigation "Main"',
      '  - link "Home"',
      '  - link "About"',
      '  - link "Contact"'
    ].join('\n');
    const result = trimByDepth(input, 1);
    const markers = result.split('\n').filter(l => l.includes('- ...'));
    assert.equal(markers.length, 1, 'Should have exactly one truncation marker');
  });

  it('inserts separate markers for separate cut blocks', () => {
    const input = [
      '- navigation "Main"',
      '  - link "Home"',
      '- main',
      '  - heading "Title"',
      '  - paragraph "Text"'
    ].join('\n');
    const result = trimByDepth(input, 1);
    const markers = result.split('\n').filter(l => l.includes('- ...'));
    assert.equal(markers.length, 2, 'Should have two truncation markers');
  });

  it('keeps everything when depth exceeds actual depth', () => {
    const input = '- heading "Title"\n  - link "Home"';
    assert.equal(trimByDepth(input, 10), input);
  });
});

// ============ getSnapshot tests ============

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

// ============ getSnapshot with opts tests ============

describe('getSnapshot with opts', () => {
  it('returns null when noSnapshot is true', async () => {
    const mockPage = {
      locator() { throw new Error('should not be called'); }
    };
    const result = await getSnapshot(mockPage, { noSnapshot: true });
    assert.equal(result, null);
  });

  it('scopes to selector when snapshotSelector is set', async () => {
    let usedSelector = null;
    const mockPage = {
      locator(selector) {
        usedSelector = selector;
        return {
          ariaSnapshot: async () => '- link "Nav Link"'
        };
      }
    };
    const result = await getSnapshot(mockPage, { snapshotSelector: 'css=nav' });
    assert.equal(usedSelector, 'nav', 'Should strip css= prefix and use as locator');
    assert.equal(result, '- link "Nav Link"');
  });

  it('trims output when snapshotDepth is set', async () => {
    const mockPage = {
      locator(selector) {
        assert.equal(selector, 'body');
        return {
          ariaSnapshot: async () => '- navigation\n  - link "Home"\n  - link "About"'
        };
      }
    };
    const result = await getSnapshot(mockPage, { snapshotDepth: 1 });
    assert.ok(result.includes('- navigation'));
    assert.ok(result.includes('- ...'));
    assert.ok(!result.includes('link "Home"'));
  });

  it('combines snapshotSelector and snapshotDepth', async () => {
    let usedSelector = null;
    const mockPage = {
      locator(selector) {
        usedSelector = selector;
        return {
          ariaSnapshot: async () => '- list\n  - listitem\n    - link "Item"'
        };
      }
    };
    const result = await getSnapshot(mockPage, {
      snapshotSelector: '#sidebar',
      snapshotDepth: 2
    });
    assert.equal(usedSelector, '#sidebar');
    assert.ok(result.includes('- list'));
    assert.ok(result.includes('- listitem'));
    assert.ok(!result.includes('link "Item"'));
  });

  it('preserves default behavior with empty opts', async () => {
    const mockPage = {
      locator(selector) {
        assert.equal(selector, 'body');
        return {
          ariaSnapshot: async () => '- heading "Title"'
        };
      }
    };
    const result = await getSnapshot(mockPage, {});
    assert.equal(result, '- heading "Title"');
  });

  it('returns fallback even with noSnapshot false when ariaSnapshot fails', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      const mockPage = {
        locator() {
          return {
            ariaSnapshot: async () => { throw new Error('crashed'); }
          };
        }
      };
      const result = await getSnapshot(mockPage, { noSnapshot: false });
      assert.equal(result, '(accessibility tree unavailable - crashed)');
    } finally {
      console.warn = origWarn;
    }
  });
});
