'use strict';

const { launchBrowser, closeBrowser, canLaunchHeaded } = require('./browser-launcher');
const sessionStore = require('./session-store');
const { runVncAuth, isVncAvailable } = require('./vnc-auth');

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
 */
async function detectCaptcha(page) {
  for (const selector of CAPTCHA_SELECTORS) {
    const el = await page.$(selector);
    if (el) return true;
  }

  try {
    const text = (await page.textContent('body')).toLowerCase();
    for (const pattern of CAPTCHA_TEXT_PATTERNS) {
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
 * @param {object} options - { successUrl, successSelector, timeout }
 * @returns {{ ok, session, error, captchaDetected }}
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

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check success by URL
      if (options.successUrl) {
        const currentUrl = page.url();
        if (currentUrl.startsWith(options.successUrl)) {
          await closeBrowser(sessionName, context);
          sessionStore.updateSession(sessionName, { status: 'authenticated' });
          sessionStore.unlockSession(sessionName);
          return { ok: true, session: sessionName, url: currentUrl };
        }
      }

      // Check success by DOM selector
      if (options.successSelector) {
        const el = await page.$(options.successSelector);
        if (el) {
          // For attribute selectors, verify the attribute has a non-empty value
          const isValid = await el.evaluate(node => {
            // Check common auth indicators - meta tags with content, visible elements
            if (node.tagName === 'META' && node.hasAttribute('content')) {
              return node.getAttribute('content').trim().length > 0;
            }
            return true;
          }).catch(() => false);

          if (isValid) {
            const currentUrl = page.url();
            await closeBrowser(sessionName, context);
            sessionStore.updateSession(sessionName, { status: 'authenticated' });
            sessionStore.unlockSession(sessionName);
            return { ok: true, session: sessionName, url: currentUrl };
          }
        }
      }

      // Check for CAPTCHA
      const hasCaptcha = await detectCaptcha(page);
      if (hasCaptcha) {
        // Don't fail — user might solve it. Just note it.
      }

      // If no success condition given, check if URL changed from login page
      if (!options.successUrl && !options.successSelector) {
        const currentUrl = page.url();
        if (currentUrl !== url && !currentUrl.includes('login') && !currentUrl.includes('signin')) {
          await closeBrowser(sessionName, context);
          sessionStore.updateSession(sessionName, { status: 'authenticated' });
          sessionStore.unlockSession(sessionName);
          return { ok: true, session: sessionName, url: currentUrl };
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    const captchaDetected = await detectCaptcha(page);
    await closeBrowser(sessionName, context);
    sessionStore.unlockSession(sessionName);

    return {
      ok: false,
      session: sessionName,
      error: 'auth_timeout',
      message: `Auth timed out after ${options.timeout || 300} seconds`,
      captchaDetected
    };
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
