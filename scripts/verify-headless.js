'use strict';

const { launchBrowser } = require('./browser-launcher');

const LOGIN_KEYWORDS = ['login', 'signin', 'auth', 'oauth', 'sso', 'error', 'failed'];

/**
 * Post-auth headless verification.
 *
 * Launches a headless browser with saved session cookies, navigates to the
 * verification URL, and checks for authenticated content. Does NOT lock or
 * unlock the session - the caller holds the lock.
 *
 * Closes the browser context via context.close() directly (not closeBrowser)
 * to avoid overwriting auth cookies with post-probe state.
 *
 * @param {string} sessionName
 * @param {object} options - { verifyUrl, verifySelector, timeout }
 * @param {Function} [_launcher] - Override launchBrowser for testing
 * @returns {object|null} { ok, url, currentUrl, status, reason, duration } or null
 */
async function verifyHeadless(sessionName, options = {}, _launcher) {
  if (!options.verifyUrl) return null;

  const launch = _launcher || launchBrowser;
  const start = Date.now();
  let context = null;

  try {
    const browser = await launch(sessionName, { headless: true });
    context = browser.context;
    const page = browser.page;

    const response = await page.goto(options.verifyUrl, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeout || 20000
    });

    const status = response ? response.status() : null;
    const currentUrl = page.url();

    if (options.verifySelector) {
      const el = await page.$(options.verifySelector);
      if (el) {
        return {
          ok: true,
          url: options.verifyUrl,
          currentUrl,
          status,
          reason: 'selector_found',
          duration: Date.now() - start
        };
      }
      return {
        ok: false,
        url: options.verifyUrl,
        currentUrl,
        status,
        reason: 'selector_not_found',
        duration: Date.now() - start
      };
    }

    // No selector - use URL heuristic
    const urlLower = currentUrl.toLowerCase();
    const redirectedToLogin = LOGIN_KEYWORDS.some(kw => urlLower.includes(kw));

    if (status === 200 && !redirectedToLogin) {
      return {
        ok: true,
        url: options.verifyUrl,
        currentUrl,
        status,
        reason: 'status_ok',
        duration: Date.now() - start
      };
    }

    return {
      ok: false,
      url: options.verifyUrl,
      currentUrl,
      status,
      reason: redirectedToLogin ? 'redirected_to_login' : 'unexpected_status',
      duration: Date.now() - start
    };
  } catch (err) {
    return {
      ok: false,
      url: options.verifyUrl,
      currentUrl: null,
      status: null,
      error: 'verify_error',
      reason: 'verify_error',
      message: err.message,
      duration: Date.now() - start
    };
  } finally {
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

module.exports = { verifyHeadless };
