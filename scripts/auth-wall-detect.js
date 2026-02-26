'use strict';

/**
 * Auth wall and content blocking detection module.
 *
 * detectAuthWall: Detects whether a page is showing an authentication wall.
 * Uses three heuristics (ALL must pass - AND logic):
 *   1. Domain cookies exist for the target URL
 *   2. Current page URL matches a known auth URL pattern
 *   3. Page DOM contains login-related elements or text
 *
 * detectContentBlocked: Detects when a site serves a page but blocks the
 * actual content (e.g. X.com serving empty timelines to headless browsers).
 * Uses provider-specific and generic heuristics (OR logic - any match triggers).
 *
 * Short-circuits: if cookie check fails, skips URL and DOM checks.
 */

const AUTH_URL_PATTERNS = [
  'login',
  'signin',
  'sign_in',
  'sign-in',
  'oauth',
  'accounts',
  'auth/realms'
];

const AUTH_DOM_SELECTORS = [
  'input[type="password"]',
  'form[action*="login"]',
  'form[action*="signin"]',
  'form[action*="authenticate"]',
  'input[name="username"]',
  'input[name="email"][type="email"]'
];

const AUTH_TEXT_PATTERNS = [
  'sign in',
  'log in',
  'enter your password',
  'choose an account',
  'pick an account',
  'select an account'
];

/**
 * Extract the domain from a URL string.
 * Returns null if the URL is invalid.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Check whether a cookie domain matches the target domain.
 * Supports parent domain matching (e.g., cookie for `.github.com` matches `github.com`).
 */
function cookieDomainMatches(cookieDomain, targetDomain) {
  const bare = cookieDomain.replace(/^\./, '');
  if (bare === targetDomain) return true;
  if (targetDomain.endsWith('.' + bare)) return true;
  return false;
}

/**
 * Detect whether the current page is an auth wall.
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {string} targetUrl - The URL we navigated to
 * @returns {Promise<{ detected: boolean, reason: string, details?: object }>}
 */
async function detectAuthWall(page, context, targetUrl) {
  const targetDomain = extractDomain(targetUrl);
  if (!targetDomain) {
    return { detected: false, reason: 'invalid_target_url' };
  }

  // Heuristic 1: Domain cookies exist
  let cookies;
  try {
    cookies = await context.cookies();
  } catch {
    return { detected: false, reason: 'cookie_read_error' };
  }

  const hasDomainCookies = cookies.some(c => cookieDomainMatches(c.domain, targetDomain));
  if (!hasDomainCookies) {
    return { detected: false, reason: 'no_domain_cookies' };
  }

  // Heuristic 2: URL matches auth pattern
  const currentUrl = page.url().toLowerCase();
  const authUrlPattern = AUTH_URL_PATTERNS.find(pattern => currentUrl.includes(pattern));
  if (!authUrlPattern) {
    return { detected: false, reason: 'url_not_auth_pattern' };
  }

  // Heuristic 3: DOM contains auth elements
  // 3a: Check selectors (parallel for performance)
  let matchedSelector = null;
  try {
    const results = await Promise.allSettled(
      AUTH_DOM_SELECTORS.map(async (sel) => ({ sel, el: await page.$(sel) }))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.el) {
        matchedSelector = r.value.sel;
        break;
      }
    }
  } catch {
  }

  if (matchedSelector) {
    return {
      detected: true,
      reason: 'auth_wall',
      details: {
        hasDomainCookies: true,
        authUrlPattern,
        domElement: matchedSelector
      }
    };
  }

  // 3b: Check text patterns
  let matchedText = null;
  try {
    const bodyText = (await page.textContent('body') || '').slice(0, 5000).toLowerCase();
    matchedText = AUTH_TEXT_PATTERNS.find(pattern => bodyText.includes(pattern));
  } catch {
  }

  if (matchedText) {
    return {
      detected: true,
      reason: 'auth_wall',
      details: {
        hasDomainCookies: true,
        authUrlPattern,
        domElement: matchedText
      }
    };
  }

  return { detected: false, reason: 'no_auth_elements' };
}

// --- Content blocking detection ---

const CONTENT_BLOCKED_TEXT_PATTERNS = [
  'something went wrong',
  'try again',
  'content is not available',
  'this page is not available',
  'page isn\'t available',
  'page not found',
  'access denied',
  'please enable javascript'
];

const LOADING_INDICATOR_SELECTORS = [
  '[role="progressbar"]',
  '[aria-busy="true"]',
  '.spinner',
  '.loading'
];

const DEFAULT_EMPTY_CONTENT_THRESHOLD = 200;

/**
 * Detect whether the page content is blocked (e.g. by headless browser detection).
 *
 * Unlike auth wall detection (AND logic), content blocking uses OR logic -
 * any single heuristic match triggers detection. Checks are ordered from
 * most specific (provider selectors) to most generic (persistent spinners).
 *
 * @param {import('playwright').Page} page
 * @param {object} [options={}]
 * @param {string[]} [options.contentSelectors] - Provider-specific content selectors
 * @param {object} [options.contentBlockedIndicators] - Provider-specific blocked indicators
 * @param {string[]} [options.contentBlockedIndicators.selectors] - Selectors that indicate blocked content
 * @param {string[]} [options.contentBlockedIndicators.textPatterns] - Text patterns that indicate blocked content
 * @param {number} [options.contentBlockedIndicators.emptyContentThreshold] - Min chars for content to be considered present
 * @param {number} [options.timeout] - Not currently used, reserved for future async checks
 * @returns {Promise<{ detected: boolean, reason: string, details?: object }>}
 */
async function detectContentBlocked(page, options = {}) {
  const { contentSelectors, contentBlockedIndicators } = options;
  const blockedSelectors = contentBlockedIndicators?.selectors || [];
  const blockedTextPatterns = contentBlockedIndicators?.textPatterns || [];
  const emptyThreshold = contentBlockedIndicators?.emptyContentThreshold || DEFAULT_EMPTY_CONTENT_THRESHOLD;

  // 1. Provider-specific blocked selectors
  if (blockedSelectors.length > 0) {
    try {
      const results = await Promise.allSettled(
        blockedSelectors.map(async (sel) => ({ sel, el: await page.$(sel) }))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.el) {
          return {
            detected: true,
            reason: 'provider_blocked_selector',
            details: { selector: r.value.sel }
          };
        }
      }
    } catch {
      // DOM query failed - continue to next check
    }
  }

  // 2. Provider-specific blocked text patterns
  if (blockedTextPatterns.length > 0) {
    try {
      const bodyText = (await page.textContent('body') || '').slice(0, 5000).toLowerCase();
      const matched = blockedTextPatterns.find(pattern => bodyText.includes(pattern));
      if (matched) {
        return {
          detected: true,
          reason: 'provider_blocked_text',
          details: { pattern: matched }
        };
      }
    } catch {
      // textContent failed - continue to next check
    }
  }

  // 3. Provider content selectors exist but contain very little text
  if (contentSelectors && contentSelectors.length > 0) {
    try {
      let totalContentLength = 0;
      let anyContentSelectorFound = false;

      const results = await Promise.allSettled(
        contentSelectors.map(async (sel) => {
          const el = await page.$(sel);
          if (!el) return { sel, found: false, length: 0 };
          const text = await el.textContent() || '';
          return { sel, found: true, length: text.trim().length };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.found) {
          anyContentSelectorFound = true;
          totalContentLength += r.value.length;
        }
      }

      if (anyContentSelectorFound && totalContentLength < emptyThreshold) {
        return {
          detected: true,
          reason: 'content_empty',
          details: { contentLength: totalContentLength, threshold: emptyThreshold }
        };
      }
    } catch {
      // DOM query failed - continue to next check
    }
  }

  // 4. Generic text patterns + short main content area
  try {
    const bodyText = (await page.textContent('body') || '').slice(0, 5000).toLowerCase();
    const genericMatch = CONTENT_BLOCKED_TEXT_PATTERNS.find(pattern => bodyText.includes(pattern));
    if (genericMatch && bodyText.length < 500) {
      return {
        detected: true,
        reason: 'generic_blocked_text',
        details: { pattern: genericMatch, bodyLength: bodyText.length }
      };
    }
  } catch {
    // textContent failed - continue to next check
  }

  // 5. Persistent loading indicators (spinners still visible)
  try {
    const results = await Promise.allSettled(
      LOADING_INDICATOR_SELECTORS.map(async (sel) => {
        const el = await page.$(sel);
        if (!el) return { sel, visible: false };
        const visible = await el.isVisible();
        return { sel, visible };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.visible) {
        return {
          detected: true,
          reason: 'persistent_loader',
          details: { selector: r.value.sel }
        };
      }
    }
  } catch {
    // DOM query failed - no detection
  }

  return { detected: false, reason: 'content_ok' };
}

module.exports = {
  detectAuthWall,
  detectContentBlocked,
  AUTH_URL_PATTERNS,
  AUTH_DOM_SELECTORS,
  AUTH_TEXT_PATTERNS,
  CONTENT_BLOCKED_TEXT_PATTERNS
};
