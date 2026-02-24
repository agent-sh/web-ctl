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
    if (opts.snapshotCompact) result = compactFormat(result);
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

  const typeRe = /^- (\S+)/;
  const parsed = lines.map(line => {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);
    const content = line.slice(spaces);
    const typeMatch = content.match(typeRe);
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
          for (const cl of childLines) out.push(cl);
        }
        const collapsed = siblings.length - 2;
        const safeDepth = Math.min(current.depth, 500);
        const indent = ' '.repeat(safeDepth * 2);
        out.push(`${indent}- ... (${collapsed} more ${current.type})`);
      } else {
        for (let s = 0; s < siblings.length; s++) {
          out.push(parsed[siblings[s].start].raw);
          const childLines = processRange(siblings[s].start + 1, siblings[s].end);
          for (const cl of childLines) out.push(cl);
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
  const typeRe = /^- (\S+)/;

  for (const line of lines) {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);
    const typeMatch = content.match(typeRe);
    const type = typeMatch ? typeMatch[1] : null;
    const hasLabel = content.includes('"');

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
    const safeDepth = Math.min(outputDepth, 500);
    const indent = ' '.repeat(safeDepth * 2);
    result.push(`${indent}${entry.content}`);
  }

  return result.join('\n');
}

// Keep this in sync with scripts/web-ctl.js.
function compactFormat(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  let lines = snapshot.split('\n');

  // --- Pass 1: Link collapsing ---
  const linkCollapsed = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    const linkMatch = content.match(/^- link "([^"]+)":/);
    if (linkMatch) {
      const parentDepth = Math.floor(spaces / 2);

      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        let cs = 0;
        while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
        if (Math.floor(cs / 2) > parentDepth) {
          children.push({ index: j, line: lines[j], depth: Math.floor(cs / 2) });
          j++;
        } else {
          break;
        }
      }

      const urlChildIdx = children.findIndex(c =>
        c.depth === parentDepth + 1 && c.line.trim().match(/^- \/url: (\S+)/)
      );

      if (urlChildIdx !== -1) {
        const urlMatch = children[urlChildIdx].line.trim().match(/^- \/url: (\S+)/);
        const url = urlMatch[1];
        const otherChildren = children.filter((_, idx) => idx !== urlChildIdx);

        if (otherChildren.length === 0) {
          linkCollapsed.push(`${' '.repeat(spaces)}- link "${linkMatch[1]}" -> ${url}`);
        } else {
          linkCollapsed.push(`${' '.repeat(spaces)}- link "${linkMatch[1]}" -> ${url}:`);
          for (const child of otherChildren) {
            linkCollapsed.push(child.line);
          }
        }
        i = j;
        continue;
      }
    }

    linkCollapsed.push(line);
    i++;
  }
  lines = linkCollapsed;

  // --- Pass 2: Heading inlining ---
  const headingInlined = [];
  i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    const headingMatch = content.match(/^- heading "([^"]+)" \[level=(\d+)\]:/);
    if (headingMatch) {
      const parentDepth = Math.floor(spaces / 2);

      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        let cs = 0;
        while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
        if (Math.floor(cs / 2) > parentDepth) {
          children.push({ index: j, line: lines[j], depth: Math.floor(cs / 2) });
          j++;
        } else {
          break;
        }
      }

      const directChildren = children.filter(c => c.depth === parentDepth + 1);
      if (directChildren.length === 1) {
        const childContent = directChildren[0].line.trim();
        const linkArrowMatch = childContent.match(/^- link "([^"]+)" -> (\S+)$/);
        if (linkArrowMatch) {
          headingInlined.push(`${' '.repeat(spaces)}- heading [h${headingMatch[2]}] "${headingMatch[1]}" -> ${linkArrowMatch[2]}`);
          i = j;
          continue;
        }
        const linkPlainMatch = childContent.match(/^- link "([^"]+)"$/);
        if (linkPlainMatch) {
          headingInlined.push(`${' '.repeat(spaces)}- heading [h${headingMatch[2]}] "${headingMatch[1]}"`);
          i = j;
          continue;
        }
      }
    }

    headingInlined.push(line);
    i++;
  }
  lines = headingInlined;

  // --- Pass 3: Decorative image removal ---
  const imagesFiltered = [];
  i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    const imgMatch = content.match(/^- img(?:\s+"([^"]*)")?/);
    if (imgMatch) {
      const altText = imgMatch[1] || '';
      if (altText.length <= 1) {
        const parentDepth = Math.floor(spaces / 2);
        let j = i + 1;
        while (j < lines.length) {
          let cs = 0;
          while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
          if (Math.floor(cs / 2) > parentDepth) {
            j++;
          } else {
            break;
          }
        }
        i = j;
        continue;
      }
    }

    imagesFiltered.push(line);
    i++;
  }
  lines = imagesFiltered;

  // --- Pass 4: Duplicate URL dedup ---
  const deduped = [];
  const seenUrls = new Map();
  let prevDepth = -1;

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);

    if (depth < prevDepth) {
      for (const [d] of seenUrls) {
        if (d > depth) seenUrls.delete(d);
      }
    }
    prevDepth = depth;

    const urlArrowMatch = line.match(/ -> (\/\S+|https?:\/\/\S+)/);
    if (urlArrowMatch) {
      const url = urlArrowMatch[1];
      if (!seenUrls.has(depth)) seenUrls.set(depth, new Set());
      const depthSet = seenUrls.get(depth);
      if (depthSet.has(url)) {
        let j = i + 1;
        while (j < lines.length) {
          let cs = 0;
          while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
          if (Math.floor(cs / 2) > depth) {
            j++;
          } else {
            break;
          }
        }
        i = j - 1;
        continue;
      }
      depthSet.add(url);
    }

    deduped.push(line);
  }

  return deduped.join('\n');
}

// ============ compactFormat tests ============

describe('compactFormat', () => {
  it('passes through null', () => {
    assert.equal(compactFormat(null), null);
  });

  it('passes through undefined', () => {
    assert.equal(compactFormat(undefined), undefined);
  });

  it('passes through fallback strings starting with (', () => {
    const fallback = '(accessibility tree unavailable - crashed)';
    assert.equal(compactFormat(fallback), fallback);
  });

  it('passes through empty string', () => {
    assert.equal(compactFormat(''), '');
  });

  // --- Link collapsing ---

  it('collapses link with /url child into single line', () => {
    const input = [
      '- link "Home":',
      '  - /url: /home'
    ].join('\n');
    assert.equal(compactFormat(input), '- link "Home" -> /home');
  });

  it('preserves link without /url child', () => {
    const input = '- link "Home"';
    assert.equal(compactFormat(input), input);
  });

  it('keeps extra children when link has /url plus others', () => {
    const input = [
      '- link "Dashboard":',
      '  - /url: /dash',
      '  - img "icon"'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('- link "Dashboard" -> /dash:'));
    assert.ok(result.includes('  - img "icon"'));
    assert.ok(!result.includes('/url:'));
  });

  it('collapses nested link inside a list', () => {
    const input = [
      '- list:',
      '  - listitem:',
      '    - link "About":',
      '      - /url: /about'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('    - link "About" -> /about'));
    assert.ok(!result.includes('/url:'));
  });

  // --- Heading inlining ---

  it('inlines heading with single link child', () => {
    const input = [
      '- heading "Getting Started" [level=2]:',
      '  - link "Getting Started" -> /docs/start'
    ].join('\n');
    const result = compactFormat(input);
    assert.equal(result, '- heading [h2] "Getting Started" -> /docs/start');
  });

  it('preserves heading with multiple children', () => {
    const input = [
      '- heading "Title" [level=1]:',
      '  - link "Link 1"',
      '  - link "Link 2"'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('- heading "Title" [level=1]:'));
    assert.ok(result.includes('  - link "Link 1"'));
    assert.ok(result.includes('  - link "Link 2"'));
  });

  it('preserves heading without level attribute', () => {
    const input = [
      '- heading "Title":',
      '  - link "Click"'
    ].join('\n');
    // No [level=N] means the regex won't match, so heading stays as-is
    assert.equal(compactFormat(input), input);
  });

  it('inlines heading with plain link child (no URL)', () => {
    const input = [
      '- heading "Section" [level=3]:',
      '  - link "Section"'
    ].join('\n');
    const result = compactFormat(input);
    assert.equal(result, '- heading [h3] "Section"');
  });

  // --- Decorative image removal ---

  it('removes img with empty name', () => {
    const input = [
      '- heading "Title"',
      '- img',
      '- link "More"'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(!result.includes('- img'));
    assert.ok(result.includes('- heading "Title"'));
    assert.ok(result.includes('- link "More"'));
  });

  it('removes img with single-char alt text', () => {
    const input = [
      '- img "x"',
      '- paragraph "Content"'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(!result.includes('img'));
    assert.ok(result.includes('paragraph "Content"'));
  });

  it('preserves img with meaningful alt text', () => {
    const input = '- img "Product screenshot"';
    assert.equal(compactFormat(input), input);
  });

  it('removes decorative img and its children', () => {
    const input = [
      '- img "":',
      '  - text "caption"',
      '- link "Next"'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(!result.includes('img'));
    assert.ok(!result.includes('caption'));
    assert.ok(result.includes('- link "Next"'));
  });

  // --- Duplicate URL dedup ---

  it('removes second occurrence of same URL at same depth', () => {
    const input = [
      '- link "Home" -> /home',
      '- link "Home Again" -> /home'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('- link "Home" -> /home'));
    assert.ok(!result.includes('Home Again'));
  });

  it('keeps same URL at different depths', () => {
    const input = [
      '- link "Home" -> /home',
      '- list:',
      '  - link "Home" -> /home'
    ].join('\n');
    const result = compactFormat(input);
    const homeCount = (result.match(/-> \/home/g) || []).length;
    assert.equal(homeCount, 2);
  });

  it('resets dedup tracking when depth decreases', () => {
    const input = [
      '- navigation:',
      '  - link "About" -> /about',
      '- main:',
      '  - link "About" -> /about'
    ].join('\n');
    const result = compactFormat(input);
    const aboutCount = (result.match(/-> \/about/g) || []).length;
    assert.equal(aboutCount, 2, 'URL should appear twice since depth scope reset between nav and main');
  });

  // --- Combination test ---

  it('applies all transforms on realistic page snippet', () => {
    const input = [
      '- navigation "Main":',
      '  - link "Home":',
      '    - /url: /home',
      '  - link "About":',
      '    - /url: /about',
      '  - img ""',
      '- main:',
      '  - heading "Welcome" [level=1]:',
      '    - link "Welcome" -> /home',
      '  - img "x"',
      '  - link "About" -> /about',
      '  - img "Team photo"',
      '  - paragraph "Hello world"'
    ].join('\n');
    const result = compactFormat(input);
    // Links collapsed
    assert.ok(result.includes('  - link "Home" -> /home'));
    assert.ok(result.includes('  - link "About" -> /about'));
    assert.ok(!result.includes('/url:'));
    // Heading inlined (but /home is duplicate at depth 1 from nav, so heading gets deduped)
    // Actually heading is at depth 1, nav links are at depth 1 too, so /home is a dup at depth 1
    // The heading inline fires first (pass 2), then dedup (pass 4) removes the dup
    assert.ok(!result.includes('img ""'), 'empty alt img removed');
    assert.ok(!result.includes('img "x"'), 'single char alt img removed');
    assert.ok(result.includes('img "Team photo"'), 'meaningful alt preserved');
    assert.ok(result.includes('paragraph "Hello world"'));
  });

  // --- Edge cases ---

  it('handles blank lines in input', () => {
    const input = [
      '- link "Home":',
      '  - /url: /home',
      '',
      '- link "About":',
      '  - /url: /about'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('- link "Home" -> /home'));
    assert.ok(result.includes('- link "About" -> /about'));
  });

  it('link collapse feeds into heading inline', () => {
    // Pass 1 collapses link, Pass 2 inlines heading with the collapsed link
    const input = [
      '- heading "Docs" [level=2]:',
      '  - link "Docs":',
      '    - /url: /docs'
    ].join('\n');
    const result = compactFormat(input);
    assert.equal(result, '- heading [h2] "Docs" -> /docs');
  });

  it('deduplicates URLs produced by link collapsing', () => {
    const input = [
      '- link "Home":',
      '  - /url: /home',
      '- link "Home link":',
      '  - /url: /home'
    ].join('\n');
    const result = compactFormat(input);
    assert.ok(result.includes('- link "Home" -> /home'));
    assert.ok(!result.includes('Home link'), 'duplicate URL removed after collapse');
  });
});

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

  it('handles empty string', () => {
    assert.equal(trimByLines('', 1), '');
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

  it('handles empty string', () => {
    assert.equal(collapseRepeated(''), '');
  });

  it('collapses exactly 3 siblings (boundary case)', () => {
    const input = [
      '- listitem',
      '  - link "A"',
      '- listitem',
      '  - link "B"',
      '- listitem',
      '  - link "C"'
    ].join('\n');
    const result = collapseRepeated(input);
    assert.ok(result.includes('link "A"'));
    assert.ok(result.includes('link "B"'));
    assert.ok(!result.includes('link "C"'));
    assert.ok(result.includes('- ... (1 more listitem)'));
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

  it('applies snapshotCompact when set', async () => {
    const snapshot = [
      '- link "Home":',
      '  - /url: /home',
      '- img ""',
      '- heading "News" [level=2]:',
      '  - link "News" -> /news',
      '- paragraph "Content"'
    ].join('\n');
    const result = await getSnapshot(makeMockPage(snapshot), { snapshotCompact: true });
    // Links collapsed
    assert.ok(result.includes('- link "Home" -> /home'));
    assert.ok(!result.includes('/url:'));
    // Decorative img removed
    assert.ok(!result.includes('img ""'));
    // Heading inlined
    assert.ok(result.includes('- heading [h2] "News" -> /news'));
    // Content preserved
    assert.ok(result.includes('paragraph "Content"'));
  });

  it('chains all options together', async () => {
    // depth -> compact -> collapse -> text-only -> max-lines
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
    // After depth 4: all kept (max depth is 3)
    // After collapse: 2 listitem kept + collapse marker + heading
    // After text-only: link "A", link "B", collapse marker, heading "Title"
    // After max-lines 3: first 3 lines + "... (1 more lines)"
    assert.ok(lines.length <= 4, `Expected <= 4 lines, got ${lines.length}`);
    assert.ok(result.includes('link "A"'), 'first kept sibling link should survive');
    assert.ok(result.includes('link "B"'), 'second kept sibling link should survive');
    assert.ok(!result.includes('- main'), 'structural main should be stripped by text-only');
    assert.ok(!result.includes('- list\n'), 'structural list should be stripped by text-only');
  });
});
