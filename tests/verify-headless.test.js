'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifyHeadless } = require('../scripts/verify-headless');

/**
 * Create a mock launcher that returns a fake browser context and page.
 *
 * @param {object} opts
 * @param {string} opts.url - URL returned by page.url()
 * @param {number} opts.status - HTTP status returned by response.status()
 * @param {boolean} opts.selectorFound - Whether page.$(selector) returns an element
 * @param {Error} [opts.launchError] - If set, launcher throws this error
 * @param {Error} [opts.gotoError] - If set, page.goto throws this error
 */
function mockLauncher({ url, status = 200, selectorFound = false, launchError, gotoError } = {}) {
  let closed = false;

  const launcher = async () => {
    if (launchError) throw launchError;

    const context = {
      close: async () => { closed = true; }
    };

    const page = {
      goto: async () => {
        if (gotoError) throw gotoError;
        return { status: () => status };
      },
      url: () => url,
      $: async () => selectorFound ? {} : null
    };

    return { context, page };
  };

  launcher.wasClosed = () => closed;
  return launcher;
}

// ============ verifyHeadless ============

describe('verifyHeadless', () => {
  it('returns null when verifyUrl is not provided', async () => {
    const result = await verifyHeadless('test-session', {});
    assert.equal(result, null);
  });

  it('returns null when verifyUrl is undefined', async () => {
    const result = await verifyHeadless('test-session', { verifyUrl: undefined });
    assert.equal(result, null);
  });

  it('returns null when verifyUrl is empty string', async () => {
    const result = await verifyHeadless('test-session', { verifyUrl: '' });
    assert.equal(result, null);
  });

  it('rejects non-http/https URLs', async () => {
    const result = await verifyHeadless('test-session', { verifyUrl: 'file:///etc/passwd' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_url');
    assert.equal(result.reason, 'invalid_url_scheme');
  });

  it('rejects javascript: URLs', async () => {
    const result = await verifyHeadless('test-session', { verifyUrl: 'javascript:alert(1)' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_url');
  });

  it('returns ok:true when page loads and verifySelector matches', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com',
      status: 200,
      selectorFound: true
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com',
      verifySelector: 'meta[name="user-login"][content]'
    }, launcher);

    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://github.com');
    assert.equal(result.currentUrl, 'https://github.com');
    assert.equal(result.status, 200);
    assert.equal(result.reason, 'selector_found');
  });

  it('returns ok:false with reason selector_not_found when selector does not match', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com',
      status: 200,
      selectorFound: false
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com',
      verifySelector: 'meta[name="user-login"][content]'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'selector_not_found');
    assert.equal(result.status, 200);
  });

  it('returns ok:true when no selector and page loads at non-login URL with status 200', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com/dashboard',
      status: 200
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com/dashboard'
    }, launcher);

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'status_ok');
    assert.equal(result.status, 200);
  });

  it('returns ok:false when page redirects to a login URL', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com/login?return_to=dashboard',
      status: 200
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com/dashboard'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'redirected_to_login');
  });

  it('returns ok:false when page redirects to signin URL', async () => {
    const launcher = mockLauncher({
      url: 'https://accounts.google.com/signin',
      status: 200
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://myaccount.google.com'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'redirected_to_login');
  });

  it('returns ok:false when page redirects to oauth URL', async () => {
    const launcher = mockLauncher({
      url: 'https://example.com/oauth/authorize',
      status: 200
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://example.com/dashboard'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'redirected_to_login');
  });

  it('returns ok:false when status is not 200 and no selector', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com/dashboard',
      status: 403
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com/dashboard'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unexpected_status');
    assert.equal(result.status, 403);
  });

  it('returns ok:false with error verify_error when browser launch fails', async () => {
    const launcher = mockLauncher({
      launchError: new Error('Browser launch failed')
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'verify_error');
    assert.equal(result.reason, 'browser_error');
    assert.equal(result.message, 'Browser launch failed');
  });

  it('returns ok:false with error verify_error when navigation times out', async () => {
    const launcher = mockLauncher({
      gotoError: new Error('Timeout 20000ms exceeded')
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://slow-site.example.com'
    }, launcher);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'verify_error');
    assert.equal(result.reason, 'navigation_timeout');
    assert.ok(result.message.includes('Timeout'));
  });

  it('always closes browser context even on errors', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com',
      gotoError: new Error('Navigation failed')
    });

    await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com'
    }, launcher);

    assert.equal(launcher.wasClosed(), true);
  });

  it('closes context on successful verification', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com',
      status: 200,
      selectorFound: true
    });

    await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com',
      verifySelector: '#user'
    }, launcher);

    assert.equal(launcher.wasClosed(), true);
  });

  it('includes duration in response', async () => {
    const launcher = mockLauncher({
      url: 'https://github.com',
      status: 200,
      selectorFound: true
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com',
      verifySelector: '#user'
    }, launcher);

    assert.equal(typeof result.duration, 'number');
    assert.ok(result.duration >= 0);
  });

  it('includes duration on error responses', async () => {
    const launcher = mockLauncher({
      launchError: new Error('fail')
    });

    const result = await verifyHeadless('test-session', {
      verifyUrl: 'https://github.com'
    }, launcher);

    assert.equal(typeof result.duration, 'number');
    assert.ok(result.duration >= 0);
  });

  it('detects all login keywords in URL', async () => {
    const keywords = ['login', 'signin', 'auth', 'oauth', 'sso', 'error', 'failed'];

    for (const kw of keywords) {
      const launcher = mockLauncher({
        url: `https://example.com/${kw}/page`,
        status: 200
      });

      const result = await verifyHeadless('test-session', {
        verifyUrl: 'https://example.com/dashboard'
      }, launcher);

      assert.equal(result.ok, false, `should detect keyword "${kw}" in URL`);
      assert.equal(result.reason, 'redirected_to_login');
    }
  });
});
