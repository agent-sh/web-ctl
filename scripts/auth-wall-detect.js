'use strict';

/**
 * Auth wall detection module.
 *
 * Detects whether a page is showing an authentication wall after navigation.
 * Uses three heuristics (ALL must pass - AND logic):
 *   1. Domain cookies exist for the target URL
 *   2. Current page URL matches a known auth URL pattern
 *   3. Page DOM contains login-related elements or text
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

module.exports = { detectAuthWall, AUTH_URL_PATTERNS, AUTH_DOM_SELECTORS, AUTH_TEXT_PATTERNS };
