'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, listProviders, resolveAuthOptions } = require('../scripts/auth-providers');
const { checkAuthSuccess } = require('../scripts/auth-check');
const providers = require('../scripts/providers.json');

// ============ providers.json schema ============

describe('providers.json schema', () => {
  it('contains 12 providers', () => {
    assert.equal(providers.length, 12);
  });

  it('every provider has required fields', () => {
    for (const p of providers) {
      assert.ok(p.slug, `missing slug`);
      assert.ok(p.name, `missing name for ${p.slug}`);
      assert.ok(p.loginUrl, `missing loginUrl for ${p.slug}`);
      assert.ok(p.loginUrl.startsWith('https://'), `loginUrl must be https for ${p.slug}`);
    }
  });

  it('every provider has at least one success condition', () => {
    for (const p of providers) {
      const hasCondition = p.successUrl || p.successSelector || p.successCookie;
      assert.ok(hasCondition, `${p.slug} has no success condition`);
    }
  });

  it('slugs are unique', () => {
    const slugs = providers.map(p => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });
});

// ============ getProvider ============

describe('getProvider', () => {
  it('returns provider by slug', () => {
    const p = getProvider('github');
    assert.equal(p.slug, 'github');
    assert.equal(p.name, 'GitHub');
  });

  it('is case insensitive', () => {
    const p = getProvider('GitHub');
    assert.equal(p.slug, 'github');
  });

  it('resolves aliases', () => {
    const p = getProvider('twitter');
    assert.equal(p.slug, 'x');
    assert.equal(p.name, 'X (Twitter)');
  });

  it('resolves aws alias', () => {
    const p = getProvider('aws');
    assert.equal(p.slug, 'aws-console');
  });

  it('returns null for unknown provider', () => {
    assert.equal(getProvider('nonexistent'), null);
  });

  it('returns null for null/undefined', () => {
    assert.equal(getProvider(null), null);
    assert.equal(getProvider(undefined), null);
  });
});

// ============ listProviders ============

describe('listProviders', () => {
  it('returns all 12 providers', () => {
    const list = listProviders();
    assert.equal(list.length, 12);
  });

  it('each entry has slug, name, loginUrl', () => {
    const list = listProviders();
    for (const item of list) {
      assert.ok(item.slug);
      assert.ok(item.name);
      assert.ok(item.loginUrl);
    }
  });

  it('does not leak extra fields', () => {
    const list = listProviders();
    for (const item of list) {
      const keys = Object.keys(item);
      assert.deepEqual(keys.sort(), ['loginUrl', 'name', 'slug']);
    }
  });
});

// ============ resolveAuthOptions ============

describe('resolveAuthOptions', () => {
  it('returns provider defaults when no CLI opts', () => {
    const opts = resolveAuthOptions('github', {});
    assert.equal(opts.url, 'https://github.com/login');
    assert.deepEqual(opts.successCookie, { domain: '.github.com', name: 'logged_in', value: 'yes' });
  });

  it('CLI url overrides provider loginUrl', () => {
    const opts = resolveAuthOptions('github', { url: 'https://github.com/session' });
    assert.equal(opts.url, 'https://github.com/session');
  });

  it('CLI successUrl overrides provider successUrl', () => {
    const opts = resolveAuthOptions('x', { successUrl: 'https://x.com/notifications' });
    assert.equal(opts.successUrl, 'https://x.com/notifications');
  });

  it('throws for unknown provider', () => {
    assert.throws(() => resolveAuthOptions('nonexistent', {}), /Unknown provider/);
  });

  it('passes through CLI opts when no provider', () => {
    const opts = resolveAuthOptions(null, { url: 'https://example.com', timeout: 60 });
    assert.equal(opts.url, 'https://example.com');
    assert.equal(opts.timeout, 60);
  });

  it('includes twoFactorHint from provider', () => {
    const opts = resolveAuthOptions('github', {});
    assert.ok(opts.twoFactorHint);
    assert.ok(opts.twoFactorHint.includes('2FA'));
  });

  it('includes captchaSelectors from provider', () => {
    const opts = resolveAuthOptions('google', {});
    assert.ok(opts.captchaSelectors);
    assert.ok(opts.captchaSelectors.length > 0);
  });
});

// ============ checkAuthSuccess ============

describe('checkAuthSuccess', () => {
  // Mock page object
  function mockPage(url, selectorResult) {
    return {
      url: () => url,
      $: async () => selectorResult ? {
        evaluate: async (fn) => fn({ tagName: 'DIV' })
      } : null
    };
  }

  // Mock context object
  function mockContext(cookies) {
    return {
      cookies: async () => cookies || []
    };
  }

  it('detects success by URL match', async () => {
    const page = mockPage('https://x.com/home');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://x.com/i/flow/login', {
      successUrl: 'https://x.com/home'
    });
    assert.equal(result.success, true);
    assert.equal(result.currentUrl, 'https://x.com/home');
  });

  it('returns false when URL does not match', async () => {
    const page = mockPage('https://x.com/i/flow/login');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://x.com/i/flow/login', {
      successUrl: 'https://x.com/home'
    });
    assert.equal(result.success, false);
  });

  it('detects success by selector match', async () => {
    const page = mockPage('https://example.com/dashboard', true);
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {
      successSelector: '#user-menu'
    });
    assert.equal(result.success, true);
  });

  it('detects success by cookie match', async () => {
    const page = mockPage('https://github.com/something');
    const ctx = mockContext([
      { name: 'logged_in', value: 'yes', domain: '.github.com' }
    ]);
    const result = await checkAuthSuccess(page, ctx, 'https://github.com/login', {
      successCookie: { domain: '.github.com', name: 'logged_in', value: 'yes' }
    });
    assert.equal(result.success, true);
  });

  it('cookie match without value checks name only', async () => {
    const page = mockPage('https://google.com/something');
    const ctx = mockContext([
      { name: 'SAPISID', value: 'abc123', domain: '.google.com' }
    ]);
    const result = await checkAuthSuccess(page, ctx, 'https://accounts.google.com', {
      successCookie: { domain: '.google.com', name: 'SAPISID' }
    });
    assert.equal(result.success, true);
  });

  it('cookie match fails when name does not match', async () => {
    const page = mockPage('https://github.com/something');
    const ctx = mockContext([
      { name: 'other_cookie', value: 'yes', domain: '.github.com' }
    ]);
    const result = await checkAuthSuccess(page, ctx, 'https://github.com/login', {
      successCookie: { domain: '.github.com', name: 'logged_in', value: 'yes' }
    });
    assert.equal(result.success, false);
  });

  it('uses URL-change heuristic when no explicit conditions', async () => {
    const page = mockPage('https://example.com/dashboard');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {});
    assert.equal(result.success, true);
  });

  it('heuristic rejects URLs containing login', async () => {
    const page = mockPage('https://example.com/login/step2');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {});
    assert.equal(result.success, false);
  });

  it('heuristic returns false when URL unchanged', async () => {
    const page = mockPage('https://example.com/login');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {});
    assert.equal(result.success, false);
  });
});
