'use strict';

const { launchBrowser, closeBrowser, canLaunchHeaded } = require('./browser-launcher');
const sessionStore = require('./session-store');
const { runVncAuth, isVncAvailable } = require('./vnc-auth');
const { checkAuthSuccess } = require('./auth-check');
const { verifyHeadless } = require('./verify-headless');

const CAPTCHA_SELECTORS = [
  'iframe[src*="arkose"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="captcha"]'
];

const CAPTCHA_TEXT_PATTERNS = [
  'suspicious activity',
  'verify you are human',
  'complete the captcha',
  'security check'
];

/**
 * Detect if a CAPTCHA is present on the page.
 * Accepts optional extra selectors and text patterns from providers.
 */
async function detectCaptcha(page, extraSelectors, extraTextPatterns) {
  const selectors = [...CAPTCHA_SELECTORS, ...(extraSelectors || [])];
  const textPatterns = [...CAPTCHA_TEXT_PATTERNS, ...(extraTextPatterns || [])];

  for (const selector of selectors) {
    const el = await page.$(selector);
    if (el) return true;
  }

  try {
    const text = (await page.textContent('body')).toLowerCase();
    for (const pattern of textPatterns) {
      if (text.includes(pattern)) return true;
    }
  } catch {
    // Ignore errors reading body text
  }

  return false;
}

/**
 * Run an auth flow with human-in-the-loop interaction.
 *
 * Opens a headed browser, navigates to the auth URL, and polls
 * for a success condition (URL match or DOM selector).
 *
 * @param {string} sessionName
 * @param {string} url - Auth/login URL
 * @param {object} options - { successUrl, successSelector, successCookie, timeout, captchaSelectors, captchaTextPatterns, twoFactorHint, verifyUrl, verifySelector }
 * @returns {{ ok, session, error, captchaDetected, twoFactorHint }}
 */
async function runAuthFlow(sessionName, url, options = {}) {
  // Force VNC mode
  if (options.vnc) {
    return runVncAuth(sessionName, url, options);
  }

  // Auto-detect: try headed, fallback to VNC
  const headed = await canLaunchHeaded();
  if (!headed) {
    if (isVncAvailable()) {
      return runVncAuth(sessionName, url, options);
    }
    return {
      ok: false,
      session: sessionName,
      error: 'no_display',
      message: 'No display available for headed browser. Install Xvfb, x11vnc, and websockify for remote auth: sudo apt-get install xvfb x11vnc websockify novnc'
    };
  }

  const timeout = (options.timeout || 300) * 1000;
  const pollInterval = 2000;

  let context;
  let page;

  try {
    sessionStore.lockSession(sessionName);

    const browser = await launchBrowser(sessionName, { headless: false });
    context = browser.context;
    page = browser.page;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const minWaitMs = (options.minWait || 5) * 1000;
    await new Promise(resolve => setTimeout(resolve, minWaitMs));

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await checkAuthSuccess(page, context, url, {
        successUrl: options.successUrl,
        successSelector: options.successSelector,
        successCookie: options.successCookie,
        loginUrl: url
      });

      if (result.success) {
        await closeBrowser(sessionName, context);
        sessionStore.updateSession(sessionName, { status: 'authenticated' });
        const headlessVerification = await verifyHeadless(sessionName, {
          verifyUrl: options.verifyUrl,
          verifySelector: options.verifySelector
        });
        sessionStore.unlockSession(sessionName);
        const authResult = { ok: true, session: sessionName, url: result.currentUrl };
        if (headlessVerification) authResult.headlessVerification = headlessVerification;
        return authResult;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    const captchaDetected = await detectCaptcha(page, options.captchaSelectors, options.captchaTextPatterns);
    await closeBrowser(sessionName, context);
    sessionStore.unlockSession(sessionName);

    const timeoutResult = {
      ok: false,
      session: sessionName,
      error: 'auth_timeout',
      message: `Auth timed out after ${options.timeout || 300} seconds`,
      captchaDetected
    };
    if (options.twoFactorHint) timeoutResult.twoFactorHint = options.twoFactorHint;
    return timeoutResult;
  } catch (err) {
    if (context) {
      try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
    }
    try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }

    return {
      ok: false,
      session: sessionName,
      error: 'auth_error',
      message: err.message
    };
  }
}

module.exports = { runAuthFlow, detectCaptcha };
