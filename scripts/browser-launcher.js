'use strict';

const fs = require('fs');
const sessionStore = require('./session-store');

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
 * Random delay to mimic human behavior.
 */
function randomDelay() {
  return new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 600));
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

  const launchOptions = {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  // Prefer system Chrome
  launchOptions.channel = 'chrome';

  // WSL: use Windows Chrome executable
  if (isWSL()) {
    const chromePath = getWindowsChromePath();
    if (chromePath) {
      launchOptions.executablePath = chromePath;
      delete launchOptions.channel;
    }
  }

  // Restore storage state if available
  const storageState = sessionStore.loadStorageState(sessionName);
  if (storageState) {
    launchOptions.storageState = storageState;
  }

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);

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
 */
async function closeBrowser(sessionName, context) {
  try {
    const state = await context.storageState();
    sessionStore.saveStorageState(sessionName, state);
  } catch {
    // May fail if context is already closed
  }

  try {
    await context.close();
  } catch {
    // Already closed
  }
}

module.exports = { launchBrowser, closeBrowser, randomDelay, isWSL };
