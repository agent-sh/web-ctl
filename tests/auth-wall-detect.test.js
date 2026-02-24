'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectAuthWall,
  AUTH_URL_PATTERNS,
  AUTH_DOM_SELECTORS,
  AUTH_TEXT_PATTERNS
} = require('../scripts/auth-wall-detect');

// --- Mock helpers ---

function mockPage({ url, selectors, bodyText } = {}) {
  return {
    url: () => url || 'about:blank',
    $: async (sel) => (selectors && selectors.includes(sel)) ? {} : null,
    textContent: async (sel) => sel === 'body' ? (bodyText || '') : ''
  };
}

function mockContext({ cookies } = {}) {
  return {
    cookies: async () => cookies || []
  };
}

// --- Tests ---

describe('detectAuthWall', () => {

  it('returns detected: false when no cookies for target domain', async () => {
    const page = mockPage({ url: 'https://github.com/login' });
    const context = mockContext({ cookies: [] });
    const result = await detectAuthWall(page, context, 'https://github.com/dashboard');
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'no_domain_cookies');
  });

  it('returns detected: false when cookies exist but URL not auth pattern', async () => {
    const page = mockPage({ url: 'https://github.com/settings/profile' });
    const context = mockContext({ cookies: [{ domain: '.github.com', name: 'session', value: 'abc' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/settings/profile');
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'url_not_auth_pattern');
  });

  it('returns detected: false when cookies + URL match but no auth DOM elements', async () => {
    const page = mockPage({
      url: 'https://github.com/login',
      selectors: [],
      bodyText: 'Welcome to the dashboard'
    });
    const context = mockContext({ cookies: [{ domain: '.github.com', name: 'session', value: 'abc' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/dashboard');
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'no_auth_elements');
  });

  it('returns detected: true when all three heuristics match (selector)', async () => {
    const page = mockPage({
      url: 'https://github.com/login',
      selectors: ['input[type="password"]']
    });
    const context = mockContext({ cookies: [{ domain: '.github.com', name: 'session', value: 'abc' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/dashboard');
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'auth_wall');
    assert.equal(result.details.hasDomainCookies, true);
    assert.equal(result.details.authUrlPattern, 'login');
    assert.equal(result.details.domElement, 'input[type="password"]');
  });

  it('returns detected: true when cookies + URL + text pattern match', async () => {
    const page = mockPage({
      url: 'https://accounts.google.com/signin',
      selectors: [],
      bodyText: 'Sign in to continue to Google Drive'
    });
    const context = mockContext({ cookies: [{ domain: '.google.com', name: 'NID', value: 'xyz' }] });
    const result = await detectAuthWall(page, context, 'https://drive.google.com');
    assert.equal(result.detected, true);
    assert.equal(result.reason, 'auth_wall');
    assert.equal(result.details.domElement, 'sign in');
  });

  it('matches each AUTH_URL_PATTERNS entry', async () => {
    for (const pattern of AUTH_URL_PATTERNS) {
      const page = mockPage({
        url: `https://example.com/${pattern}/page`,
        selectors: ['input[type="password"]']
      });
      const context = mockContext({ cookies: [{ domain: '.example.com', name: 's', value: 'v' }] });
      const result = await detectAuthWall(page, context, 'https://example.com/app');
      assert.equal(result.detected, true, `Should detect auth wall for URL pattern: ${pattern}`);
      assert.equal(result.details.authUrlPattern, pattern);
    }
  });

  it('cookie domain matching: parent domain (.github.com matches github.com)', async () => {
    const page = mockPage({
      url: 'https://github.com/login',
      selectors: ['input[type="password"]']
    });
    const context = mockContext({ cookies: [{ domain: '.github.com', name: 's', value: 'v' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/dashboard');
    assert.equal(result.detected, true);
  });

  it('cookie domain matching: exact match', async () => {
    const page = mockPage({
      url: 'https://github.com/login',
      selectors: ['input[type="password"]']
    });
    const context = mockContext({ cookies: [{ domain: 'github.com', name: 's', value: 'v' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/dashboard');
    assert.equal(result.detected, true);
  });

  it('detects Google accounts.google.com', async () => {
    const page = mockPage({
      url: 'https://accounts.google.com/v3/chooser',
      selectors: ['input[name="email"][type="email"]'],
      bodyText: 'Choose an account to continue'
    });
    const context = mockContext({ cookies: [{ domain: '.google.com', name: 'NID', value: 'abc' }] });
    const result = await detectAuthWall(page, context, 'https://mail.google.com');
    assert.equal(result.detected, true);
    assert.equal(result.details.authUrlPattern, 'accounts');
  });

  it('detects Microsoft login.microsoftonline.com', async () => {
    const page = mockPage({
      url: 'https://login.microsoftonline.com/common/oauth2/authorize',
      selectors: ['input[name="username"]'],
      bodyText: 'Pick an account'
    });
    const context = mockContext({ cookies: [{ domain: '.microsoftonline.com', name: 'buid', value: 'abc' }] });
    const result = await detectAuthWall(page, context, 'https://portal.microsoftonline.com/dashboard');
    assert.equal(result.detected, true);
    assert.equal(result.details.authUrlPattern, 'login');
  });

  it('does NOT detect on settings/password-change pages (no auth URL pattern)', async () => {
    const page = mockPage({
      url: 'https://github.com/settings/security',
      selectors: ['input[type="password"]'],
      bodyText: 'Enter your password to confirm changes'
    });
    const context = mockContext({ cookies: [{ domain: '.github.com', name: 's', value: 'v' }] });
    const result = await detectAuthWall(page, context, 'https://github.com/settings/security');
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'url_not_auth_pattern');
  });

  it('handles page.$() error gracefully', async () => {
    const page = {
      url: () => 'https://example.com/login',
      $: async () => { throw new Error('Frame detached'); },
      textContent: async () => 'Sign in to your account'
    };
    const context = mockContext({ cookies: [{ domain: '.example.com', name: 's', value: 'v' }] });
    const result = await detectAuthWall(page, context, 'https://example.com/app');
    assert.equal(result.detected, true);
    assert.equal(result.details.domElement, 'sign in');
  });

  it('handles page.textContent() error gracefully', async () => {
    const page = {
      url: () => 'https://example.com/login',
      $: async () => null,
      textContent: async () => { throw new Error('Frame detached'); }
    };
    const context = mockContext({ cookies: [{ domain: '.example.com', name: 's', value: 'v' }] });
    const result = await detectAuthWall(page, context, 'https://example.com/app');
    assert.equal(result.detected, false);
    assert.equal(result.reason, 'no_auth_elements');
  });

  it('exported constants are arrays', () => {
    assert.ok(Array.isArray(AUTH_URL_PATTERNS), 'AUTH_URL_PATTERNS should be an array');
    assert.ok(Array.isArray(AUTH_DOM_SELECTORS), 'AUTH_DOM_SELECTORS should be an array');
    assert.ok(Array.isArray(AUTH_TEXT_PATTERNS), 'AUTH_TEXT_PATTERNS should be an array');
    assert.ok(AUTH_URL_PATTERNS.length > 0, 'AUTH_URL_PATTERNS should not be empty');
    assert.ok(AUTH_DOM_SELECTORS.length > 0, 'AUTH_DOM_SELECTORS should not be empty');
    assert.ok(AUTH_TEXT_PATTERNS.length > 0, 'AUTH_TEXT_PATTERNS should not be empty');
  });
});
