'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getProvider, listProviders, resolveAuthOptions, loadCustomProviders } = require('../scripts/auth-providers');
const { checkAuthSuccess } = require('../scripts/auth-check');
const providers = require('../scripts/providers.json');

// ============ providers.json schema ============

describe('providers.json schema', () => {
  it('contains at least 24 providers', () => {
    assert.ok(providers.length >= 24, `expected >= 24 providers, got ${providers.length}`);
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
      const hasCondition = p.successUrl || p.successSelector || p.successCookie || p.successLocalStorage;
      assert.ok(hasCondition, `${p.slug} has no success condition`);
    }
  });

  it('every provider has a flowType', () => {
    const validFlowTypes = ['single-step', 'multi-step', 'magic-link', 'spa'];
    for (const p of providers) {
      assert.ok(p.flowType, `${p.slug} missing flowType`);
      assert.ok(validFlowTypes.includes(p.flowType), `${p.slug} has invalid flowType: ${p.flowType}`);
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

  it('resolves new provider aliases', () => {
    assert.equal(getProvider('ig').slug, 'instagram');
    assert.equal(getProvider('fb').slug, 'facebook');
    assert.equal(getProvider('meta').slug, 'facebook');
    assert.equal(getProvider('openai').slug, 'chatgpt');
    assert.equal(getProvider('hn').slug, 'hackernews');
    assert.equal(getProvider('ycombinator').slug, 'hackernews');
    assert.equal(getProvider('so').slug, 'stackoverflow');
    assert.equal(getProvider('stackexchange').slug, 'stackoverflow');
    assert.equal(getProvider('bb').slug, 'bitbucket');
    assert.equal(getProvider('npmjs').slug, 'npm');
    assert.equal(getProvider('docker').slug, 'dockerhub');
    assert.equal(getProvider('dev').slug, 'devto');
  });

  it('finds new providers by slug', () => {
    const newSlugs = ['instagram', 'facebook', 'chatgpt', 'devto', 'hackernews',
      'stackoverflow', 'vercel', 'netlify', 'jira', 'bitbucket', 'npm', 'dockerhub'];
    for (const slug of newSlugs) {
      const p = getProvider(slug);
      assert.ok(p, `provider ${slug} not found`);
      assert.equal(p.slug, slug);
    }
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
  it('returns all providers', () => {
    const list = listProviders();
    assert.equal(list.length, providers.length);
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
    assert.ok(opts.twoFactorHint.includes('TOTP'));
  });

  it('includes captchaSelectors from provider', () => {
    const opts = resolveAuthOptions('google', {});
    assert.ok(opts.captchaSelectors);
    assert.ok(opts.captchaSelectors.length > 0);
  });

  it('includes successLocalStorage for discord', () => {
    const opts = resolveAuthOptions('discord', {});
    assert.ok(opts.successLocalStorage);
    assert.equal(opts.successLocalStorage.origin, 'https://discord.com');
    assert.equal(opts.successLocalStorage.key, 'token');
  });

  it('includes twoFactorSelectors from provider', () => {
    const opts = resolveAuthOptions('github', {});
    assert.ok(opts.twoFactorSelectors);
    assert.ok(opts.twoFactorSelectors.length > 0);
    assert.ok(opts.twoFactorSelectors.includes('input[name="app_otp"]'));
  });

  it('includes flowType from provider', () => {
    const opts = resolveAuthOptions('github', {});
    assert.equal(opts.flowType, 'single-step');

    const opts2 = resolveAuthOptions('google', {});
    assert.equal(opts2.flowType, 'multi-step');

    const opts3 = resolveAuthOptions('slack', {});
    assert.equal(opts3.flowType, 'magic-link');

    const opts4 = resolveAuthOptions('discord', {});
    assert.equal(opts4.flowType, 'spa');
  });

  it('includes notes from provider', () => {
    const opts = resolveAuthOptions('github', {});
    assert.ok(opts.notes);
    assert.ok(opts.notes.includes('Arkose'));
  });
});

// ============ loadCustomProviders ============

describe('loadCustomProviders', () => {
  it('loads custom providers from JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), `test-providers-${Date.now()}.json`);
    const custom = [{ slug: 'myapp', name: 'My App', loginUrl: 'https://myapp.example.com/login', successUrl: 'https://myapp.example.com/dashboard' }];
    fs.writeFileSync(tmpFile, JSON.stringify(custom));
    try {
      loadCustomProviders(tmpFile);
      const p = getProvider('myapp');
      assert.ok(p);
      assert.equal(p.name, 'My App');
      assert.equal(p.loginUrl, 'https://myapp.example.com/login');
    } finally {
      fs.unlinkSync(tmpFile);
      loadCustomProviders(null); // reset
    }
  });

  it('custom provider overrides built-in with same slug', () => {
    const tmpFile = path.join(os.tmpdir(), `test-providers-${Date.now()}.json`);
    const custom = [{ slug: 'github', name: 'GitHub Enterprise', loginUrl: 'https://github.myco.com/login', successUrl: 'https://github.myco.com' }];
    fs.writeFileSync(tmpFile, JSON.stringify(custom));
    try {
      loadCustomProviders(tmpFile);
      const p = getProvider('github');
      assert.equal(p.name, 'GitHub Enterprise');
      assert.equal(p.loginUrl, 'https://github.myco.com/login');
    } finally {
      fs.unlinkSync(tmpFile);
      loadCustomProviders(null); // reset
    }
  });

  it('ignores nonexistent file', () => {
    loadCustomProviders('/nonexistent/path.json');
    assert.ok(getProvider('github')); // built-ins still work
  });

  it('ignores entries without slug or loginUrl', () => {
    const tmpFile = path.join(os.tmpdir(), `test-providers-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify([{ name: 'No Slug' }, { slug: 'valid', loginUrl: 'https://valid.com' }]));
    try {
      loadCustomProviders(tmpFile);
      assert.equal(getProvider('no-slug'), null);
      assert.ok(getProvider('valid'));
    } finally {
      fs.unlinkSync(tmpFile);
      loadCustomProviders(null);
    }
  });
});

// ============ checkAuthSuccess ============

describe('checkAuthSuccess', () => {
  // Mock page object
  function mockPage(url, selectorResult, evaluateFn) {
    return {
      url: () => url,
      $: async () => selectorResult ? {
        evaluate: async (fn) => fn({ tagName: 'DIV' })
      } : null,
      evaluate: evaluateFn || (async () => null)
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

  it('detects success by localStorage match', async () => {
    const page = mockPage('https://discord.com/channels/@me', false, async (fn, args) => {
      // Simulate localStorage returning a token
      return 'some-auth-token';
    });
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://discord.com/login', {
      successLocalStorage: { origin: 'https://discord.com', key: 'token' }
    });
    assert.equal(result.success, true);
  });

  it('localStorage returns false when key not found', async () => {
    const page = mockPage('https://discord.com/login', false, async () => null);
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://discord.com/login', {
      successLocalStorage: { origin: 'https://discord.com', key: 'token' }
    });
    assert.equal(result.success, false);
  });

  it('localStorage handles evaluate errors gracefully', async () => {
    const page = mockPage('https://discord.com/login', false, async () => {
      throw new Error('evaluate error');
    });
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://discord.com/login', {
      successLocalStorage: { origin: 'https://discord.com', key: 'token' }
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

  it('heuristic rejects URLs containing oauth/sso/auth', async () => {
    for (const path of ['/oauth/callback', '/sso/redirect', '/auth/verify']) {
      const page = mockPage(`https://example.com${path}`);
      const ctx = mockContext();
      const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {});
      assert.equal(result.success, false, `should reject ${path}`);
    }
  });

  it('successUrl uses origin matching not string prefix', async () => {
    const page = mockPage('https://example.com.evil.com/dashboard');
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://example.com/login', {
      successUrl: 'https://example.com'
    });
    assert.equal(result.success, false);
  });

  it('selector returns false for META with empty content', async () => {
    const page = {
      url: () => 'https://github.com',
      $: async () => ({
        evaluate: async (fn) => fn({ tagName: 'META', hasAttribute: () => true, getAttribute: () => '' })
      }),
      evaluate: async () => null
    };
    const ctx = mockContext();
    const result = await checkAuthSuccess(page, ctx, 'https://github.com/login', {
      successSelector: 'meta[name="user-login"]'
    });
    assert.equal(result.success, false);
  });

  it('handles cookie read errors gracefully', async () => {
    const page = mockPage('https://github.com/something');
    const ctx = { cookies: async () => { throw new Error('cookie error'); } };
    const result = await checkAuthSuccess(page, ctx, 'https://github.com/login', {
      successCookie: { domain: '.github.com', name: 'logged_in', value: 'yes' }
    });
    assert.equal(result.success, false);
  });

  it('heuristic not used when successLocalStorage is set', async () => {
    const page = mockPage('https://discord.com/some-other-page', false, async () => null);
    const ctx = mockContext();
    // successLocalStorage is set but key not found; heuristic should NOT kick in
    const result = await checkAuthSuccess(page, ctx, 'https://discord.com/login', {
      successLocalStorage: { origin: 'https://discord.com', key: 'token' }
    });
    assert.equal(result.success, false);
  });
});
