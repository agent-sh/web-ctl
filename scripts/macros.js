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
  const allowedPrefixes = ['/tmp/', process.cwd() + '/'];
  const uploadDir = process.env.WEB_CTL_UPLOAD_DIR;
  if (uploadDir) allowedPrefixes.push(path.resolve(uploadDir) + '/');
  const allowed = allowedPrefixes.some(prefix => resolved.startsWith(prefix));
  if (!allowed) {
    throw new Error(`File path must be within /tmp, the working directory, or WEB_CTL_UPLOAD_DIR. Got: ${resolved}`);
  }
  // Extra guard for dotfiles even within allowed dirs
  if (/\/\.[a-z]/i.test(resolved)) {
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
        return { element: first, href, method: 'rel-next' };
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

  // Prefer goto for clean navigation when href is available on a link
  if (result.href && result.method !== 'role-text') {
    await page.goto(result.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } else if (result.href && result.element) {
    // For role-text links with href, try goto first
    const tagName = await result.element.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
    if (tagName === 'a') {
      await page.goto(result.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } else {
      await result.element.click({ timeout: 10000 });
    }
  } else {
    await result.element.click({ timeout: 10000 });
  }

  await helpers.waitForStable(page, { timeout: 10000 });
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

  const startUrl = page.url();
  const allItems = [];
  let pagesVisited = 0;
  let hasMore = false;

  for (let i = 0; i < maxPages; i++) {
    pagesVisited++;

    // Extract items from current page
    const elements = await page.locator(opts.selector).all();
    for (const el of elements) {
      const text = (await el.textContent() || '').trim();
      if (text) {
        allItems.push(text);
      }
    }

    // Check item limit
    if (allItems.length >= maxItems) {
      allItems.length = maxItems;
      hasMore = true;
      break;
    }

    // Detect next page
    const next = await detectPaginationLink(page, 'next');
    if (!next) {
      break;
    }

    // If this is the last allowed page, mark hasMore and stop
    if (pagesVisited === maxPages) {
      hasMore = true;
      break;
    }

    // Navigate to next page
    if (next.href && next.element) {
      const tagName = await next.element.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tagName === 'a' || next.method === 'rel-next-link') {
        await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } else {
        await next.element.click({ timeout: 10000 });
      }
    } else if (next.element) {
      await next.element.click({ timeout: 10000 });
    }

    await helpers.randomDelay();
    await helpers.waitForStable(page, { timeout: 10000 });
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
  'paginate': paginate
};

module.exports = { macros };
