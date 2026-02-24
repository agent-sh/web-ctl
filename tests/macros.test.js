'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { macros, _internal } = require('../scripts/macros');

describe('macros exports', () => {
  it('exports all 15 macros', () => {
    const expected = [
      'select-option', 'tab-switch', 'modal-dismiss', 'form-fill',
      'search-select', 'date-pick', 'file-upload', 'hover-reveal',
      'scroll-to', 'wait-toast', 'iframe-action', 'login',
      'next-page', 'paginate', 'extract'
    ];
    for (const name of expected) {
      assert.equal(typeof macros[name], 'function', `macro "${name}" should be a function`);
    }
    assert.equal(Object.keys(macros).length, 15, 'should have exactly 15 macros');
  });
});

describe('macro argument validation', () => {
  // Stub helpers and page that won't be reached due to validation errors
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };
  const stubPage = {};

  it('select-option requires trigger and option text', async () => {
    await assert.rejects(
      () => macros['select-option'](stubPage, [], {}, stubHelpers),
      /Usage: select-option/
    );
  });

  it('tab-switch requires tab name', async () => {
    await assert.rejects(
      () => macros['tab-switch'](stubPage, [], {}, stubHelpers),
      /Usage: tab-switch/
    );
  });

  it('form-fill requires --fields', async () => {
    await assert.rejects(
      () => macros['form-fill'](stubPage, [], {}, stubHelpers),
      /Usage: form-fill/
    );
  });

  it('form-fill rejects invalid JSON', async () => {
    await assert.rejects(
      () => macros['form-fill'](stubPage, [], { fields: 'not-json' }, stubHelpers),
      /Invalid JSON/
    );
  });

  it('search-select requires input selector and query', async () => {
    await assert.rejects(
      () => macros['search-select'](stubPage, [], {}, stubHelpers),
      /Usage: search-select/
    );
  });

  it('search-select requires --pick', async () => {
    await assert.rejects(
      () => macros['search-select'](stubPage, ['#input', 'query'], {}, stubHelpers),
      /--pick/
    );
  });

  it('date-pick requires input selector', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, [], {}, stubHelpers),
      /Usage: date-pick/
    );
  });

  it('date-pick requires --date', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], {}, stubHelpers),
      /--date/
    );
  });

  it('file-upload requires selector and file path', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, [], {}, stubHelpers),
      /Usage: file-upload/
    );
  });

  it('hover-reveal requires trigger selector', async () => {
    await assert.rejects(
      () => macros['hover-reveal'](stubPage, [], {}, stubHelpers),
      /Usage: hover-reveal/
    );
  });

  it('hover-reveal requires --click', async () => {
    await assert.rejects(
      () => macros['hover-reveal'](stubPage, ['#trigger'], {}, stubHelpers),
      /--click/
    );
  });

  it('scroll-to requires selector', async () => {
    await assert.rejects(
      () => macros['scroll-to'](stubPage, [], {}, stubHelpers),
      /Usage: scroll-to/
    );
  });

  it('iframe-action requires iframe selector and action', async () => {
    await assert.rejects(
      () => macros['iframe-action'](stubPage, [], {}, stubHelpers),
      /Usage: iframe-action/
    );
  });

  it('iframe-action rejects unknown action', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'dance'], {}, stubHelpers),
      /Unknown iframe action/
    );
  });

  it('login requires --user and --pass', async () => {
    await assert.rejects(
      () => macros['login'](stubPage, [], {}, stubHelpers),
      /Usage: login/
    );
  });

  it('date-pick rejects invalid date format', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2024/01/15' }, stubHelpers),
      /Invalid date format/
    );
  });

  it('date-pick rejects non-date strings', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: 'not-a-date' }, stubHelpers),
      /Invalid date format/
    );
  });

  it('date-pick rejects semantically invalid dates', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2026-02-30' }, stubHelpers),
      /Date out of range/
    );
  });

  it('date-pick rejects month 13', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2026-13-01' }, stubHelpers),
      /Date out of range/
    );
  });

  it('file-upload rejects paths outside allowed directories', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/etc/passwd'], {}, stubHelpers),
      /File path must be within/
    );
  });

  it('file-upload rejects dotfiles even in allowed dirs', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/tmp/.env'], {}, stubHelpers),
      /dotfile/
    );
  });

  it('file-upload rejects home directory paths', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/home/user/.ssh/id_rsa'], {}, stubHelpers),
      /File path must be within/
    );
  });

  it('iframe-action click requires selector', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'click'], {}, stubHelpers),
      /Selector required/
    );
  });

  it('iframe-action fill requires selector and value', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'fill'], {}, stubHelpers),
      /Selector and value required/
    );
  });

  it('iframe-action read requires selector', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'read'], {}, stubHelpers),
      /Selector required/
    );
  });
});

describe('modal-dismiss detection', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    getSnapshot: async () => '(stub)'
  };

  it('throws when no modal is detected', async () => {
    const page = {
      locator: () => ({
        first: () => ({ count: async () => 0, isVisible: async () => false }),
        count: async () => 0
      })
    };
    await assert.rejects(
      () => macros['modal-dismiss'](page, [], {}, stubHelpers),
      /No visible modal detected/
    );
  });
});

describe('wait-toast detection', () => {
  const stubHelpers = {
    getSnapshot: async () => '(stub)'
  };

  it('rejects non-numeric timeout', async () => {
    await assert.rejects(
      () => macros['wait-toast']({}, [], { timeout: 'abc' }, stubHelpers),
      /--timeout must be a positive integer/
    );
  });

  it('throws when no toast appears within timeout', async () => {
    const page = {
      locator: () => ({
        first: () => ({ waitFor: async () => { throw new Error('Timeout'); } })
      })
    };
    await assert.rejects(
      () => macros['wait-toast'](page, [], { timeout: '100' }, stubHelpers),
      /Timeout/
    );
  });
});

describe('next-page detection', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('next-page throws when no pagination detected', async () => {
    const noPageStub = {
      locator: () => ({
        count: async () => 0,
        first: () => ({
          count: async () => 0,
          isVisible: async () => false,
          evaluate: async () => 'div',
          getAttribute: async () => null,
          textContent: async () => ''
        })
      }),
      getByRole: () => ({
        count: async () => 0,
        first: () => ({
          count: async () => 0,
          isVisible: async () => false
        })
      })
    };
    await assert.rejects(
      () => macros['next-page'](noPageStub, [], {}, stubHelpers),
      /No pagination/
    );
  });
});

describe('paginate validation', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };
  const stubPage = {};

  it('paginate requires --selector', async () => {
    await assert.rejects(
      () => macros['paginate'](stubPage, [], {}, stubHelpers),
      /Usage: paginate/
    );
  });

  it('paginate rejects non-numeric --max-pages', async () => {
    await assert.rejects(
      () => macros['paginate'](stubPage, [], { selector: '.item', maxPages: 'abc' }, stubHelpers),
      /Invalid --max-pages/
    );
  });

  it('paginate rejects non-numeric --max-items', async () => {
    await assert.rejects(
      () => macros['paginate'](stubPage, [], { selector: '.item', maxItems: 'abc' }, stubHelpers),
      /Invalid --max-items/
    );
  });
});

// ---------------------------------------------------------------------------
// Pagination success path tests
// ---------------------------------------------------------------------------

/**
 * Factory for mock Playwright page objects used by pagination macros.
 *
 * The mock precisely matches the Playwright locator API surface that
 * detectPaginationLink, nextPage, and paginate actually call:
 *   - page.locator(selector) -> locator
 *   - page.getByRole(role, { name }) -> locator
 *   - locator.count(), .first(), .all()
 *   - element.isVisible(), .evaluate(fn), .getAttribute(attr),
 *     .textContent(), .click()
 *   - page.url(), page.goto(url, opts)
 *
 * Options:
 *   url           - starting page URL
 *   relNext       - { href } for a visible <a rel="next"> link
 *   relNextLink   - { href } for an invisible <link rel="next"> element
 *   roleLink      - { href } for a role="link" match ("Next" text)
 *   roleButton    - truthy to provide a role="button" match (no href)
 *   cssPattern    - { href } for a CSS-pattern pagination link
 *   pageNumber    - { active, containerLinks } for page-number heuristic
 *   items         - Map<selector, string[]> of items per locator selector
 *   pages         - Array<{ items, paginationType }> for multi-page paginate
 */
function createMockPage(options = {}) {
  let currentUrl = options.url || 'https://example.com/page/1';
  let currentPageIndex = 0;

  // Helper: create a locator-like object with zero matches
  function emptyLocator() {
    return {
      count: async () => 0,
      first: () => emptyLocator(),
      all: async () => [],
      isVisible: async () => false,
      evaluate: async () => null,
      getAttribute: async () => null,
      textContent: async () => '',
      click: async () => {},
    };
  }

  // Helper: create a locator-like object wrapping a single visible element
  function visibleElement(attrs = {}) {
    const el = {
      count: async () => 1,
      first: () => el,
      isVisible: async () => true,
      evaluate: async (fn) => {
        // detectPaginationLink calls evaluate(el => el.tagName.toLowerCase())
        // We simulate by returning the tagName stored in attrs.
        return attrs.tagName || 'a';
      },
      getAttribute: async (attr) => {
        if (attr === 'href') return attrs.href ?? null;
        return null;
      },
      textContent: async () => attrs.textContent || '',
      click: async () => {
        if (attrs.onClick) attrs.onClick();
      },
    };
    return el;
  }

  // Exact selector strings used by detectPaginationLink for matching
  const SELECTOR_REL_NEXT = 'a[rel="next"], link[rel="next"]';
  const SELECTOR_CSS_PATTERNS =
    '.pagination a.next, .pagination .next a, .pager-next a, ' +
    'a[aria-label*="next" i], button[aria-label*="next" i], ' +
    '[class*="pagination"] [class*="next"] a';
  const SELECTOR_ACTIVE_PAGE = '[aria-current="page"], .pagination .active, .page-item.active';
  const SELECTOR_PAG_CONTAINER = '.pagination, [role="navigation"], nav[aria-label*="pag" i]';

  // Determine which heuristic selectors should match
  function matchLocator(selector) {
    // Heuristic 1: rel="next" links
    if (selector === SELECTOR_REL_NEXT) {
      if (options.relNext) {
        return {
          count: async () => 1,
          first: () => visibleElement({
            tagName: 'a',
            href: options.relNext.href,
          }),
        };
      }
      if (options.relNextLink) {
        return {
          count: async () => 1,
          first: () => visibleElement({
            tagName: 'link',
            href: options.relNextLink.href,
          }),
        };
      }
      return emptyLocator();
    }

    // Heuristic 3: CSS class/aria-label patterns
    if (selector === SELECTOR_CSS_PATTERNS) {
      if (options.cssPattern) {
        return {
          count: async () => 1,
          first: () => visibleElement({
            tagName: 'a',
            href: options.cssPattern.href,
          }),
        };
      }
      return emptyLocator();
    }

    // Heuristic 4: active page number detection
    if (selector === SELECTOR_ACTIVE_PAGE) {
      if (options.pageNumber) {
        return {
          count: async () => 1,
          first: () => visibleElement({
            textContent: String(options.pageNumber.active),
          }),
        };
      }
      return emptyLocator();
    }

    // Heuristic 4: pagination container
    if (selector === SELECTOR_PAG_CONTAINER) {
      if (options.pageNumber) {
        const container = {
          count: async () => 1,
          first: () => {
            const containerEl = {
              count: async () => 1,
              getByRole: (role, roleOpts) => {
                if (!options.pageNumber.containerLinks) return emptyLocator();
                const target = options.pageNumber.containerLinks[roleOpts.name];
                if (target) {
                  return {
                    count: async () => 1,
                    first: () => visibleElement({
                      tagName: role === 'link' ? 'a' : 'button',
                      href: target.href ?? null,
                      onClick: target.onClick,
                    }),
                  };
                }
                return emptyLocator();
              },
            };
            return containerEl;
          },
        };
        return container;
      }
      return emptyLocator();
    }

    // Item selector for paginate (generic CSS selector like '.item')
    if (options.items && options.items[selector]) {
      const texts = options.items[selector];
      return {
        count: async () => texts.length,
        first: () => visibleElement({ textContent: texts[0] || '' }),
        all: async () => texts.map(text => ({
          textContent: async () => text,
        })),
      };
    }

    return emptyLocator();
  }

  const page = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url; },
    locator: (selector) => matchLocator(selector),
    // Support $$eval for paginate's batch text extraction
    $$eval: async (selector) => {
      if (options.items && options.items[selector]) {
        return options.items[selector].map(t => (t || '').trim()).filter(Boolean);
      }
      return [];
    },
    getByRole: (role, opts) => {
      // Heuristic 2: role-based text matching
      if (options.roleLink && role === 'link') {
        return {
          count: async () => 1,
          first: () => visibleElement({
            tagName: 'a',
            href: options.roleLink.href,
          }),
        };
      }
      if (options.roleButton && role === 'button') {
        let clicked = false;
        return {
          count: async () => 1,
          first: () => visibleElement({
            tagName: 'button',
            href: null,
            onClick: () => { clicked = true; },
          }),
        };
      }
      // Heuristic 2 fallback: if roleLink matches 'button' role or vice versa,
      // the loop tries both 'link' then 'button'. Return empty for non-matching.
      return emptyLocator();
    },
    // Track the current page index for multi-page scenarios
    _advancePage: () => { currentPageIndex++; },
    _setUrl: (url) => { currentUrl = url; },
  };

  return page;
}

describe('next-page success paths', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('detects rel="next" <a> link and navigates via goto', async () => {
    const page = createMockPage({
      url: 'https://example.com/page/1',
      relNext: { href: 'https://example.com/page/2' },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.previousUrl, 'https://example.com/page/1');
    assert.equal(result.url, 'https://example.com/page/2');
    assert.equal(result.nextPageDetected, 'rel-next-a');
    assert.equal(result.snapshot, '(stub)');
  });

  it('detects <link rel="next"> and navigates via goto', async () => {
    const page = createMockPage({
      url: 'https://blog.example.com/posts',
      relNextLink: { href: 'https://blog.example.com/posts?page=2' },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.previousUrl, 'https://blog.example.com/posts');
    assert.equal(result.url, 'https://blog.example.com/posts?page=2');
    assert.equal(result.nextPageDetected, 'rel-next-link');
  });

  it('detects role="link" with "Next" text and navigates via goto', async () => {
    const page = createMockPage({
      url: 'https://example.com/results?p=1',
      roleLink: { href: '/results?p=2' },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.previousUrl, 'https://example.com/results?p=1');
    assert.equal(result.nextPageDetected, 'role-text');
    // role-text with href on an <a> triggers goto
    assert.equal(result.url, '/results?p=2');
  });

  it('detects role="button" with "Next" text and navigates via click', async () => {
    let clicked = false;
    const page = createMockPage({
      url: 'https://spa.example.com/feed',
      roleButton: true,
    });
    // Override getByRole to track clicks precisely
    page.getByRole = (role, opts) => {
      if (role === 'link') {
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) };
      }
      if (role === 'button') {
        const el = {
          count: async () => 1,
          first: () => el,
          isVisible: async () => true,
          evaluate: async () => 'button',
          getAttribute: async () => null,
          click: async () => { clicked = true; },
        };
        return { count: async () => 1, first: () => el };
      }
      return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) };
    };

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(clicked, true, 'should have clicked the button');
    assert.equal(result.nextPageDetected, 'role-text');
    assert.equal(result.previousUrl, 'https://spa.example.com/feed');
  });

  it('detects CSS pattern pagination link and navigates via goto', async () => {
    const page = createMockPage({
      url: 'https://forum.example.com/thread/42',
      cssPattern: { href: '/thread/42?page=2' },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.previousUrl, 'https://forum.example.com/thread/42');
    assert.equal(result.url, '/thread/42?page=2');
    assert.equal(result.nextPageDetected, 'css-pattern');
  });

  it('detects page number heuristic and navigates to page N+1', async () => {
    const page = createMockPage({
      url: 'https://shop.example.com/products?page=3',
      pageNumber: {
        active: 3,
        containerLinks: {
          '4': { href: '/products?page=4' },
        },
      },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.previousUrl, 'https://shop.example.com/products?page=3');
    assert.equal(result.url, '/products?page=4');
    assert.equal(result.nextPageDetected, 'page-number');
  });

  it('prioritizes rel="next" over role-text heuristic', async () => {
    // When both rel="next" and role-based links exist, rel="next" wins
    const page = createMockPage({
      url: 'https://example.com/list',
      relNext: { href: '/list?p=2' },
      roleLink: { href: '/list?page=2' },
    });

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(result.nextPageDetected, 'rel-next-a');
    assert.equal(result.url, '/list?p=2');
  });
});

describe('paginate success paths', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('collects items from a single page when no next page exists', async () => {
    const page = createMockPage({
      url: 'https://example.com/list',
      items: { '.item': ['Item 1', 'Item 2', 'Item 3'] },
    });

    const result = await macros['paginate'](page, [], { selector: '.item' }, stubHelpers);

    assert.equal(result.pages, 1);
    assert.equal(result.totalItems, 3);
    assert.deepEqual(result.items, ['Item 1', 'Item 2', 'Item 3']);
    assert.equal(result.hasMore, false);
    assert.equal(result.startUrl, 'https://example.com/list');
  });

  it('skips empty and whitespace-only text content items', async () => {
    const page = createMockPage({
      url: 'https://example.com/list',
      items: { '.entry': ['Item 1', '', '   ', 'Item 2'] },
    });

    const result = await macros['paginate'](page, [], { selector: '.entry' }, stubHelpers);

    assert.equal(result.totalItems, 2);
    assert.deepEqual(result.items, ['Item 1', 'Item 2']);
  });

  it('respects --max-items limit', async () => {
    const page = createMockPage({
      url: 'https://example.com/list',
      items: { '.card': ['A', 'B', 'C', 'D', 'E'] },
    });

    const result = await macros['paginate'](page, [], {
      selector: '.card',
      maxItems: '3',
    }, stubHelpers);

    assert.equal(result.totalItems, 3);
    assert.deepEqual(result.items, ['A', 'B', 'C']);
    assert.equal(result.hasMore, true);
  });

  it('respects --max-pages limit', async () => {
    // Page has items and a rel="next" link, but max-pages=1 stops after first page
    const page = createMockPage({
      url: 'https://example.com/catalog',
      items: { '.product': ['Prod 1', 'Prod 2'] },
      relNext: { href: '/catalog?page=2' },
    });

    const result = await macros['paginate'](page, [], {
      selector: '.product',
      maxPages: '1',
    }, stubHelpers);

    assert.equal(result.pages, 1);
    assert.equal(result.totalItems, 2);
    assert.equal(result.hasMore, true);
  });

  it('paginates across multiple pages with rel="next" links', async () => {
    // Simulate 3 pages of results. We need to dynamically change what
    // the page returns as items and pagination links as navigation happens.
    let pageIndex = 0;
    const pageData = [
      { items: ['Page1-A', 'Page1-B'], nextHref: 'https://example.com/list?p=2' },
      { items: ['Page2-A', 'Page2-B'], nextHref: 'https://example.com/list?p=3' },
      { items: ['Page3-A'], nextHref: null },
    ];

    let currentUrl = 'https://example.com/list';
    const page = {
      url: () => currentUrl,
      goto: async (url) => {
        currentUrl = url;
        pageIndex++;
      },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.result') return [];
        return data.items.filter(Boolean);
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return {
            count: async () => 0,
            first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }),
            all: async () => [],
          };
        }

        // rel="next" selector
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = {
              count: async () => 1,
              first: () => el,
              isVisible: async () => true,
              evaluate: async () => 'a',
              getAttribute: async (attr) => attr === 'href' ? data.nextHref : null,
              click: async () => {},
            };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }

        // All other selectors (CSS patterns, active page, etc.) - no matches
        return {
          count: async () => 0,
          first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }),
          all: async () => [],
        };
      },
      getByRole: () => ({
        count: async () => 0,
        first: () => ({ count: async () => 0, isVisible: async () => false }),
      }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.result',
      maxPages: '5',
    }, stubHelpers);

    assert.equal(result.pages, 3);
    assert.equal(result.totalItems, 5);
    assert.deepEqual(result.items, ['Page1-A', 'Page1-B', 'Page2-A', 'Page2-B', 'Page3-A']);
    assert.equal(result.hasMore, false);
    assert.equal(result.startUrl, 'https://example.com/list');
  });

  it('stops when max-items is reached across pages', async () => {
    let pageIndex = 0;
    const pageData = [
      { items: ['A', 'B', 'C'], nextHref: 'https://example.com/p2' },
      { items: ['D', 'E', 'F'], nextHref: 'https://example.com/p3' },
      { items: ['G', 'H'], nextHref: null },
    ];

    let currentUrl = 'https://example.com/items';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.row') return [];
        return data.items.filter(Boolean);
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? data.nextHref : null, click: async () => {} };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.row',
      maxItems: '5',
      maxPages: '10',
    }, stubHelpers);

    assert.equal(result.totalItems, 5);
    assert.deepEqual(result.items, ['A', 'B', 'C', 'D', 'E']);
    assert.equal(result.hasMore, true);
    // Should have visited 2 pages (collected 3 on page 1, then 2 more from page 2)
    assert.equal(result.pages, 2);
  });

  it('navigates via click when pagination element is a button', async () => {
    let clickCount = 0;
    let pageIndex = 0;
    const pageData = [
      { items: ['First'], hasNextButton: true },
      { items: ['Second'], hasNextButton: false },
    ];

    let currentUrl = 'https://spa.example.com/data';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.item') return [];
        return data.items.filter(Boolean);
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        // Return empty for all locator-based heuristics (rel, css, active page)
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: (role) => {
        const data = pageData[pageIndex];
        if (!data || !data.hasNextButton) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) };
        }
        // Return a button for 'button' role, empty for 'link'
        if (role === 'link') {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) };
        }
        if (role === 'button') {
          const el = {
            count: async () => 1,
            first: () => el,
            isVisible: async () => true,
            evaluate: async () => 'button',
            getAttribute: async () => null,
            click: async () => { clickCount++; pageIndex++; },
          };
          return { count: async () => 1, first: () => el };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) };
      },
    };

    const result = await macros['paginate'](page, [], {
      selector: '.item',
      maxPages: '5',
    }, stubHelpers);

    assert.equal(clickCount, 1, 'should click the next button once');
    assert.equal(result.pages, 2);
    assert.deepEqual(result.items, ['First', 'Second']);
    assert.equal(result.hasMore, false);
  });

  it('sets hasMore when max-pages is reached with remaining pages', async () => {
    // 2 pages available but max-pages=2 - after visiting 2 pages and finding
    // a next link, should mark hasMore=true
    let pageIndex = 0;
    const pageData = [
      { items: ['P1'], nextHref: 'https://example.com/p2' },
      { items: ['P2'], nextHref: 'https://example.com/p3' },
    ];

    let currentUrl = 'https://example.com/data';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex] || pageData[pageData.length - 1];
        if (selector !== '.r') return [];
        return data.items.filter(Boolean);
      },
      locator: (selector) => {
        const data = pageData[pageIndex] || pageData[pageData.length - 1];
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? data.nextHref : null, click: async () => {} };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.r',
      maxPages: '2',
    }, stubHelpers);

    assert.equal(result.pages, 2);
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.items, ['P1', 'P2']);
  });

  it('defaults max-pages to 5 when not specified', async () => {
    // Provide 7 pages of data but expect only 5 to be visited
    let pageIndex = 0;
    const pageData = Array.from({ length: 7 }, (_, i) => ({
      items: [`Page${i + 1}`],
      nextHref: i < 6 ? `https://example.com/p${i + 2}` : null,
    }));

    let currentUrl = 'https://example.com/long';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.x') return [];
        return data.items.filter(Boolean);
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? data.nextHref : null, click: async () => {} };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.x',
    }, stubHelpers);

    assert.equal(result.pages, 5, 'should default to 5 pages');
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.items, ['Page1', 'Page2', 'Page3', 'Page4', 'Page5']);
  });

  it('returns correct startUrl even after multi-page navigation', async () => {
    let pageIndex = 0;
    let currentUrl = 'https://example.com/start';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        if (selector !== '.z') return [];
        return pageIndex === 0 ? ['Only'] : ['Done'];
      },
      locator: (selector) => {
        if (selector.includes('rel="next"') && pageIndex === 0) {
          const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? 'https://example.com/page2' : null, click: async () => {} };
          return { count: async () => 1, first: () => el };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], { selector: '.z' }, stubHelpers);

    assert.equal(result.startUrl, 'https://example.com/start');
    assert.equal(result.url, 'https://example.com/page2');
    assert.equal(result.pages, 2);
  });
});

// ---------------------------------------------------------------------------
// URL validation (open redirect prevention)
// ---------------------------------------------------------------------------

describe('URL validation in navigation', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('next-page falls back to click for javascript: href', async () => {
    let clicked = false;
    const page = {
      url: () => 'https://example.com/page/1',
      goto: async () => { throw new Error('goto should not be called for javascript: href'); },
      locator: (selector) => {
        if (selector.includes('rel="next"')) {
          const el = {
            count: async () => 1,
            first: () => el,
            isVisible: async () => true,
            evaluate: async () => 'a',
            getAttribute: async (attr) => attr === 'href' ? 'javascript:void(0)' : null,
            click: async () => { clicked = true; },
          };
          return { count: async () => 1, first: () => el };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }) };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(clicked, true, 'should fall back to clicking the element');
    assert.equal(result.nextPageDetected, 'rel-next-a');
  });

  it('next-page falls back to click for data: href', async () => {
    let clicked = false;
    const page = {
      url: () => 'https://example.com/page/1',
      goto: async () => { throw new Error('goto should not be called for data: href'); },
      locator: (selector) => {
        if (selector.includes('rel="next"')) {
          const el = {
            count: async () => 1,
            first: () => el,
            isVisible: async () => true,
            evaluate: async () => 'a',
            getAttribute: async (attr) => attr === 'href' ? 'data:text/html,<h1>evil</h1>' : null,
            click: async () => { clicked = true; },
          };
          return { count: async () => 1, first: () => el };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }) };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(clicked, true, 'should fall back to clicking the element');
    assert.equal(result.nextPageDetected, 'rel-next-a');
  });

  it('paginate falls back to click for javascript: href in pagination loop', async () => {
    let clickCount = 0;
    let pageIndex = 0;
    const pageData = [
      { items: ['A'], hasNext: true },
      { items: ['B'], hasNext: false },
    ];

    const page = {
      url: () => 'https://example.com/list',
      goto: async () => { throw new Error('goto should not be called for javascript: href'); },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.item') return [];
        return data.items;
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        if (selector.includes('rel="next"')) {
          if (data.hasNext) {
            const el = {
              count: async () => 1,
              first: () => el,
              isVisible: async () => true,
              evaluate: async () => 'a',
              getAttribute: async (attr) => attr === 'href' ? 'javascript:loadMore()' : null,
              click: async () => { clickCount++; pageIndex++; },
            };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.item',
      maxPages: '5',
    }, stubHelpers);

    assert.equal(clickCount, 1, 'should click instead of goto');
    assert.equal(result.pages, 2);
    assert.deepEqual(result.items, ['A', 'B']);
  });

  it('next-page uses goto for valid relative href', async () => {
    let gotoUrl = null;
    const page = {
      url: () => 'https://example.com/page/1',
      goto: async (url) => { gotoUrl = url; },
      locator: (selector) => {
        if (selector.includes('rel="next"')) {
          const el = {
            count: async () => 1,
            first: () => el,
            isVisible: async () => true,
            evaluate: async () => 'a',
            getAttribute: async (attr) => attr === 'href' ? '/page/2' : null,
            click: async () => { throw new Error('should not click'); },
          };
          return { count: async () => 1, first: () => el };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }) };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    await macros['next-page'](page, [], {}, stubHelpers);

    assert.equal(gotoUrl, '/page/2', 'should use goto for valid relative URL');
  });
});

// ---------------------------------------------------------------------------
// hasMore logic correctness
// ---------------------------------------------------------------------------

describe('hasMore accuracy', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('hasMore is false when last page has no next link even at maxPages', async () => {
    // Only 2 pages exist, maxPages=2. The last page has no next link.
    // hasMore should be false because there truly are no more pages.
    let pageIndex = 0;
    const pageData = [
      { items: ['P1'], nextHref: 'https://example.com/p2' },
      { items: ['P2'], nextHref: null },
    ];

    let currentUrl = 'https://example.com/data';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.r') return [];
        return data.items;
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? data.nextHref : null, click: async () => {} };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.r',
      maxPages: '2',
    }, stubHelpers);

    assert.equal(result.pages, 2);
    assert.equal(result.hasMore, false, 'hasMore should be false when last page has no next link');
    assert.deepEqual(result.items, ['P1', 'P2']);
  });

  it('hasMore is true when maxPages reached and next page exists', async () => {
    // 3 pages exist, maxPages=2. After visiting 2 pages, a next link exists.
    let pageIndex = 0;
    const pageData = [
      { items: ['P1'], nextHref: 'https://example.com/p2' },
      { items: ['P2'], nextHref: 'https://example.com/p3' },
      { items: ['P3'], nextHref: null },
    ];

    let currentUrl = 'https://example.com/data';
    const page = {
      url: () => currentUrl,
      goto: async (url) => { currentUrl = url; pageIndex++; },
      $$eval: async (selector) => {
        const data = pageData[pageIndex];
        if (!data || selector !== '.r') return [];
        return data.items;
      },
      locator: (selector) => {
        const data = pageData[pageIndex];
        if (!data) {
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
        }
        if (selector.includes('rel="next"')) {
          if (data.nextHref) {
            const el = { count: async () => 1, first: () => el, isVisible: async () => true, evaluate: async () => 'a', getAttribute: async (a) => a === 'href' ? data.nextHref : null, click: async () => {} };
            return { count: async () => 1, first: () => el };
          }
          return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null }) };
        }
        return { count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false, evaluate: async () => null, getAttribute: async () => null, textContent: async () => '' }), all: async () => [] };
      },
      getByRole: () => ({ count: async () => 0, first: () => ({ count: async () => 0, isVisible: async () => false }) }),
    };

    const result = await macros['paginate'](page, [], {
      selector: '.r',
      maxPages: '2',
    }, stubHelpers);

    assert.equal(result.pages, 2);
    assert.equal(result.hasMore, true, 'hasMore should be true when next page exists beyond limit');
    assert.deepEqual(result.items, ['P1', 'P2']);
  });

  it('hasMore is false on a single page with no pagination', async () => {
    const page = createMockPage({
      url: 'https://example.com/single',
      items: { '.item': ['Only item'] },
    });

    const result = await macros['paginate'](page, [], { selector: '.item' }, stubHelpers);

    assert.equal(result.pages, 1);
    assert.equal(result.hasMore, false);
    assert.deepEqual(result.items, ['Only item']);
  });
});

// ---------------------------------------------------------------------------
// Extract macro tests
// ---------------------------------------------------------------------------

describe('extract validation', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };
  const stubPage = {};

  it('rejects when neither --selector nor --auto provided', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], {}, stubHelpers),
      /Usage: extract/
    );
  });

  it('rejects when both --selector and --auto provided', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], { selector: '.item', auto: true }, stubHelpers),
      /Cannot use both/
    );
  });

  it('rejects non-numeric --max-items', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], { selector: '.item', maxItems: 'abc' }, stubHelpers),
      /Invalid --max-items/
    );
  });

  it('rejects --fields with --auto mode', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], { auto: true, fields: 'title,url' }, stubHelpers),
      /--fields is only valid with --selector/
    );
  });
});

describe('extract selector mode', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('rejects field names with special characters', async () => {
    const page = { url: () => 'https://example.com', $$eval: async () => [] };
    await assert.rejects(
      () => macros['extract'](page, [], { selector: '.item', fields: 'title,"];alert(1);//' }, stubHelpers),
      /Invalid field name/
    );
  });

  it('clamps --max-items to minimum of 1', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        const maxItems = args[1];
        assert.equal(maxItems, 1);
        return [{ title: 'Only one' }];
      },
    };

    const result = await macros['extract'](page, [], {
      selector: '.item',
      maxItems: '-5',
    }, stubHelpers);
    assert.equal(result.count, 1);
  });

  it('extracts items from matched elements', async () => {
    const page = {
      url: () => 'https://example.com/blog',
      $$eval: async (selector, fn, args) => {
        // Simulate the browser-side extraction returning items
        assert.equal(selector, '.post');
        return [
          { title: 'First Post', url: '/post/1', text: 'Hello world' },
          { title: 'Second Post', url: '/post/2', text: 'Goodbye world' },
        ];
      },
    };

    const result = await macros['extract'](page, [], { selector: '.post' }, stubHelpers);

    assert.equal(result.mode, 'selector');
    assert.equal(result.selector, '.post');
    assert.equal(result.count, 2);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].title, 'First Post');
    assert.equal(result.url, 'https://example.com/blog');
  });

  it('respects --max-items cap', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        // The fn receives [fields, maxItems, fieldMaxLen]
        // Simulate that browser returns only up to maxItems
        const maxItems = args[1];
        const all = Array.from({ length: 10 }, (_, i) => ({ title: `Item ${i + 1}` }));
        return all.slice(0, maxItems);
      },
    };

    const result = await macros['extract'](page, [], {
      selector: '.card',
      maxItems: '3',
    }, stubHelpers);

    assert.equal(result.count, 3);
    assert.equal(result.items.length, 3);
  });

  it('returns empty items when selector matches nothing', async () => {
    const page = {
      url: () => 'https://example.com/empty',
      $$eval: async () => [],
    };

    const result = await macros['extract'](page, [], { selector: '.nonexistent' }, stubHelpers);

    assert.equal(result.count, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.mode, 'selector');
  });

  it('extracts only specified --fields subset', async () => {
    const page = {
      url: () => 'https://example.com/articles',
      $$eval: async (selector, fn, args) => {
        const fields = args[0];
        assert.deepEqual(fields, ['title', 'author']);
        return [
          { title: 'Article One', author: 'Alice' },
          { title: 'Article Two', author: 'Bob' },
        ];
      },
    };

    const result = await macros['extract'](page, [], {
      selector: '.article',
      fields: 'title,author',
    }, stubHelpers);

    assert.deepEqual(result.fields, ['title', 'author']);
    assert.equal(result.count, 2);
    assert.equal(result.items[0].author, 'Alice');
  });

  it('returns correct metadata', async () => {
    const page = {
      url: () => 'https://example.com/products',
      $$eval: async () => [
        { title: 'Widget', url: '/w/1' },
      ],
    };

    const result = await macros['extract'](page, [], { selector: '.product' }, stubHelpers);

    assert.equal(result.mode, 'selector');
    assert.equal(result.selector, '.product');
    assert.deepEqual(result.fields, ['title', 'url', 'text']);
    assert.equal(result.count, 1);
    assert.equal(result.url, 'https://example.com/products');
    assert.equal(result.snapshot, '(stub)');
  });
});

describe('extract auto-detect mode', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('detects repeated siblings and returns items', async () => {
    const page = {
      url: () => 'https://example.com/feed',
      evaluate: async (fn, maxItems) => {
        // Simulate browser returning detected items
        return {
          items: [
            { title: 'Post A', url: '/a' },
            { title: 'Post B', url: '/b' },
            { title: 'Post C', url: '/c' },
          ],
          selector: 'main > ul > li',
          count: 3,
        };
      },
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.mode, 'auto');
    assert.equal(result.selector, 'main > ul > li');
    assert.equal(result.count, 3);
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].title, 'Post A');
    assert.ok(result.fields.includes('title'));
    assert.ok(result.fields.includes('url'));
  });

  it('throws when no repeated pattern found', async () => {
    const page = {
      url: () => 'https://example.com/about',
      evaluate: async () => {
        return { error: 'No repeated pattern detected on this page.' };
      },
    };

    await assert.rejects(
      () => macros['extract'](page, [], { auto: true }, stubHelpers),
      /No repeated pattern detected/
    );
  });

  it('respects --max-items in auto mode', async () => {
    let receivedCap;
    const page = {
      url: () => 'https://example.com/search',
      evaluate: async (fn, maxItems) => {
        receivedCap = maxItems;
        const items = Array.from({ length: maxItems }, (_, i) => ({ title: `R${i + 1}` }));
        return { items, selector: '#results > div', count: items.length };
      },
    };

    const result = await macros['extract'](page, [], {
      auto: true,
      maxItems: '5',
    }, stubHelpers);

    assert.equal(receivedCap, 5);
    assert.equal(result.count, 5);
    assert.equal(result.items.length, 5);
  });

  it('includes detected selector in result', async () => {
    const page = {
      url: () => 'https://example.com/catalog',
      evaluate: async () => ({
        items: [{ title: 'X' }],
        selector: '#product-list > div.product-card',
        count: 1,
      }),
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.selector, '#product-list > div.product-card');
    assert.equal(result.mode, 'auto');
  });
});

describe('extract auto-detect table mode', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s,
  };

  it('extracts per-column data when table has thead headers', async () => {
    const page = {
      url: () => 'https://example.com/services',
      evaluate: async () => ({
        items: [
          { Service: 'CloudSync', Description: 'File syncing', Integrations: 'Dropbox, S3' },
          { Service: 'AuthGuard', Description: 'OAuth proxy', Integrations: 'Google, GitHub' },
          { Service: 'LogStream', Description: 'Log aggregation', Integrations: 'ELK, Splunk' },
        ],
        selector: 'table.services > tbody > tr',
        count: 3,
      }),
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.mode, 'auto');
    assert.equal(result.count, 3);
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].Service, 'CloudSync');
    assert.equal(result.items[0].Description, 'File syncing');
    assert.equal(result.items[0].Integrations, 'Dropbox, S3');
    assert.equal(result.items[1].Service, 'AuthGuard');
    assert.ok(result.fields.includes('Service'));
    assert.ok(result.fields.includes('Description'));
    assert.ok(result.fields.includes('Integrations'));
  });

  it('falls back to generic extraction when table has no headers', async () => {
    const page = {
      url: () => 'https://example.com/data',
      evaluate: async () => ({
        items: [
          { text: 'row 1 cell A row 1 cell B' },
          { text: 'row 2 cell A row 2 cell B' },
          { text: 'row 3 cell A row 3 cell B' },
        ],
        selector: 'table > tbody > tr',
        count: 3,
      }),
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.mode, 'auto');
    assert.equal(result.count, 3);
    assert.ok(result.items[0].text, 'should have text field for headerless table');
    assert.ok(result.fields.includes('text'));
  });

  it('ignores extra cells beyond header count', async () => {
    const page = {
      url: () => 'https://example.com/wide',
      evaluate: async () => ({
        items: [
          { Name: 'Alice', Role: 'Admin' },
          { Name: 'Bob', Role: 'User' },
          { Name: 'Carol', Role: 'Mod' },
        ],
        selector: 'table > tbody > tr',
        count: 3,
      }),
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.count, 3);
    assert.equal(result.items[0].Name, 'Alice');
    assert.equal(result.items[0].Role, 'Admin');
    // No extra field should appear from the overflow cell
    assert.equal(Object.keys(result.items[0]).length, 2);
  });

  it('extracts url field when a link is present in a table row', async () => {
    const page = {
      url: () => 'https://example.com/links',
      evaluate: async () => ({
        items: [
          { Product: 'Widget', Price: '$10', url: '/products/widget' },
          { Product: 'Gadget', Price: '$25', url: '/products/gadget' },
          { Product: 'Gizmo', Price: '$15', url: '/products/gizmo' },
        ],
        selector: 'table > tbody > tr',
        count: 3,
      }),
    };

    const result = await macros['extract'](page, [], { auto: true }, stubHelpers);

    assert.equal(result.count, 3);
    assert.equal(result.items[0].Product, 'Widget');
    assert.equal(result.items[0].url, '/products/widget');
    assert.ok(result.fields.includes('url'));
    assert.ok(result.fields.includes('Product'));
    assert.ok(result.fields.includes('Price'));
  });
});

// ---------------------------------------------------------------------------
// --max-field-length tests
// ---------------------------------------------------------------------------

describe('extract --max-field-length validation', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };
  const stubPage = {};

  it('rejects non-numeric --max-field-length', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], { selector: '.item', maxFieldLength: 'abc' }, stubHelpers),
      /Invalid --max-field-length/
    );
  });

  it('rejects non-numeric --max-field-length in auto mode', async () => {
    await assert.rejects(
      () => macros['extract'](stubPage, [], { auto: true, maxFieldLength: 'xyz' }, stubHelpers),
      /Invalid --max-field-length/
    );
  });
});

describe('extract --max-field-length selector mode', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('defaults to 500 when --max-field-length not specified', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        assert.equal(args[2], 500, 'fieldMaxLen should default to 500');
        return [{ title: 'Item' }];
      },
    };

    await macros['extract'](page, [], { selector: '.item' }, stubHelpers);
  });

  it('passes custom value through to $$eval', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        assert.equal(args[2], 1000, 'fieldMaxLen should be 1000');
        return [{ title: 'Item' }];
      },
    };

    await macros['extract'](page, [], { selector: '.item', maxFieldLength: '1000' }, stubHelpers);
  });

  it('clamps to max 2000 when value exceeds limit', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        assert.equal(args[2], 2000, 'fieldMaxLen should be clamped to 2000');
        return [{ title: 'Item' }];
      },
    };

    await macros['extract'](page, [], { selector: '.item', maxFieldLength: '5000' }, stubHelpers);
  });

  it('clamps to min 1 when value is negative', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        assert.equal(args[2], 1, 'fieldMaxLen should be clamped to 1');
        return [{ title: 'X' }];
      },
    };

    await macros['extract'](page, [], { selector: '.item', maxFieldLength: '-5' }, stubHelpers);
  });

  it('defaults to 500 when value is zero (falsy)', async () => {
    const page = {
      url: () => 'https://example.com/list',
      $$eval: async (selector, fn, args) => {
        assert.equal(args[2], 500, 'fieldMaxLen should default to 500 for falsy 0');
        return [{ title: 'X' }];
      },
    };

    await macros['extract'](page, [], { selector: '.item', maxFieldLength: '0' }, stubHelpers);
  });
});

describe('extract --max-field-length auto-detect mode', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };

  it('defaults to 500 when --max-field-length not specified', async () => {
    let receivedFieldMax;
    const page = {
      url: () => 'https://example.com/feed',
      evaluate: async (fn, cap, fieldMax) => {
        receivedFieldMax = fieldMax;
        return { items: [{ title: 'Post' }], selector: 'div > article', count: 1 };
      },
    };

    await macros['extract'](page, [], { auto: true }, stubHelpers);
    assert.equal(receivedFieldMax, 500, 'fieldMaxLen should default to 500');
  });

  it('passes custom value as second arg to page.evaluate', async () => {
    let receivedFieldMax;
    const page = {
      url: () => 'https://example.com/feed',
      evaluate: async (fn, cap, fieldMax) => {
        receivedFieldMax = fieldMax;
        return { items: [{ title: 'Post' }], selector: 'div > article', count: 1 };
      },
    };

    await macros['extract'](page, [], { auto: true, maxFieldLength: '1500' }, stubHelpers);
    assert.equal(receivedFieldMax, 1500, 'fieldMaxLen should be 1500');
  });

  it('clamps to max 2000 in auto-detect mode', async () => {
    let receivedFieldMax;
    const page = {
      url: () => 'https://example.com/feed',
      evaluate: async (fn, cap, fieldMax) => {
        receivedFieldMax = fieldMax;
        return { items: [{ title: 'Post' }], selector: 'div > article', count: 1 };
      },
    };

    await macros['extract'](page, [], { auto: true, maxFieldLength: '9999' }, stubHelpers);
    assert.equal(receivedFieldMax, 2000, 'fieldMaxLen should be clamped to 2000');
  });
});

describe('escapeCSS', () => {
  const { escapeCSS } = _internal;

  it('leaves plain alphanumeric strings unchanged', () => {
    assert.equal(escapeCSS('product-list'), 'product-list');
    assert.equal(escapeCSS('main_content'), 'main_content');
  });

  it('escapes dots', () => {
    assert.equal(escapeCSS('col.md-6'), 'col\\.md-6');
  });

  it('escapes spaces', () => {
    assert.equal(escapeCSS('my class'), 'my\\ class');
  });

  it('escapes hash characters', () => {
    assert.equal(escapeCSS('section#intro'), 'section\\#intro');
  });
});

describe('isAutoGeneratedId', () => {
  const { isAutoGeneratedId } = _internal;

  it('detects hex strings', () => {
    assert.equal(isAutoGeneratedId('a1b2c3d4e5'), true);
  });

  it('detects numeric-only IDs', () => {
    assert.equal(isAutoGeneratedId('12345'), true);
  });

  it('detects letter-prefixed hex IDs', () => {
    assert.equal(isAutoGeneratedId('w149aab6b5b5'), true);
  });

  it('detects framework-prefixed IDs', () => {
    assert.equal(isAutoGeneratedId('ext-gen123'), true);
    assert.equal(isAutoGeneratedId('ember456'), true);
    assert.equal(isAutoGeneratedId('yui_3_5_1'), true);
  });

  it('detects colon-containing IDs', () => {
    assert.equal(isAutoGeneratedId(':r0:'), true);
  });

  it('keeps human-readable IDs', () => {
    assert.equal(isAutoGeneratedId('product-list'), false);
    assert.equal(isAutoGeneratedId('main-content'), false);
    assert.equal(isAutoGeneratedId('sidebar'), false);
    assert.equal(isAutoGeneratedId('nav'), false);
    assert.equal(isAutoGeneratedId('section-3'), false);
    assert.equal(isAutoGeneratedId('footer'), false);
  });
});

describe('buildSelector', () => {
  const { buildSelector } = _internal;

  it('uses human ID from single ancestor', () => {
    const ancestors = [{ tagName: 'DIV', id: 'my-id', className: '' }];
    assert.equal(buildSelector(ancestors, 'div'), '#my-id > div');
  });

  it('builds tag.class chain for multiple ancestors without IDs', () => {
    const ancestors = [
      { tagName: 'DIV', id: '', className: 'container' },
      { tagName: 'SECTION', id: '', className: 'main' },
    ];
    assert.equal(buildSelector(ancestors, 'article'), 'section.main > div.container > article');
  });

  it('skips auto-generated IDs and falls back to class/tag', () => {
    const ancestors = [
      { tagName: 'DIV', id: 'a1b2c3d4e5', className: 'wrapper' },
    ];
    assert.equal(buildSelector(ancestors, 'span'), 'div.wrapper > span');
  });

  it('returns body > tag when no ancestors provided', () => {
    assert.equal(buildSelector([], 'ul'), 'body > ul');
  });

  it('limits classes to first 2', () => {
    const ancestors = [
      { tagName: 'DIV', id: '', className: 'a b c d' },
    ];
    const result = buildSelector(ancestors, 'p');
    assert.equal(result, 'div.a.b > p');
  });

  it('never produces double > > in output', () => {
    const ancestors = [
      { tagName: 'MAIN', id: '', className: '' },
      { tagName: 'BODY', id: '', className: '' },
    ];
    const result = buildSelector(ancestors, 'div');
    assert.ok(!result.includes('> >'), 'selector should not contain "> >": ' + result);
  });
});
