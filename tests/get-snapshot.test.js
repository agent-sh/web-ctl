'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// getSnapshot, trimByDepth, trimByLines, collapseRepeated, and textOnly are
// not exported from web-ctl.js (CLI script), so we replicate the functions
// here for unit testing - same pattern as web-ctl-actions.test.js.
// Keep this in sync with scripts/web-ctl.js.

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
    let result = raw;
    if (opts.snapshotDepth) result = trimByDepth(result, opts.snapshotDepth);
    if (opts.snapshotCollapse) result = collapseRepeated(result);
    if (opts.snapshotTextOnly) result = textOnly(result);
    if (opts.snapshotMaxLines) result = trimByLines(result, opts.snapshotMaxLines);
    return result;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[WARN] ariaSnapshot failed:', msg);
    return `(accessibility tree unavailable - ${msg})`;
  }
}

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
      const markerIndent = ' '.repeat(depth * 2);
      result.push(`${markerIndent}- ...`);
      prevCut = true;
    }
  }

  return result.join('\n');
}

function trimByLines(snapshot, maxLines) {
  if (maxLines == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');
  if (lines.length <= maxLines) return snapshot;
  const kept = lines.slice(0, maxLines);
  kept.push(`... (${lines.length - maxLines} more lines)`);
  return kept.join('\n');
}

function collapseRepeated(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');

  const parsed = lines.map(line => {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);
    const content = line.slice(spaces);
    const typeMatch = content.match(/^- (\S+)/);
    const type = typeMatch ? typeMatch[1] : null;
    return { depth, type, raw: line };
  });

  function processRange(start, end) {
    const out = [];
    let i = start;
    while (i < end) {
      const current = parsed[i];
      if (!current.type) {
        out.push(current.raw);
        i++;
        continue;
      }

      const siblings = [];
      let j = i;
      while (j < end) {
        const entry = parsed[j];
        if (j === i || (entry.depth === current.depth && entry.type === current.type)) {
          const siblingStart = j;
          j++;
          while (j < end && parsed[j].depth > current.depth) {
            j++;
          }
          siblings.push({ start: siblingStart, end: j });
        } else {
          break;
        }
      }

      if (siblings.length > 2) {
        for (let s = 0; s < 2; s++) {
          out.push(parsed[siblings[s].start].raw);
          const childLines = processRange(siblings[s].start + 1, siblings[s].end);
          out.push(...childLines);
        }
        const collapsed = siblings.length - 2;
        const indent = ' '.repeat(current.depth * 2);
        out.push(`${indent}- ... (${collapsed} more ${current.type})`);
      } else {
        for (let s = 0; s < siblings.length; s++) {
          out.push(parsed[siblings[s].start].raw);
          const childLines = processRange(siblings[s].start + 1, siblings[s].end);
          out.push(...childLines);
        }
      }
      i = j;
    }
    return out;
  }

  return processRange(0, parsed.length).join('\n');
}

function textOnly(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const STRUCTURAL_TYPES = new Set([
    'list', 'listitem', 'group', 'region', 'main', 'complementary',
    'contentinfo', 'banner', 'form', 'table', 'row', 'grid',
    'generic', 'none', 'presentation', 'separator', 'directory'
  ]);

  const lines = snapshot.split('\n');
  const kept = [];

  for (const line of lines) {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);
    const typeMatch = content.match(/^- (\S+)/);
    const type = typeMatch ? typeMatch[1] : null;
    const hasLabel = /"[^"]*"/.test(content);

    if (!type || !STRUCTURAL_TYPES.has(type) || hasLabel) {
      kept.push({ depth: Math.floor(spaces / 2), raw: line, content });
    }
  }

  if (kept.length === 0) return '';

  const result = [];
  const depthStack = [];

  for (const entry of kept) {
    while (depthStack.length > 0 && depthStack[depthStack.length - 1].originalDepth >= entry.depth) {
      depthStack.pop();
    }

    let outputDepth;
    if (depthStack.length === 0) {
      outputDepth = 0;
    } else {
      outputDepth = depthStack[depthStack.length - 1].outputDepth + 1;
    }

    depthStack.push({ originalDepth: entry.depth, outputDepth });
    const indent = ' '.repeat(outputDepth * 2);
    result.push(`${indent}${entry.content}`);
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

// ============ trimByLines tests ============

describe('trimByLines', () => {
  it('passes through when maxLines is null', () => {
    const input = '- heading "Title"\n- link "Home"';
    assert.equal(trimByLines(input, null), input);
  });

  it('passes through when maxLines is undefined', () => {
    const input = '- heading "Title"\n- link "Home"';
    assert.equal(trimByLines(input, undefined), input);
  });

  it('passes through fallback strings starting with (', () => {
    const fallback = '(accessibility tree unavailable - page crashed)';
    assert.equal(trimByLines(fallback, 1), fallback);
  });

  it('returns all lines when count <= maxLines', () => {
    const input = '- heading "Title"\n- link "Home"';
    assert.equal(trimByLines(input, 5), input);
  });

  it('truncates to N lines and appends marker with correct count', () => {
    const input = [
      '- heading "Title"',
      '- link "Home"',
      '- link "About"',
      '- link "Contact"',
      '- link "Help"'
    ].join('\n');
    const result = trimByLines(input, 2);
    const lines = result.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '- heading "Title"');
    assert.equal(lines[1], '- link "Home"');
    assert.equal(lines[2], '... (3 more lines)');
  });

  it('boundary: maxLines equals exact line count', () => {
    const input = '- heading "Title"\n- link "Home"';
    assert.equal(trimByLines(input, 2), input);
  });

  it('maxLines of 1', () => {
    const input = '- heading "Title"\n- link "Home"\n- link "About"';
    const result = trimByLines(input, 1);
    const lines = result.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], '- heading "Title"');
    assert.equal(lines[1], '... (2 more lines)');
  });
});

// ============ collapseRepeated tests ============

describe('collapseRepeated', () => {
  it('passes through null', () => {
    assert.equal(collapseRepeated(null), null);
  });

  it('passes through undefined', () => {
    assert.equal(collapseRepeated(undefined), undefined);
  });

  it('passes through fallback strings starting with (', () => {
    const fallback = '(accessibility tree unavailable - crashed)';
    assert.equal(collapseRepeated(fallback), fallback);
  });

  it('no change when no siblings repeat', () => {
    const input = [
      '- heading "Title"',
      '- link "Home"',
      '- paragraph "Text"'
    ].join('\n');
    assert.equal(collapseRepeated(input), input);
  });

  it('no change when only 2 siblings of same type', () => {
    const input = [
      '- listitem',
      '  - link "Home"',
      '- listitem',
      '  - link "About"'
    ].join('\n');
    assert.equal(collapseRepeated(input), input);
  });

  it('collapses 5 listitem siblings to 2 + marker', () => {
    const input = [
      '- listitem',
      '  - link "Item 1"',
      '- listitem',
      '  - link "Item 2"',
      '- listitem',
      '  - link "Item 3"',
      '- listitem',
      '  - link "Item 4"',
      '- listitem',
      '  - link "Item 5"'
    ].join('\n');
    const result = collapseRepeated(input);
    const lines = result.split('\n');
    // First 2 siblings with children (4 lines) + marker
    assert.equal(lines.length, 5);
    assert.equal(lines[0], '- listitem');
    assert.equal(lines[1], '  - link "Item 1"');
    assert.equal(lines[2], '- listitem');
    assert.equal(lines[3], '  - link "Item 2"');
    assert.equal(lines[4], '- ... (3 more listitem)');
  });

  it('preserves children of kept siblings', () => {
    const input = [
      '- listitem',
      '  - link "Item 1"',
      '  - text "Description 1"',
      '- listitem',
      '  - link "Item 2"',
      '  - text "Description 2"',
      '- listitem',
      '  - link "Item 3"'
    ].join('\n');
    const result = collapseRepeated(input);
    assert.ok(result.includes('- link "Item 1"'));
    assert.ok(result.includes('- text "Description 1"'));
    assert.ok(result.includes('- link "Item 2"'));
    assert.ok(result.includes('- text "Description 2"'));
    assert.ok(!result.includes('Item 3'));
    assert.ok(result.includes('- ... (1 more listitem)'));
  });

  it('handles multiple separate groups', () => {
    const input = [
      '- listitem',
      '- listitem',
      '- listitem',
      '- heading "Section"',
      '- link "A"',
      '- link "B"',
      '- link "C"'
    ].join('\n');
    const result = collapseRepeated(input);
    assert.ok(result.includes('- ... (1 more listitem)'));
    assert.ok(result.includes('- ... (1 more link)'));
  });

  it('does not collapse different types at same depth', () => {
    const input = [
      '- heading "Title"',
      '- link "Home"',
      '- paragraph "Text"'
    ].join('\n');
    assert.equal(collapseRepeated(input), input);
  });

  it('handles deeply nested repeated siblings', () => {
    const input = [
      '- navigation',
      '  - list',
      '    - listitem',
      '      - link "A"',
      '    - listitem',
      '      - link "B"',
      '    - listitem',
      '      - link "C"',
      '    - listitem',
      '      - link "D"'
    ].join('\n');
    const result = collapseRepeated(input);
    assert.ok(result.includes('- navigation'));
    assert.ok(result.includes('  - list'));
    assert.ok(result.includes('    - listitem'));
    assert.ok(result.includes('      - link "A"'));
    assert.ok(result.includes('      - link "B"'));
    assert.ok(!result.includes('link "C"'));
    assert.ok(!result.includes('link "D"'));
    assert.ok(result.includes('    - ... (2 more listitem)'));
  });
});

// ============ textOnly tests ============

describe('textOnly', () => {
  it('passes through null', () => {
    assert.equal(textOnly(null), null);
  });

  it('passes through undefined', () => {
    assert.equal(textOnly(undefined), undefined);
  });

  it('passes through fallback strings starting with (', () => {
    const fallback = '(accessibility tree unavailable - crashed)';
    assert.equal(textOnly(fallback), fallback);
  });

  it('strips structural nodes (list, listitem, group)', () => {
    const input = [
      '- list',
      '  - listitem',
      '    - link "Home"',
      '  - listitem',
      '    - link "About"'
    ].join('\n');
    const result = textOnly(input);
    assert.ok(!result.includes('- list'));
    assert.ok(!result.includes('- listitem'));
    assert.ok(result.includes('link "Home"'));
    assert.ok(result.includes('link "About"'));
  });

  it('keeps content nodes (heading, link, button, text)', () => {
    const input = [
      '- heading "Title"',
      '- link "Click me"',
      '- button "Submit"',
      '- text "Hello"'
    ].join('\n');
    const result = textOnly(input);
    assert.ok(result.includes('heading "Title"'));
    assert.ok(result.includes('link "Click me"'));
    assert.ok(result.includes('button "Submit"'));
    assert.ok(result.includes('text "Hello"'));
  });

  it('keeps labeled structural nodes (navigation "Main")', () => {
    const input = [
      '- navigation "Main"',
      '  - list',
      '    - listitem',
      '      - link "Home"'
    ].join('\n');
    const result = textOnly(input);
    assert.ok(result.includes('navigation "Main"'), 'labeled structural node should be kept');
    assert.ok(result.includes('link "Home"'));
    assert.ok(!result.includes('- list\n'), 'unlabeled list should be stripped');
  });

  it('re-indents to close gaps', () => {
    const input = [
      '- main',
      '  - list',
      '    - listitem',
      '      - heading "Title"',
      '      - link "More"'
    ].join('\n');
    const result = textOnly(input);
    // After stripping main, list, listitem - heading and link should be at top level
    const lines = result.split('\n');
    assert.equal(lines[0], '- heading "Title"');
    assert.equal(lines[1], '- link "More"');
  });

  it('handles snapshot with only structural nodes', () => {
    const input = [
      '- main',
      '  - list',
      '    - listitem',
      '    - listitem'
    ].join('\n');
    const result = textOnly(input);
    assert.equal(result, '');
  });
});

// ============ getSnapshot pipeline tests ============

describe('getSnapshot pipeline', () => {
  function makeMockPage(snapshot) {
    return {
      locator(selector) {
        return { ariaSnapshot: async () => snapshot };
      }
    };
  }

  it('applies snapshotCollapse when set', async () => {
    const snapshot = [
      '- listitem',
      '  - link "A"',
      '- listitem',
      '  - link "B"',
      '- listitem',
      '  - link "C"'
    ].join('\n');
    const result = await getSnapshot(makeMockPage(snapshot), { snapshotCollapse: true });
    assert.ok(result.includes('- ... (1 more listitem)'));
    assert.ok(!result.includes('link "C"'));
  });

  it('applies snapshotTextOnly when set', async () => {
    const snapshot = [
      '- main',
      '  - list',
      '    - listitem',
      '      - heading "Title"'
    ].join('\n');
    const result = await getSnapshot(makeMockPage(snapshot), { snapshotTextOnly: true });
    assert.ok(result.includes('heading "Title"'));
    assert.ok(!result.includes('- main'));
    assert.ok(!result.includes('- list'));
  });

  it('applies snapshotMaxLines when set', async () => {
    const snapshot = [
      '- heading "Title"',
      '- link "A"',
      '- link "B"',
      '- link "C"',
      '- link "D"'
    ].join('\n');
    const result = await getSnapshot(makeMockPage(snapshot), { snapshotMaxLines: 2 });
    const lines = result.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[2], '... (3 more lines)');
  });

  it('chains all options together', async () => {
    // depth -> collapse -> text-only -> max-lines
    const snapshot = [
      '- main',
      '  - list',
      '    - listitem',
      '      - link "A"',
      '    - listitem',
      '      - link "B"',
      '    - listitem',
      '      - link "C"',
      '  - heading "Title"'
    ].join('\n');
    const result = await getSnapshot(makeMockPage(snapshot), {
      snapshotDepth: 4,
      snapshotCollapse: true,
      snapshotTextOnly: true,
      snapshotMaxLines: 3
    });
    const lines = result.split('\n');
    // After depth 4: all kept (max depth is 3 here)
    // After collapse: 2 listitem + marker + heading
    // After text-only: links from kept listitems + marker + heading
    // After max-lines 3: first 3 lines + marker
    assert.ok(lines.length <= 4, `Expected <= 4 lines, got ${lines.length}`);
  });
});
