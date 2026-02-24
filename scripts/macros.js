'use strict';

/**
 * Action macros - higher-level browser actions composed from primitives.
 * Each macro: async function(page, actionArgs, opts, helpers) -> result
 */

async function selectOption(page, actionArgs, opts, helpers) {
  const trigger = actionArgs[0];
  const optionText = actionArgs.slice(1).join(' ');
  if (!trigger || !optionText) {
    throw new Error('Usage: select-option <trigger-selector> <option-text> [--exact]');
  }
  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  const locator = resolveSelector(page, trigger);
  await locator.click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  const exact = !!opts.exact;
  await page.getByText(optionText, { exact }).click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  const snapshot = await getSnapshot(page);
  return { url: page.url(), selected: optionText, snapshot };
}

async function tabSwitch(page, actionArgs, opts, helpers) {
  const tabName = actionArgs.join(' ');
  if (!tabName) {
    throw new Error('Usage: tab-switch <tab-name> [--wait-for <selector>]');
  }
  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  await page.getByRole('tab', { name: tabName }).click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  if (opts.waitFor) {
    const waitLocator = resolveSelector(page, opts.waitFor);
    await waitLocator.waitFor({ state: 'visible', timeout: 10000 });
  }
  const snapshot = await getSnapshot(page);
  return { url: page.url(), tab: tabName, snapshot };
}

async function modalDismiss(page, actionArgs, opts, helpers) {
  const { resolveSelector, waitForStable, getSnapshot } = helpers;

  let modal = null;

  if (opts.selector) {
    modal = resolveSelector(page, opts.selector);
  } else {
    const combined = page.locator(':is([role="dialog"], [class*="modal"], [class*="overlay"], [class*="cookie"])').first();
    if (await combined.count() > 0 && await combined.isVisible()) {
      modal = combined;
    }
  }

  if (!modal) {
    throw new Error('No visible modal detected. Use --selector to specify.');
  }

  // Find dismiss button
  let dismissBtn = null;
  if (opts.accept) {
    const acceptPatterns = ['Accept', 'OK', 'Agree', 'Got it', 'Allow', 'Yes'];
    for (const pattern of acceptPatterns) {
      const btn = modal.getByRole('button', { name: pattern });
      if (await btn.count() > 0) { dismissBtn = btn.first(); break; }
    }
    if (!dismissBtn) {
      dismissBtn = modal.getByText(/accept|agree|ok|got it|allow/i).first();
    }
  } else {
    const closePatterns = ['Close', 'Dismiss', 'Cancel', 'No thanks', 'X'];
    for (const pattern of closePatterns) {
      const btn = modal.getByRole('button', { name: pattern });
      if (await btn.count() > 0) { dismissBtn = btn.first(); break; }
    }
    if (!dismissBtn) {
      // Try aria-label close
      const ariaClose = modal.locator('[aria-label="Close"], [aria-label="close"], button:has-text("×")');
      if (await ariaClose.count() > 0) {
        dismissBtn = ariaClose.first();
      }
    }
  }

  if (!dismissBtn) {
    throw new Error('Could not find dismiss button in modal. Use a direct click action instead.');
  }

  await dismissBtn.click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });

  const snapshot = await getSnapshot(page);
  return { url: page.url(), dismissed: true, snapshot };
}

async function formFill(page, actionArgs, opts, helpers) {
  const { waitForStable, getSnapshot } = helpers;

  if (!opts.fields) {
    throw new Error('Usage: form-fill --fields \'{"Label": "value"}\' [--submit] [--submit-text <text>]');
  }

  let fields;
  try {
    fields = JSON.parse(opts.fields);
  } catch {
    throw new Error('Invalid JSON in --fields. Use: --fields \'{"Label": "value"}\'');
  }

  for (const [label, value] of Object.entries(fields)) {
    const input = page.getByLabel(label);
    const { tagName, inputType } = await input.evaluate(el => ({
      tagName: el.tagName.toLowerCase(), inputType: el.type || ''
    })).catch(() => ({ tagName: 'input', inputType: '' }));

    if (tagName === 'select') {
      await input.selectOption(value);
    } else if (inputType === 'checkbox') {
      if (value === true || value === 'true') {
        await input.check();
      } else {
        await input.uncheck();
      }
    } else if (inputType === 'radio') {
      await input.check();
    } else {
      await input.fill(String(value));
    }
  }

  if (opts.submit) {
    const submitText = opts.submitText || 'Submit';
    const submitBtn = page.getByRole('button', { name: submitText });
    await submitBtn.click({ timeout: 10000 });
    await waitForStable(page, { timeout: 5000 });
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), filled: Object.keys(fields), snapshot };
}

async function searchSelect(page, actionArgs, opts, helpers) {
  const inputSel = actionArgs[0];
  const query = actionArgs.slice(1).join(' ');
  if (!inputSel || !query) {
    throw new Error('Usage: search-select <input-selector> <query> --pick <text>');
  }
  if (!opts.pick) {
    throw new Error('--pick <text> is required for search-select');
  }

  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  const input = resolveSelector(page, inputSel);
  await input.click({ timeout: 10000 });
  await input.pressSequentially(query, { delay: 80 });
  await waitForStable(page, { timeout: 5000 });
  await page.getByText(opts.pick).click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  const snapshot = await getSnapshot(page);
  return { url: page.url(), query, picked: opts.pick, snapshot };
}

async function datePick(page, actionArgs, opts, helpers) {
  const inputSel = actionArgs[0];
  if (!inputSel) {
    throw new Error('Usage: date-pick <input-selector> --date <YYYY-MM-DD>');
  }
  if (!opts.date) {
    throw new Error('--date <YYYY-MM-DD> is required for date-pick');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD (e.g., 2026-03-15)');
  }
  const parsed = new Date(opts.date + 'T00:00:00');
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== opts.date) {
    throw new Error(`Date out of range: ${opts.date}`);
  }

  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  const [targetYear, targetMonth, targetDay] = opts.date.split('-').map(Number);

  const input = resolveSelector(page, inputSel);
  await input.click({ timeout: 10000 });
  await waitForStable(page, { timeout: 3000 });

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const targetMonthName = monthNames[targetMonth - 1];

  // Navigate to target month/year - try up to 24 months
  for (let i = 0; i < 24; i++) {
    const headerText = await page.locator('[class*="calendar"], [role="grid"], [class*="datepicker"]')
      .first().textContent().catch(() => '');

    if (headerText.includes(targetMonthName) && headerText.includes(String(targetYear))) {
      break;
    }

    // Click next button
    const nextBtn = page.locator('[aria-label*="next" i], [aria-label*="Next" i], button:has-text("›"), button:has-text(">")').first();
    await nextBtn.click({ timeout: 5000 });
    await waitForStable(page, { timeout: 2000 });
  }

  // Verify we navigated to the right month
  const finalHeader = await page.locator('[class*="calendar"], [role="grid"], [class*="datepicker"]')
    .first().textContent().catch(() => '');
  if (!finalHeader.includes(targetMonthName) || !finalHeader.includes(String(targetYear))) {
    throw new Error(`Could not navigate calendar to ${opts.date}. Stuck at: ${finalHeader.trim()}`);
  }

  // Click the target day
  await page.getByText(String(targetDay), { exact: true }).click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  const snapshot = await getSnapshot(page);
  return { url: page.url(), date: opts.date, snapshot };
}

async function fileUpload(page, actionArgs, opts, helpers) {
  const selector = actionArgs[0];
  const filePath = actionArgs[1];
  if (!selector || !filePath) {
    throw new Error('Usage: file-upload <selector> <file-path> [--wait-for <selector>]');
  }

  // Only allow uploads from safe directories (allowlist approach)
  const path = require('path');
  const resolved = path.resolve(filePath);
  const sep = path.sep;
  const allowedPrefixes = ['/tmp/', path.resolve('/tmp') + sep, process.cwd() + sep];
  const uploadDir = process.env.WEB_CTL_UPLOAD_DIR;
  if (uploadDir) allowedPrefixes.push(path.resolve(uploadDir) + '/');
  const allowed = allowedPrefixes.some(prefix => resolved.startsWith(prefix));
  if (!allowed) {
    throw new Error(`File path must be within /tmp, the working directory, or WEB_CTL_UPLOAD_DIR. Got: ${resolved}`);
  }
  // Extra guard for dotfiles even within allowed dirs
  if (/[\\/]\.[a-z]/i.test(resolved)) {
    throw new Error(`File path "${filePath}" contains a dotfile/hidden directory. Use non-hidden paths.`);
  }

  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  await page.locator(selector).setInputFiles(filePath);
  await waitForStable(page, { timeout: 5000 });

  if (opts.waitFor) {
    const waitLocator = resolveSelector(page, opts.waitFor);
    await waitLocator.waitFor({ state: 'visible', timeout: 30000 });
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), uploaded: filePath, snapshot };
}

async function hoverReveal(page, actionArgs, opts, helpers) {
  const triggerSel = actionArgs[0];
  if (!triggerSel) {
    throw new Error('Usage: hover-reveal <trigger-selector> --click <target-selector>');
  }
  if (!opts.click) {
    throw new Error('--click <target-selector> is required for hover-reveal');
  }

  const { resolveSelector, waitForStable, getSnapshot } = helpers;
  const trigger = resolveSelector(page, triggerSel);
  await trigger.hover({ timeout: 10000 });
  await waitForStable(page, { timeout: 3000 });
  const target = resolveSelector(page, opts.click);
  await target.click({ timeout: 10000 });
  await waitForStable(page, { timeout: 5000 });
  const snapshot = await getSnapshot(page);
  return { url: page.url(), hovered: triggerSel, clicked: opts.click, snapshot };
}

async function scrollTo(page, actionArgs, opts, helpers) {
  const selector = actionArgs[0];
  if (!selector) {
    throw new Error('Usage: scroll-to <selector> [--container <selector>]');
  }

  const { resolveSelector, getSnapshot } = helpers;
  const locator = resolveSelector(page, selector);

  // Retry loop for lazy-loaded content
  let visible = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      visible = true;
      break;
    } catch {
      // Scroll container down to trigger lazy loading
      if (opts.container) {
        const container = resolveSelector(page, opts.container);
        await container.evaluate(el => el.scrollBy(0, 500));
      } else {
        await page.evaluate(() => window.scrollBy(0, 500));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (!visible) {
    throw new Error(`Could not scroll to "${selector}" after 10 attempts`);
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), scrolledTo: selector, snapshot };
}

async function waitToast(page, actionArgs, opts, helpers) {
  const { getSnapshot } = helpers;
  const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 10000;
  if (isNaN(timeout) || timeout <= 0) {
    throw new Error('--timeout must be a positive integer (milliseconds)');
  }
  const combinedSelector = ':is([role="alert"], [role="status"], [class*="toast"], [class*="snackbar"])';

  const toast = page.locator(combinedSelector).first();
  await toast.waitFor({ state: 'visible', timeout });
  const toastText = await toast.textContent();

  if (opts.dismiss) {
    const dismissBtn = toast.locator('button').first();
    if (await dismissBtn.count() > 0) {
      await dismissBtn.click({ timeout: 3000 }).catch(() => {});
    }
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), toast: (toastText || '').trim(), snapshot };
}

async function iframeAction(page, actionArgs, opts, helpers) {
  const iframeSel = actionArgs[0];
  const action = actionArgs[1];
  const frameArgs = actionArgs.slice(2);
  if (!iframeSel || !action) {
    throw new Error('Usage: iframe-action <iframe-selector> <action> [args]');
  }

  const { waitForStable, getSnapshot } = helpers;
  const frame = page.frameLocator(iframeSel);

  let actionResult;
  switch (action) {
    case 'click': {
      const sel = frameArgs[0];
      if (!sel) throw new Error('Selector required: iframe-action <iframe> click <selector>');
      if (sel.startsWith('text=')) {
        await frame.getByText(sel.slice(5)).click({ timeout: 10000 });
      } else {
        await frame.locator(sel).click({ timeout: 10000 });
      }
      await waitForStable(page, { timeout: 5000 });
      actionResult = { clicked: sel };
      break;
    }
    case 'fill': {
      const sel = frameArgs[0];
      const value = frameArgs.slice(1).join(' ');
      if (!sel || !value) throw new Error('Selector and value required: iframe-action <iframe> fill <selector> <value>');
      await frame.locator(sel).fill(value);
      actionResult = { filled: sel };
      break;
    }
    case 'read': {
      const sel = frameArgs[0];
      if (!sel) throw new Error('Selector required: iframe-action <iframe> read <selector>');
      const text = await frame.locator(sel).textContent({ timeout: 10000 });
      const { sanitizeWebContent } = helpers;
      actionResult = { content: sanitizeWebContent ? sanitizeWebContent(text || '') : (text || '') };
      break;
    }
    default:
      throw new Error(`Unknown iframe action: ${action}. Available: click, fill, read`);
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), iframe: iframeSel, ...actionResult, snapshot };
}

async function login(page, actionArgs, opts, helpers) {
  // Support env vars as a safer alternative to CLI args
  const user = opts.user || process.env.WEB_CTL_USER;
  const pass = opts.pass || process.env.WEB_CTL_PASS;
  if (!user || !pass) {
    throw new Error('Usage: login --user <username> --pass <password> [--success-selector <selector>]\n  Or set WEB_CTL_USER and WEB_CTL_PASS environment variables.');
  }
  // Use local vars instead of opts to avoid accidental exposure
  opts = { ...opts, user: undefined, pass: undefined };

  const { resolveSelector, waitForStable, getSnapshot } = helpers;

  // Auto-detect username field
  const usernameField = page.locator(
    'input[type="email"], input[autocomplete*="user"], input[autocomplete="email"], ' +
    'input[name*="user" i], input[name*="email" i], input[name*="login" i], ' +
    'input[id*="user" i], input[id*="email" i]'
  ).first();

  if (await usernameField.count() === 0 || !await usernameField.isVisible()) {
    throw new Error('Could not auto-detect username/email field. Use fill action directly.');
  }

  await usernameField.fill(user);

  // Auto-detect password field
  const passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.count() === 0) {
    throw new Error('Could not find password field. Use fill action directly.');
  }
  await passwordField.fill(pass);

  // Find and click submit
  let submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await submitBtn.count() === 0 || !await submitBtn.isVisible()) {
    // Try common button text patterns
    submitBtn = page.locator('button:is(:text("Log in"), :text("Login"), :text("Sign in"), :text("Submit"))').first();
  }

  if (await submitBtn.count() === 0) {
    throw new Error('Could not find submit button. Use click action directly.');
  }

  await submitBtn.click({ timeout: 10000 });
  await waitForStable(page, { timeout: 10000 });

  if (opts.successSelector) {
    const successLocator = resolveSelector(page, opts.successSelector);
    await successLocator.waitFor({ state: 'visible', timeout: 30000 });
  }

  const snapshot = await getSnapshot(page);
  return { url: page.url(), loggedIn: true, snapshot };
}

/**
 * Validate that a URL is safe for navigation (http/https only).
 * Prevents open-redirect attacks via javascript:, data:, or file: hrefs.
 *
 * @param {string} href - The href to validate
 * @param {string} currentUrl - The current page URL (used as base for relative URLs)
 * @returns {boolean}
 */
function isValidNavigationUrl(href, currentUrl) {
  try {
    const url = new URL(href, currentUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Navigate to a pagination target - shared between nextPage and paginate.
 * Prefers goto for clean navigation when href is a valid http(s) URL on
 * an anchor element; falls back to clicking the element otherwise.
 *
 * @param {object} page - Playwright page
 * @param {object} paginationResult - { element, href, method } from detectPaginationLink
 * @param {object} helpers - macro helpers (waitForStable required)
 */
async function navigateToPage(page, paginationResult, helpers) {
  const { element, href, method } = paginationResult;
  if (href && isValidNavigationUrl(href, page.url())) {
    if (method === 'rel-next-link' || method === 'rel-next-a') {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } else {
      // For other methods, check if it is an <a> tag
      const tagName = await element.evaluate(el => el.tagName.toLowerCase()).catch(() => 'unknown');
      if (tagName === 'a') {
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } else {
        await element.click({ timeout: 10000 });
      }
    }
  } else if (method === 'rel-next-link') {
    // <link> elements are not interactive - cannot click; invalid href means no navigation
    throw new Error('Pagination <link rel="next"> has no valid href. Cannot navigate.');
  } else {
    await element.click({ timeout: 10000 });
  }
  await helpers.waitForStable(page, { timeout: 10000 });
}

/**
 * Detect a pagination link or button on the page.
 * Tries multiple heuristics in priority order:
 *   1. rel="next" links
 *   2. ARIA role links/buttons with common next-page text
 *   3. CSS class patterns (.pagination .next, aria-label, etc.)
 *   4. Current-page number + 1 within a pagination container
 *
 * @param {object} page - Playwright page
 * @param {string} direction - 'next' (only 'next' is supported currently)
 * @returns {{ element, href, method }|null}
 */
async function detectPaginationLink(page, direction = 'next') {
  // Heuristic 1: rel="next" links
  const relNext = page.locator('a[rel="next"], link[rel="next"]');
  if (await relNext.count() > 0) {
    const first = relNext.first();
    const tagName = await first.evaluate(el => el.tagName.toLowerCase()).catch(() => 'link');
    if (tagName === 'a') {
      if (await first.isVisible().catch(() => false)) {
        const href = await first.getAttribute('href').catch(() => null);
        return { element: first, href, method: 'rel-next-a' };
      }
    } else {
      // <link rel="next"> - extract href for goto
      const href = await first.getAttribute('href').catch(() => null);
      if (href) {
        return { element: first, href, method: 'rel-next-link' };
      }
    }
  }

  // Heuristic 2: role-based links/buttons with common next-page text
  const nextPatterns = /^(Next|Next page|>|>>|\u203A|\u00BB)$/i;
  for (const role of ['link', 'button']) {
    const candidates = page.getByRole(role, { name: nextPatterns });
    if (await candidates.count() > 0) {
      const first = candidates.first();
      if (await first.isVisible().catch(() => false)) {
        const href = role === 'link' ? await first.getAttribute('href').catch(() => null) : null;
        return { element: first, href, method: 'role-text' };
      }
    }
  }

  // Heuristic 3: CSS class and aria-label patterns
  const cssPatterns = page.locator(
    '.pagination a.next, .pagination .next a, .pager-next a, ' +
    'a[aria-label*="next" i], button[aria-label*="next" i], ' +
    '[class*="pagination"] [class*="next"] a'
  );
  if (await cssPatterns.count() > 0) {
    const first = cssPatterns.first();
    if (await first.isVisible().catch(() => false)) {
      const href = await first.getAttribute('href').catch(() => null);
      return { element: first, href, method: 'css-pattern' };
    }
  }

  // Heuristic 4: Current page number N -> find link/button with text N+1
  const activePage = page.locator('[aria-current="page"], .pagination .active, .page-item.active');
  if (await activePage.count() > 0) {
    const activeText = await activePage.first().textContent().catch(() => '');
    const currentNum = parseInt((activeText || '').trim(), 10);
    if (!isNaN(currentNum)) {
      const nextNum = String(currentNum + 1);
      // Look within pagination container
      const paginationContainer = page.locator('.pagination, [role="navigation"], nav[aria-label*="pag" i]');
      if (await paginationContainer.count() > 0) {
        const container = paginationContainer.first();
        for (const role of ['link', 'button']) {
          const numLink = container.getByRole(role, { name: nextNum, exact: true });
          if (await numLink.count() > 0) {
            const el = numLink.first();
            if (await el.isVisible().catch(() => false)) {
              const href = role === 'link' ? await el.getAttribute('href').catch(() => null) : null;
              return { element: el, href, method: 'page-number' };
            }
          }
        }
      }
    }
  }

  return null;
}

async function nextPage(page, actionArgs, opts, helpers) {
  const result = await detectPaginationLink(page, 'next');
  if (!result) {
    throw new Error('No pagination controls detected. The page may not have pagination or uses an unsupported pattern.');
  }

  const previousUrl = page.url();
  await navigateToPage(page, result, helpers);
  const snapshot = await helpers.getSnapshot(page);
  return { url: page.url(), previousUrl, nextPageDetected: result.method, snapshot };
}

async function paginate(page, actionArgs, opts, helpers) {
  if (!opts.selector) {
    throw new Error('Usage: paginate --selector <css-selector> [--max-pages N] [--max-items N]');
  }

  if (opts.maxPages != null && isNaN(parseInt(opts.maxPages, 10))) {
    throw new Error('Invalid --max-pages value. Must be a number.');
  }
  if (opts.maxItems != null && isNaN(parseInt(opts.maxItems, 10))) {
    throw new Error('Invalid --max-items value. Must be a number.');
  }

  const maxPages = Math.min(Math.max(parseInt(opts.maxPages, 10) || 5, 1), 20);
  const maxItems = Math.min(Math.max(parseInt(opts.maxItems, 10) || 100, 1), 500);
  const PER_PAGE_CAP = 1000;

  const startUrl = page.url();
  const allItems = [];
  let pagesVisited = 0;
  let hasMore = false;

  for (let i = 0; i < maxPages; i++) {
    pagesVisited++;

    // Extract items from current page via single page function call
    // instead of N+1 async textContent() queries per element.
    let texts = await page.$$eval(opts.selector, els =>
      els.map(el => (el.textContent || '').trim()).filter(Boolean)
    );

    // Bound per-page results to prevent memory exhaustion
    if (texts.length > PER_PAGE_CAP) {
      texts = texts.slice(0, PER_PAGE_CAP);
    }

    // Respect maxItems: only take what we still need
    const remaining = maxItems - allItems.length;
    if (texts.length > remaining) {
      allItems.push(...texts.slice(0, remaining));
      hasMore = true;
      break;
    }
    allItems.push(...texts);

    // Detect next page BEFORE checking page limit - this lets us accurately
    // report hasMore based on whether a next page actually exists.
    const next = await detectPaginationLink(page, 'next');
    if (!next) {
      // No more pages available
      break;
    }

    // A next page exists. If we have hit the page limit, report hasMore and stop.
    if (pagesVisited >= maxPages) {
      hasMore = true;
      break;
    }

    // Navigate to next page using shared helper (validates URL protocol)
    await helpers.randomDelay();
    await navigateToPage(page, next, helpers);
  }

  const snapshot = await helpers.getSnapshot(page);
  return {
    url: page.url(),
    startUrl,
    pages: pagesVisited,
    totalItems: allItems.length,
    items: allItems,
    hasMore,
    snapshot
  };
}

/**
 * Extract structured data from repeated list items on a page.
 *
 * Two modes:
 *   --selector <sel> [--fields f1,f2,...]  Extract from elements matching a CSS selector
 *   --auto                                 Auto-detect repeated siblings
 *
 * @param {object} page - Playwright page
 * @param {string[]} actionArgs - positional args (unused)
 * @param {object} opts - parsed options
 * @param {object} helpers - macro helpers
 */
async function extract(page, actionArgs, opts, helpers) {
  const hasSelector = !!opts.selector;
  const hasAuto = !!opts.auto;

  if (!hasSelector && !hasAuto) {
    throw new Error('Usage: extract --selector <css-selector> [--fields f1,f2,...] [--max-items N]\n  Or:  extract --auto [--max-items N]');
  }
  if (hasSelector && hasAuto) {
    throw new Error('Cannot use both --selector and --auto. Choose one mode.');
  }
  if (hasAuto && opts.fields) {
    throw new Error('--fields is only valid with --selector mode, not --auto.');
  }
  if (opts.maxItems != null && isNaN(parseInt(opts.maxItems, 10))) {
    throw new Error('Invalid --max-items value. Must be a number.');
  }
  if (opts.maxFieldLength != null && isNaN(parseInt(opts.maxFieldLength, 10))) {
    throw new Error('Invalid --max-field-length value. Must be a number.');
  }

  const maxItems = Math.min(Math.max(parseInt(opts.maxItems, 10) || 100, 1), 500);
  const fieldMaxLen = Math.min(Math.max(parseInt(opts.maxFieldLength, 10) || 500, 1), 2000);
  const VALID_FIELD_RE = /^[a-zA-Z0-9_-]+$/;

  if (hasSelector) {
    // Selector mode
    const fields = opts.fields
      ? opts.fields.split(',').map(f => f.trim()).filter(Boolean)
      : ['title', 'url', 'text'];

    for (const f of fields) {
      if (!VALID_FIELD_RE.test(f)) {
        throw new Error(`Invalid field name "${f}". Only letters, numbers, hyphens, underscores allowed.`);
      }
    }

    const items = await page.$$eval(opts.selector, function extractFields(els, args) {
      var fieldNames = args[0];
      var cap = args[1];
      var maxLen = args[2];

      function truncate(s) {
        if (typeof s !== 'string') return s;
        return s.length > maxLen ? s.slice(0, maxLen) : s;
      }

      function extractField(el, name) {
        switch (name) {
          case 'title': {
            var h = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"]');
            return h ? truncate((h.textContent || '').trim()) : null;
          }
          case 'url': {
            var a = el.querySelector('a[href]');
            return a ? a.getAttribute('href') : null;
          }
          case 'author': {
            var au = el.querySelector('[class*="author"], [rel="author"]');
            return au ? truncate((au.textContent || '').trim()) : null;
          }
          case 'date': {
            var t = el.querySelector('time[datetime]');
            if (t) return t.getAttribute('datetime');
            var d = el.querySelector('[class*="date"]');
            return d ? truncate((d.textContent || '').trim()) : null;
          }
          case 'tags': {
            var tagEls = el.querySelectorAll('[class*="tag"]');
            if (tagEls.length === 0) return null;
            var arr = [];
            for (var i = 0; i < tagEls.length && i < 20; i++) {
              arr.push(truncate((tagEls[i].textContent || '').trim()));
            }
            return arr;
          }
          case 'text': {
            return truncate((el.textContent || '').trim());
          }
          case 'image': {
            var img = el.querySelector('img[src]');
            return img ? img.getAttribute('src') : null;
          }
          default: {
            // Generic: try [class*=name] (sanitize for defense-in-depth)
            var safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
            if (!safeName) return null;
            var gen = el.querySelector('[class*="' + safeName + '"]');
            return gen ? truncate((gen.textContent || '').trim()) : null;
          }
        }
      }

      var results = [];
      for (var i = 0; i < els.length && results.length < cap; i++) {
        var item = {};
        for (var j = 0; j < fieldNames.length; j++) {
          var val = extractField(els[i], fieldNames[j]);
          if (val != null) item[fieldNames[j]] = val;
        }
        if (Object.keys(item).length > 0) results.push(item);
      }
      return results;
    }, [fields, maxItems, fieldMaxLen]);

    const snapshot = await helpers.getSnapshot(page);
    return {
      url: page.url(),
      mode: 'selector',
      selector: opts.selector,
      fields,
      count: items.length,
      items,
      ...(snapshot != null && { snapshot })
    };
  }

  // Auto-detect mode - uses page.evaluate with a self-contained function
  const result = await page.evaluate(function autoDetect(cap, fieldMax) {
    var FIELD_MAX = fieldMax;

    function truncate(s) {
      if (typeof s !== 'string') return s;
      return s.length > FIELD_MAX ? s.slice(0, FIELD_MAX) : s;
    }

    function getSignature(el) {
      var children = el.children;
      var tags = [];
      for (var i = 0; i < children.length; i++) {
        tags.push(children[i].tagName);
      }
      tags.sort();
      return tags.join(',');
    }

    function isContentArea(el) {
      var node = el;
      while (node) {
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tag === 'main' || tag === 'article') return true;
        var role = node.getAttribute ? node.getAttribute('role') : null;
        if (role === 'main') return true;
        node = node.parentElement;
      }
      return false;
    }

    function isNavArea(el) {
      var node = el;
      while (node) {
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tag === 'nav' || tag === 'header' || tag === 'footer') return true;
        node = node.parentElement;
      }
      return false;
    }

    function isTableGroup(group) {
      if (group.tag !== 'TR') return false;
      var parentTag = group.parent.tagName;
      return parentTag === 'TBODY' || parentTag === 'THEAD' || parentTag === 'TABLE';
    }

    function getTableHeaders(group) {
      var tableEl = group.parent;
      var depth = 0;
      while (tableEl && tableEl.tagName !== 'TABLE' && depth++ < 10) {
        tableEl = tableEl.parentElement;
      }
      if (!tableEl || tableEl.tagName !== 'TABLE') return null;

      var headers = [];
      var headerRow = null;

      var thead = null;
      var tableChildren = tableEl.children;
      for (var tc = 0; tc < tableChildren.length; tc++) {
        if (tableChildren[tc].tagName === 'THEAD') { thead = tableChildren[tc]; break; }
      }
      if (thead) {
        var firstTR = thead.children[0];
        if (firstTR && firstTR.tagName === 'TR') {
          var ths = firstTR.children;
          for (var i = 0; i < ths.length; i++) {
            if (ths[i].tagName !== 'TH') continue;
            var colspan = ths[i].getAttribute('colspan');
            if (colspan && parseInt(colspan, 10) > 1) return null;
            var text = (ths[i].textContent || '').trim();
            headers.push(text || ('column_' + (i + 1)));
          }
          if (headers.length > 0) headerRow = firstTR;
        }
      }

      // If no <thead> headers, check if first element in group has all <th> children
      if (headers.length === 0) {
        var firstEl = group.elements[0];
        var children = firstEl.children;
        var allTH = children.length > 0;
        for (var j = 0; j < children.length; j++) {
          if (children[j].tagName !== 'TH') {
            allTH = false;
            break;
          }
        }
        if (allTH) {
          for (var m = 0; m < children.length; m++) {
            var cs = children[m].getAttribute('colspan');
            if (cs && parseInt(cs, 10) > 1) return null;
            var txt = (children[m].textContent || '').trim();
            headers.push(txt || ('column_' + (m + 1)));
          }
          headerRow = firstEl;
        }
      }

      if (headers.length === 0) return null;
      return { headers: headers, headerRow: headerRow };
    }

    // Walk all elements, group siblings by parent + tagName
    // Use a separate Map to track parent IDs (avoids mutating DOM nodes)
    var groups = {};
    var parentIdMap = new Map();
    var nextId = 0;
    var allElements = document.body.querySelectorAll('*');
    var elementLimit = Math.min(allElements.length, 10000);
    for (var i = 0; i < elementLimit; i++) {
      var el = allElements[i];
      var parent = el.parentElement;
      if (!parent) continue;
      var tag = el.tagName;
      if (!parentIdMap.has(parent)) {
        parentIdMap.set(parent, 'g' + (nextId++));
      }
      var key = parentIdMap.get(parent) + ':' + tag;
      if (!groups[key]) {
        groups[key] = { parent: parent, tag: tag, elements: [], signature: null };
      }
      groups[key].elements.push(el);
    }

    // Compute structural signatures and find the best group
    var bestGroup = null;
    var bestScore = 0;

    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
      var group = groups[keys[k]];
      if (group.elements.length < 3) continue;

      // Cache signature on first element, then compare
      var sig = getSignature(group.elements[0]);
      var allSame = true;
      for (var s = 1; s < group.elements.length; s++) {
        if (getSignature(group.elements[s]) !== sig) {
          allSame = false;
          break;
        }
      }
      if (!allSame) continue;

      var score = group.elements.length;
      if (isContentArea(group.parent)) score *= 3;
      if (isNavArea(group.parent)) score *= 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (!bestGroup) {
      return { error: 'No repeated pattern detected on this page.' };
    }

    // Build a CSS selector for the detected group
    function escapeCSS(s) {
      return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }
    function isAutoGeneratedId(id) {
      if (/^\d+$/.test(id)) return true;
      if (/^[a-f0-9]{6,}$/i.test(id)) return true;
      if (/^[a-z][a-f0-9]{6,}$/i.test(id)) return true;
      if (/[:.]/.test(id)) return true;
      if (/^(ext-|ember|yui_|ng-|rc-|__)/i.test(id)) return true;
      return false;
    }
    function buildSelector(parent, tag) {
      var parts = [];
      var node = parent;
      while (node && node !== document.body && node !== document.documentElement) {
        var nTag = node.tagName.toLowerCase();
        if (node.id && !isAutoGeneratedId(node.id)) {
          parts.unshift('#' + escapeCSS(node.id));
          break;
        }
        var cls = '';
        if (node.className && typeof node.className === 'string') {
          var classes = node.className.trim().split(/\s+/).slice(0, 2);
          cls = classes.map(function(c) { return '.' + escapeCSS(c); }).join('');
        }
        parts.unshift(nTag + cls);
        node = node.parentElement;
      }
      if (parts.length === 0) parts.push('body');
      parts.push(tag.toLowerCase());
      return parts.join(' > ');
    }

    var detectedSelector = buildSelector(bestGroup.parent, bestGroup.tag);

    // Extract common fields from each element
    function extractItem(el) {
      var item = {};
      var h = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"]');
      if (h) item.title = truncate((h.textContent || '').trim());
      var a = el.querySelector('a[href]');
      if (a) item.url = a.getAttribute('href');
      var au = el.querySelector('[class*="author"], [rel="author"]');
      if (au) item.author = truncate((au.textContent || '').trim());
      var t = el.querySelector('time[datetime]');
      if (t) { item.date = t.getAttribute('datetime'); }
      else {
        var d = el.querySelector('[class*="date"]');
        if (d) item.date = truncate((d.textContent || '').trim());
      }
      var img = el.querySelector('img[src]');
      if (img) item.image = img.getAttribute('src');
      if (!item.title) {
        item.text = truncate((el.textContent || '').trim());
      }
      return item;
    }

    function extractTableRow(tr, headers) {
      var item = {};
      var cells = tr.children;
      var hi = 0;
      for (var i = 0; i < cells.length && hi < headers.length; i++) {
        if (cells[i].tagName !== 'TD') continue;
        var cellText = truncate((cells[i].textContent || '').trim());
        if (cellText) {
          item[headers[hi]] = cellText;
        }
        hi++;
      }
      var a = tr.querySelector('a[href]');
      if (a) item.url = a.getAttribute('href');
      return item;
    }

    var tableHeaders = null;
    var headerRow = null;
    if (isTableGroup(bestGroup)) {
      var th = getTableHeaders(bestGroup);
      if (th) {
        tableHeaders = th.headers;
        headerRow = th.headerRow;
      }
    }

    var items = [];
    var els = bestGroup.elements;
    for (var e = 0; e < els.length && items.length < cap; e++) {
      var item;
      if (tableHeaders && els[e] !== headerRow) {
        item = extractTableRow(els[e], tableHeaders);
      } else if (!tableHeaders) {
        item = extractItem(els[e]);
      } else {
        continue;
      }
      if (Object.keys(item).length > 0) items.push(item);
    }

    return {
      items: items,
      selector: detectedSelector,
      count: items.length
    };
  }, maxItems, fieldMaxLen);

  if (result.error) {
    throw new Error(result.error);
  }

  const snapshot = await helpers.getSnapshot(page);

  // Determine which fields were found across items
  const fieldSet = new Set();
  for (const item of result.items) {
    for (const key of Object.keys(item)) {
      fieldSet.add(key);
    }
  }

  return {
    url: page.url(),
    mode: 'auto',
    selector: result.selector,
    fields: Array.from(fieldSet),
    count: result.count,
    items: result.items,
    ...(snapshot != null && { snapshot })
  };
}

const macros = {
  'select-option': selectOption,
  'tab-switch': tabSwitch,
  'modal-dismiss': modalDismiss,
  'form-fill': formFill,
  'search-select': searchSelect,
  'date-pick': datePick,
  'file-upload': fileUpload,
  'hover-reveal': hoverReveal,
  'scroll-to': scrollTo,
  'wait-toast': waitToast,
  'iframe-action': iframeAction,
  'login': login,
  'next-page': nextPage,
  'paginate': paginate,
  'extract': extract
};

// Standalone copies for unit testing (no browser APIs)
function escapeCSS(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isAutoGeneratedId(id) {
  if (/^\d+$/.test(id)) return true;
  if (/^[a-f0-9]{6,}$/i.test(id)) return true;
  if (/^[a-z][a-f0-9]{6,}$/i.test(id)) return true;
  if (/[:.]/.test(id)) return true;
  if (/^(ext-|ember|yui_|ng-|rc-|__)/i.test(id)) return true;
  return false;
}

function buildSelector(ancestors, tag) {
  var parts = [];
  for (var i = 0; i < ancestors.length; i++) {
    var node = ancestors[i];
    var nTag = node.tagName.toLowerCase();
    if (node.id && !isAutoGeneratedId(node.id)) {
      parts.unshift('#' + escapeCSS(node.id));
      break;
    }
    var cls = '';
    if (node.className && typeof node.className === 'string') {
      var classes = node.className.trim().split(/\s+/).slice(0, 2);
      cls = classes.map(function(c) { return '.' + escapeCSS(c); }).join('');
    }
    parts.unshift(nTag + cls);
  }
  if (parts.length === 0) parts.push('body');
  parts.push(tag.toLowerCase());
  return parts.join(' > ');
}

module.exports = { macros, _internal: { escapeCSS, isAutoGeneratedId, buildSelector } };
