'use strict';

/**
 * Shared auth success detection.
 *
 * Checks in order: successUrl -> successSelector -> successCookie -> URL-change heuristic.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {string} originalUrl - The login URL we started on
 * @param {object} options - { successUrl, successSelector, successCookie }
 * @returns {{ success: boolean, currentUrl: string }}
 */
async function checkAuthSuccess(page, context, originalUrl, options = {}) {
  const currentUrl = page.url();

  // 1. Check success by URL origin match
  if (options.successUrl) {
    try {
      const expected = new URL(options.successUrl);
      const actual = new URL(currentUrl);
      if (actual.origin === expected.origin && actual.pathname.startsWith(expected.pathname)) {
        return { success: true, currentUrl };
      }
    } catch {
      // Malformed URL - fall through
    }
  }

  // 2. Check success by DOM selector
  if (options.successSelector) {
    const el = await page.$(options.successSelector);
    if (el) {
      const isValid = await el.evaluate(node => {
        if (node.tagName === 'META' && node.hasAttribute('content')) {
          return node.getAttribute('content').trim().length > 0;
        }
        return true;
      }).catch(() => false);

      if (isValid) {
        return { success: true, currentUrl };
      }
    }
  }

  // 3. Check success by cookie
  if (options.successCookie) {
    const { domain, name, value } = options.successCookie;
    try {
      const cookies = await context.cookies();
      const match = cookies.find(c => {
        if (c.name !== name) return false;
        if (domain && !c.domain.endsWith(domain.replace(/^\./, ''))) return false;
        if (value !== undefined && c.value !== value) return false;
        return true;
      });
      if (match) {
        return { success: true, currentUrl };
      }
    } catch {
      // Ignore cookie read errors
    }
  }

  // 3.5. Check success by localStorage key
  if (options.successLocalStorage) {
    const { origin, key } = options.successLocalStorage;
    try {
      const value = await page.evaluate(({ storageKey }) => {
        try { return localStorage.getItem(storageKey); } catch { return null; }
      }, { storageKey: key });
      if (value) {
        return { success: true, currentUrl };
      }
    } catch {
      // Ignore localStorage read errors (cross-origin, etc.)
    }
  }

  // 4. URL-change heuristic (only when no explicit success condition)
  if (!options.successUrl && !options.successSelector && !options.successCookie && !options.successLocalStorage) {
    const excludePatterns = ['login', 'signin', 'auth', 'oauth', 'sso', 'error', 'failed'];
    if (currentUrl !== originalUrl && !excludePatterns.some(p => currentUrl.includes(p))) {
      return { success: true, currentUrl };
    }
  }

  return { success: false, currentUrl };
}

module.exports = { checkAuthSuccess };
