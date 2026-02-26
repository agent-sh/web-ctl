'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectContentBlocked,
  CONTENT_BLOCKED_TEXT_PATTERNS
} = require('../scripts/auth-wall-detect');

// --- Mock helpers ---

function mockPage({ selectors, bodyText, elementTexts, visibleSelectors } = {}) {
  return {
    $: async (sel) => {
      if (selectors && selectors.includes(sel)) {
        const text = (elementTexts && elementTexts[sel]) || '';
        return {
          textContent: async () => text,
          isVisible: async () => (visibleSelectors ? visibleSelectors.includes(sel) : false)
        };
      }
      return null;
    },
    textContent: async (sel) => sel === 'body' ? (bodyText || '') : ''
  };
}

// --- Tests ---

describe('detectContentBlocked', () => {

  it('returns detected: false when page has sufficient content', async () => {
    const page = mockPage({
      selectors: ['[data-testid="primaryColumn"]'],
      elementTexts: { '[data-testid="primaryColumn"]': 'x'.repeat(300) },
      bodyText: 'Lots of content on this page including tweets and posts'
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['[data-testid="primaryColumn"]'],
      contentBlockedIndicators: {
        selectors: ['[data-testid="empty_state_header_text"]'],
        textPatterns: ['something went wrong'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('returns detected: true when provider contentBlockedIndicators.selectors match', async () => {
    const page = mockPage({
      selectors: ['[data-testid="empty_state_header_text"]'],
      bodyText: 'Some page content'
    });
    const result = await detectContentBlocked(page, {
      contentBlockedIndicators: {
        selectors: ['[data-testid="empty_state_header_text"]', '[data-testid="error-detail"]'],
        textPatterns: [],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'provider_blocked_selector');
    assert.equal(result.details.selector, '[data-testid="empty_state_header_text"]');
  });

  it('returns detected: true when provider contentBlockedIndicators.textPatterns match', async () => {
    const page = mockPage({
      bodyText: 'Something went wrong. Try reloading.'
    });
    const result = await detectContentBlocked(page, {
      contentBlockedIndicators: {
        selectors: [],
        textPatterns: ['something went wrong', 'try again'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'provider_blocked_text');
    assert.equal(result.details.pattern, 'something went wrong');
  });

  it('returns detected: true when provider contentSelectors exist but are empty (below threshold)', async () => {
    const page = mockPage({
      selectors: ['[data-testid="primaryColumn"]'],
      elementTexts: { '[data-testid="primaryColumn"]': 'X' },
      bodyText: 'Some page with navigation but no feed content'
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['[data-testid="primaryColumn"]', 'article[data-testid="tweet"]'],
      contentBlockedIndicators: {
        selectors: [],
        textPatterns: [],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'content_empty');
    assert.ok(result.details.contentLength < 200);
    assert.equal(result.details.threshold, 200);
  });

  it('returns detected: true with generic text patterns + short main content', async () => {
    const shortBody = 'Something went wrong';
    const page = mockPage({ bodyText: shortBody });
    const result = await detectContentBlocked(page);
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'generic_blocked_text');
    assert.equal(result.details.pattern, 'something went wrong');
    assert.ok(result.details.bodyLength < 500);
  });

  it('does NOT trigger generic text patterns when body is long', async () => {
    const longBody = 'Something went wrong earlier but here is lots of content. ' + 'x'.repeat(600);
    const page = mockPage({ bodyText: longBody });
    const result = await detectContentBlocked(page);
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('returns detected: true when loading indicators persist (spinner still visible)', async () => {
    const page = mockPage({
      selectors: ['[role="progressbar"]'],
      visibleSelectors: ['[role="progressbar"]'],
      bodyText: 'Loading content...' + 'x'.repeat(600)
    });
    const result = await detectContentBlocked(page);
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'persistent_loader');
    assert.equal(result.details.selector, '[role="progressbar"]');
  });

  it('does NOT trigger on invisible loading indicators', async () => {
    const page = mockPage({
      selectors: ['[role="progressbar"]'],
      visibleSelectors: [],
      bodyText: 'Normal page content with lots of text. ' + 'x'.repeat(600)
    });
    const result = await detectContentBlocked(page);
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('returns detected: false with no options and normal content', async () => {
    const page = mockPage({
      bodyText: 'This is a normal page with plenty of content. ' + 'x'.repeat(600)
    });
    const result = await detectContentBlocked(page);
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('handles page.$() errors gracefully', async () => {
    const page = {
      $: async () => { throw new Error('Frame detached'); },
      textContent: async () => 'Normal page with plenty of content. ' + 'x'.repeat(600)
    };
    const result = await detectContentBlocked(page, {
      contentSelectors: ['div.content'],
      contentBlockedIndicators: {
        selectors: ['div.error'],
        textPatterns: [],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('handles page.textContent() errors gracefully', async () => {
    const page = {
      $: async () => null,
      textContent: async () => { throw new Error('Frame detached'); }
    };
    const result = await detectContentBlocked(page, {
      contentBlockedIndicators: {
        selectors: [],
        textPatterns: ['error'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });

  it('uses default emptyContentThreshold of 200', async () => {
    const page = mockPage({
      selectors: ['div.feed'],
      elementTexts: { 'div.feed': 'x'.repeat(150) },
      bodyText: 'Normal page'
    });
    // No emptyContentThreshold specified - should default to 200
    const result = await detectContentBlocked(page, {
      contentSelectors: ['div.feed'],
      contentBlockedIndicators: {
        selectors: [],
        textPatterns: []
      }
    });
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'content_empty');
    assert.equal(result.details.threshold, 200);
  });

  it('does not flag content_empty when threshold is met', async () => {
    const page = mockPage({
      selectors: ['div.feed'],
      elementTexts: { 'div.feed': 'x'.repeat(250) },
      bodyText: 'Normal page'
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['div.feed'],
      contentBlockedIndicators: {
        selectors: [],
        textPatterns: [],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });
});

describe('detectContentBlocked - X.com-specific', () => {

  it('detects empty feed (primaryColumn exists, no tweets)', async () => {
    const page = mockPage({
      selectors: ['[data-testid="primaryColumn"]'],
      elementTexts: { '[data-testid="primaryColumn"]': 'Home' },
      bodyText: 'Home What is happening?!'
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['[data-testid="primaryColumn"]', 'article[data-testid="tweet"]', '[data-testid="cellInnerDiv"]'],
      contentBlockedIndicators: {
        selectors: ['[data-testid="empty_state_header_text"]', '[data-testid="error-detail"]'],
        textPatterns: ['something went wrong', 'try again', 'content is not available', 'this page is not available'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'content_empty');
  });

  it('detects error state (Something went wrong)', async () => {
    const page = mockPage({
      selectors: ['[data-testid="error-detail"]'],
      bodyText: 'Something went wrong. Try reloading.'
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['[data-testid="primaryColumn"]', 'article[data-testid="tweet"]'],
      contentBlockedIndicators: {
        selectors: ['[data-testid="empty_state_header_text"]', '[data-testid="error-detail"]'],
        textPatterns: ['something went wrong', 'try again'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, true);
    // Should match provider_blocked_selector first (error-detail found)
    assert.equal(result.reason, 'provider_blocked_selector');
    assert.equal(result.details.selector, '[data-testid="error-detail"]');
  });

  it('no false positive when tweets exist', async () => {
    const tweetContent = 'Just posted a long tweet with lots of interesting content about programming. '.repeat(10);
    const page = mockPage({
      selectors: ['[data-testid="primaryColumn"]', 'article[data-testid="tweet"]', '[data-testid="cellInnerDiv"]'],
      elementTexts: {
        '[data-testid="primaryColumn"]': tweetContent,
        'article[data-testid="tweet"]': tweetContent.slice(0, 200),
        '[data-testid="cellInnerDiv"]': tweetContent.slice(0, 200)
      },
      bodyText: 'Home ' + tweetContent
    });
    const result = await detectContentBlocked(page, {
      contentSelectors: ['[data-testid="primaryColumn"]', 'article[data-testid="tweet"]', '[data-testid="cellInnerDiv"]'],
      contentBlockedIndicators: {
        selectors: ['[data-testid="empty_state_header_text"]', '[data-testid="error-detail"]'],
        textPatterns: ['something went wrong', 'try again', 'content is not available', 'this page is not available'],
        emptyContentThreshold: 200
      }
    });
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'content_ok');
  });
});

describe('CONTENT_BLOCKED_TEXT_PATTERNS', () => {

  it('is a non-empty array', () => {
    assert.ok(Array.isArray(CONTENT_BLOCKED_TEXT_PATTERNS));
    assert.ok(CONTENT_BLOCKED_TEXT_PATTERNS.length > 0);
  });

  it('contains expected patterns', () => {
    assert.ok(CONTENT_BLOCKED_TEXT_PATTERNS.includes('something went wrong'));
    assert.ok(CONTENT_BLOCKED_TEXT_PATTERNS.includes('try again'));
    assert.ok(CONTENT_BLOCKED_TEXT_PATTERNS.includes('access denied'));
  });

  it('all entries are lowercase strings', () => {
    for (const pattern of CONTENT_BLOCKED_TEXT_PATTERNS) {
      assert.equal(typeof pattern, 'string');
      assert.equal(pattern, pattern.toLowerCase(), `Pattern "${pattern}" should be lowercase`);
    }
  });
});
