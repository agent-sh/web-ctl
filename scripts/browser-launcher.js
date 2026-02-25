'use strict';

const fs = require('fs');
const path = require('path');
const sessionStore = require('./session-store');

const IN_WSL = isWSL();

/**
 * Detect WSL environment.
 */
function isWSL() {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return version.toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Get Windows Chrome path when running under WSL.
 */
function getWindowsChromePath() {
  const candidates = [
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Random delay to mimic human behavior (200-800ms).
 */
function randomDelay() {
  return new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 600));
}

/**
 * Remove stale Chrome SingletonLock from profile directory.
 */
function cleanSingletonLock(profileDir) {
  const lockPath = path.join(profileDir, 'SingletonLock');
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // May fail if locked by active process — that's fine
  }
}

/**
 * Launch a browser with a persistent context for the given session.
 *
 * @param {string} sessionName - Session name
 * @param {object} options - { headless: boolean }
 * @returns {{ context, page }}
 */
async function launchBrowser(sessionName, options = {}) {
  const { chromium } = require('playwright');

  const profileDir = sessionStore.getProfileDir(sessionName);
  const headless = options.headless !== false;

  // Clean stale Chrome lock that can prevent launch after crash
  cleanSingletonLock(profileDir);

  const launchOptions = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  // WSL: use Windows Chrome executable
  if (IN_WSL) {
    const chromePath = getWindowsChromePath();
    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }
  }

  // Try system Chrome first, fall back to Playwright bundled Chromium
  let context;
  try {
    launchOptions.channel = 'chrome';
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch {
    delete launchOptions.channel;
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  }

  // Restore cookies after launch (storageState option is ignored for persistent contexts)
  const storageState = sessionStore.loadStorageState(sessionName);
  if (storageState && storageState.cookies && storageState.cookies.length > 0) {
    await context.addCookies(storageState.cookies);
  }

  // Anti-bot init script on all pages
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Get or create the first page
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return { context, page };
}

/**
 * Save storage state and close the browser context.
 * Returns a warning message if storage state could not be saved.
 */
async function closeBrowser(sessionName, context) {
  let warning = null;
  try {
    const state = await context.storageState();
    sessionStore.saveStorageState(sessionName, state);
  } catch (err) {
    warning = `Storage state not saved: ${err.message}`;
  }

  try {
    await context.close();
  } catch {
    // Already closed
  }

  return warning;
}

/**
 * Test whether a headed (non-headless) browser can launch on this system.
 * Retries once on failure to handle transient resource contention.
 */
async function canLaunchHeaded() {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }

  const { chromium } = require('playwright');
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctx = await chromium.launchPersistentContext('', {
        headless: false,
        args: ['--no-first-run', '--no-default-browser-check'],
        timeout: 5000
      });
      await ctx.close();
      return true;
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.error('[WARN] Headed browser probe failed: ' + err.message);
      }
    }
  }
  return false;
}

/**
 * Wait for page to stabilize after an action (network idle + no DOM mutations).
 *
 * @param {import('playwright').Page} page
 * @param {object} options - { timeout: number (ms, default 5000) }
 */
async function waitForStable(page, { timeout = 5000 } = {}) {
  // Wait for network to settle (best effort, don't fail if it times out)
  await Promise.race([
    page.waitForLoadState('networkidle', { timeout }).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeout))
  ]);

  // Wait for no DOM mutations for 500ms
  const DOM_QUIET_MS = 500;
  await page.evaluate((ms) => new Promise(resolve => {
    let timer = setTimeout(resolve, ms);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(resolve, ms);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    // Safety: disconnect observer when done
    setTimeout(() => { observer.disconnect(); resolve(); }, ms * 10);
  }), DOM_QUIET_MS);
}

module.exports = { launchBrowser, closeBrowser, randomDelay, isWSL, canLaunchHeaded, waitForStable };
