#!/usr/bin/env node
'use strict';

const sessionStore = require('./session-store');
const { launchBrowser, closeBrowser, randomDelay, waitForStable, waitForLoaded, canLaunchHeaded } = require('./browser-launcher');
const { detectAuthWall, detectContentBlocked } = require('./auth-wall-detect');
const { runAuthFlow } = require('./auth-flow');
const { checkAuthSuccess } = require('./auth-check');
const { sanitizeWebContent, wrapOutput } = require('./redact');
const { listProviders, resolveAuthOptions, loadCustomProviders } = require('./auth-providers');
const { macros } = require('./macros');

const path = require('path');

const [,, ...args] = process.argv;

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_SCHEMES = /^https?:\/\//i;

const BOOLEAN_FLAGS = new Set([
  '--no-snapshot', '--wait-stable', '--vnc',
  '--bind-remote',
  '--exact', '--accept', '--submit', '--dismiss', '--auto',
  '--snapshot-collapse', '--snapshot-text-only', '--snapshot-compact',
  '--snapshot-full', '--no-auth-wall-detect', '--no-content-block-detect', '--no-auto-recover', '--ensure-auth', '--wait-loaded',
]);

function validateSessionName(name) {
  if (!name || !SESSION_NAME_RE.test(name)) {
    throw new Error(`Invalid session name "${name}". Use only letters, numbers, hyphens, underscores (max 64 chars).`);
  }
}

// Hostnames that resolve to cloud metadata endpoints; rejected before DNS.
const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const IPV4_PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '0.0.0.0/8',
];

function isPrivateIpv4(ip) {
  return IPV4_PRIVATE_CIDRS.some(cidr => ipv4InCidr(ip, cidr));
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7  (unique local)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // fec0::/10 (deprecated site-local, RFC 3879) — still treat as private
  if (/^fe[cdef][0-9a-f]:/i.test(lower)) return true;
  // 100::/64 discard prefix (RFC 6666)
  if (/^0?100:0{0,4}:0{0,4}:0{0,4}:/i.test(lower) || lower.startsWith('100::')) return true;
  // 2001:db8::/32 documentation prefix (RFC 3849) — should never be reachable
  if (/^2001:0?db8:/i.test(lower)) return true;
  // IPv4-mapped IPv6, dotted form: ::ffff:a.b.c.d
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);
  // IPv4-mapped IPv6, hex form: ::ffff:HHHH:LLLL (e.g. ::ffff:7f00:1 = 127.0.0.1)
  // URL parsers (including Node's WHATWG URL) may normalize dotted-form to hex,
  // so we MUST match this shape or SSRF guards can be bypassed trivially.
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIpv4(ipv4);
    }
  }
  return false;
}

/**
 * Validate a URL string, synchronously checking scheme.
 *
 * This function stays sync for backward compat with all existing call sites.
 * SSRF denylist checks (DNS-based) live in assertUrlAllowed below; call that
 * from async contexts for full validation.
 */
function validateUrl(url) {
  if (!url || !ALLOWED_SCHEMES.test(url)) {
    throw new Error(`Invalid URL scheme. Only http:// and https:// URLs are allowed. Got: ${url}`);
  }
}

/**
 * Full URL validation including SSRF denylist.
 * Resolves the hostname via DNS and rejects private / loopback / link-local
 * / cloud-metadata addresses. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to opt out
 * (useful for local dev against localhost or a private staging server).
 */
async function assertUrlAllowed(url) {
  validateUrl(url);
  if (process.env.WEB_CTL_ALLOW_PRIVATE_NETWORK === '1') return;

  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  let host = parsed.hostname;
  // Strip brackets from IPv6 literals
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const lowerHost = host.toLowerCase();

  if (METADATA_HOSTS.has(lowerHost)) {
    throw new Error(`Blocked cloud metadata hostname: ${host}. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to override.`);
  }

  // Fast-path: if host is already an IP literal, check directly without DNS.
  const net = require('net');
  const family = net.isIP(host);
  if (family === 4) {
    if (isPrivateIpv4(host)) {
      throw new Error(`Blocked private/loopback IPv4 address: ${host}. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to override.`);
    }
    return;
  }
  if (family === 6) {
    if (isPrivateIpv6(host)) {
      throw new Error(`Blocked private/loopback IPv6 address: ${host}. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to override.`);
    }
    return;
  }

  // Otherwise resolve via DNS. If DNS itself fails (ENOTFOUND, offline, etc.)
  // we don't turn that into an SSRF rejection — the real network call will
  // fail naturally and give the caller a proper error. We only reject when
  // DNS succeeds and returns a private/loopback address.
  const dns = require('dns').promises;
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    return;
  }

  for (const { address, family: f } of addresses) {
    if (f === 4 && isPrivateIpv4(address)) {
      throw new Error(`Host ${host} resolves to private/loopback address ${address}. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to override.`);
    }
    if (f === 6 && isPrivateIpv6(address)) {
      throw new Error(`Host ${host} resolves to private/loopback IPv6 ${address}. Set WEB_CTL_ALLOW_PRIVATE_NETWORK=1 to override.`);
    }
  }
}

/**
 * Install a Playwright route handler that re-validates every navigation
 * the page performs (initial, redirects, and JS-initiated navigations),
 * mitigating DNS-rebinding TOCTOU on the SSRF guard.
 *
 * KNOWN RESIDUAL RISK: Playwright's `dns.lookup` during the actual connect
 * is outside our control, so a sufficiently racy DNS server can still
 * return a private IP between our validation and Playwright's connection.
 * The full fix needs a custom dispatcher that pins the resolved IP and
 * sets the `Host:` header to the original hostname — not currently
 * expressible cleanly in Playwright's API. This re-check narrows the
 * window significantly (every navigation is re-validated) but does not
 * close it completely. We accept that residual risk and document it here.
 */
async function installSsrfGuard(page) {
  // Bypass when the operator has opted out. Checked at install time so we
  // don't register a no-op handler on every page.
  if (process.env.WEB_CTL_ALLOW_PRIVATE_NETWORK === '1') return;
  try {
    await page.route('**/*', async (route) => {
      const request = route.request();
      // Only gate top-level navigations and sub-document loads; gating every
      // image/script/xhr is too expensive and the concern here is the page's
      // own navigation target, not subresources (which share origin checks).
      const type = request.resourceType();
      if (type !== 'document' && type !== 'other') {
        return route.continue();
      }
      try {
        await assertUrlAllowed(request.url());
      } catch (err) {
        return route.abort('addressunreachable');
      }
      return route.continue();
    });
  } catch { /* best-effort; older Playwright or closed page */ }
}

/**
 * Gate for `evaluate` action. Executing arbitrary JS in a page with live
 * cookies is a significant capability, so we require explicit opt-in via
 * env var, plus either an interactive y/N on a TTY or a pre-computed hash
 * confirmation for agent/non-TTY callers.
 *
 * Non-TTY flow: the caller must set WEB_CTL_EVALUATE_CONFIRM to the first
 * 16 chars of sha256(code). This ensures the agent that chose the code is
 * the same one that authorized it — prompt-injected strings cannot smuggle
 * a valid hash without knowing the code.
 */
async function confirmEvaluate(code) {
  if (process.env.WEB_CTL_ALLOW_EVALUATE !== '1') {
    throw new Error(
      'evaluate is disabled. Set WEB_CTL_ALLOW_EVALUATE=1 to enable. ' +
      'This action executes arbitrary JS in the browser context.'
    );
  }

  const crypto = require('crypto');
  const expected = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);

  if (process.stdin.isTTY) {
    process.stderr.write(
      '\n[web-ctl] About to evaluate JavaScript in the page:\n' +
      '  ' + code.replace(/\n/g, '\n  ') + '\n' +
      '[web-ctl] Continue? [y/N]: '
    );
    const answer = await new Promise((resolve) => {
      let buf = '';
      const onData = (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.includes('\n')) {
          process.stdin.removeListener('data', onData);
          try { process.stdin.pause(); } catch { /* ignore */ }
          resolve(buf.trim().toLowerCase());
        }
      };
      try { process.stdin.resume(); } catch { /* ignore */ }
      process.stdin.on('data', onData);
    });
    if (answer !== 'y' && answer !== 'yes') {
      throw new Error('evaluate aborted by user.');
    }
    return;
  }

  const confirm = process.env.WEB_CTL_EVALUATE_CONFIRM;
  // We intentionally do NOT include the expected hash in the error message.
  // Leaking the correct value would let a prompt-injected call simply copy
  // it into the env var and defeat the guard. The calling agent must compute
  // sha256(code).hex().slice(0,16) itself — that's the whole point of the
  // scheme (it proves the agent chose the code).
  if (!confirm) {
    throw new Error(
      'evaluate from non-TTY caller requires WEB_CTL_EVALUATE_CONFIRM to be set ' +
      'to the first 16 hex chars of sha256(code). Compute it yourself; we will ' +
      'not echo the expected value.'
    );
  }
  if (confirm.toLowerCase() !== expected) {
    throw new Error(
      'WEB_CTL_EVALUATE_CONFIRM hash mismatch; refusing to run. This guard ' +
      'prevents prompt-injected code from being executed with a stale or ' +
      'attacker-chosen confirmation. Recompute sha256(code).slice(0,16).'
    );
  }
}

function output(data) {
  console.log(JSON.stringify(wrapOutput(data), null, 2));
}

function parseOptions(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = args[i + 1];
      if (next && !next.startsWith('--') && !BOOLEAN_FLAGS.has(args[i])) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

/**
 * Match a provider by domain from providers.json.
 * Uses a lazy-loaded Map keyed by domain for O(1) lookup.
 */
let _providerDomainMap = null;
function matchProviderByDomain(url) {
  if (!_providerDomainMap) {
    _providerDomainMap = new Map();
    try {
      const providers = require('./providers.json');
      for (const p of providers) {
        try {
          const domain = new URL(p.loginUrl).hostname;
          _providerDomainMap.set(domain, p);
        } catch {
          // Skip provider with invalid loginUrl
        }
      }
    } catch {
      // providers.json load failed - return null for all lookups
    }
  }

  try {
    const domain = new URL(url).hostname;
    return _providerDomainMap.get(domain) || null;
  } catch {
    return null;
  }
}

/**
 * Cached result for canLaunchHeaded (display availability rarely changes mid-session).
 * TTL: 60 seconds.
 */
let _headedCache = null;
let _headedCacheTime = 0;
const HEADED_CACHE_TTL = 60000;
async function cachedCanLaunchHeaded() {
  if (_headedCache !== null && Date.now() - _headedCacheTime < HEADED_CACHE_TTL) {
    return _headedCache;
  }
  _headedCache = await canLaunchHeaded();
  _headedCacheTime = Date.now();
  return _headedCache;
}

/**
 * Convert selector string to Playwright locator.
 */
function resolveSelector(page, selector) {
  if (!selector) return null;

  if (selector.startsWith('role=')) {
    const match = selector.match(/^role=(\w+)(?:\[name=['"](.+)['"]\])?/);
    if (match) {
      const opts = match[2] ? { name: match[2] } : {};
      return page.getByRole(match[1], opts);
    }
  }

  if (selector.startsWith('text=')) {
    return page.getByText(selector.slice(5));
  }

  if (selector.startsWith('css=')) {
    return page.locator(selector.slice(4));
  }

  if (selector.startsWith('#')) {
    return page.locator(selector);
  }

  // Default: treat as CSS selector
  return page.locator(selector);
}

/**
 * Detect the main content area of the page.
 * Tries <main>, then [role="main"], then falls back to <body>.
 * When a main landmark is found, also captures adjacent complementary
 * landmarks (aside, [role="complementary"]) and returns a virtual locator
 * whose ariaSnapshot() concatenates all regions.
 *
 * @param {object} page - Playwright page object
 * @returns {object} Playwright locator (or virtual locator) for the main content area
 */
async function detectMainContent(page) {
  try {
    const mainTag = page.locator('main').first();
    const mainRole = page.locator('[role="main"]').first();
    const [mainCount, roleCount] = await Promise.all([mainTag.count(), mainRole.count()]);

    let mainLocator = null;
    let compSelector = null;
    if (mainCount > 0) {
      mainLocator = mainTag;
      compSelector = 'main ~ aside, main ~ [role="complementary"]';
    } else if (roleCount > 0) {
      mainLocator = mainRole;
      compSelector = '[role="main"] ~ aside, [role="main"] ~ [role="complementary"]';
    }

    if (mainLocator) {
      try {
        const compLocator = page.locator(compSelector);
        const compCount = await compLocator.count();
        if (compCount > 0) {
          const cap = Math.min(compCount, 3);
          return {
            ariaSnapshot: async () => {
              const parts = [await mainLocator.ariaSnapshot()];
              await Promise.all(Array.from({ length: cap }, (_, i) =>
                compLocator.nth(i).ariaSnapshot().then(s => { parts[i + 1] = s; }).catch(() => {})
              ));
              return parts.filter(Boolean).join('\n');
            }
          };
        }
      } catch { /* complementary detection failed, return main only */ }
      return mainLocator;
    }
  } catch {
    // fall through to body
  }
  return page.locator('body');
}

/**
 * Get accessibility tree snapshot formatted as text.
 * Uses Playwright's ariaSnapshot API (page.accessibility was removed in v1.50+).
 *
 * @param {object} page - Playwright page object
 * @param {object} [opts={}] - Snapshot options
 * @param {boolean} [opts.noSnapshot] - Return null to omit snapshot entirely
 * @param {string} [opts.snapshotSelector] - Scope snapshot to a DOM subtree
 * @param {boolean} [opts.snapshotFull] - Use full page body (skip <main> auto-detection)
 * @param {number} [opts.snapshotDepth] - Limit ARIA tree depth
 * @param {boolean} [opts.snapshotCompact] - Compact format for token efficiency
 * @param {boolean} [opts.snapshotCollapse] - Collapse repeated siblings
 * @param {boolean} [opts.snapshotTextOnly] - Strip structural nodes, keep content
 * @param {number} [opts.snapshotMaxLines] - Truncate to N lines
 */
async function getSnapshot(page, opts = {}) {
  if (opts.noSnapshot) return null;
  try {
    const root = opts.snapshotSelector
      ? resolveSelector(page, opts.snapshotSelector)
      : opts.snapshotFull
        ? page.locator('body')
        : await detectMainContent(page);
    const raw = await root.ariaSnapshot();
    let result = raw;
    if (opts.snapshotDepth) result = trimByDepth(result, opts.snapshotDepth);
    if (opts.snapshotCompact) result = compactFormat(result);
    if (opts.snapshotCollapse) result = collapseRepeated(result);
    if (opts.snapshotTextOnly) result = textOnly(result);
    if (opts.snapshotMaxLines) result = trimByLines(result, opts.snapshotMaxLines);
    return result;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[WARN] ariaSnapshot failed:', msg);
    return `(accessibility tree unavailable - ${msg})`;
  }
}

/**
 * Trim ARIA snapshot output by indentation depth.
 * Lines at depth >= maxDepth are removed; truncation markers are inserted
 * at the first cut point of each contiguous removed block.
 *
 * @param {string} snapshot - ARIA snapshot text
 * @param {number} maxDepth - Maximum depth to keep (depth 0 = top-level)
 * @returns {string} Trimmed snapshot
 */
function trimByDepth(snapshot, maxDepth) {
  if (maxDepth == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');
  const result = [];
  let prevCut = false;

  for (const line of lines) {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);

    if (depth < maxDepth) {
      result.push(line);
      prevCut = false;
    } else if (!prevCut) {
      // Insert truncation marker at the parent's indentation + one level
      const markerIndent = ' '.repeat(depth * 2);
      result.push(`${markerIndent}- ...`);
      prevCut = true;
    }
    // else: consecutive cut lines, skip (no duplicate markers)
  }

  return result.join('\n');
}

/**
 * Compact snapshot for token-efficient LLM consumption.
 * Applies four transforms in sequence:
 * 1. Link collapsing: merges link + child /url into a single line
 * 2. Heading inlining: merges heading with single link child
 * 3. Decorative image removal: strips img nodes with empty or single-char alt text
 * 4. Duplicate URL dedup: removes second occurrence of the same URL at the same depth scope
 *
 * @param {string} snapshot - ARIA snapshot text
 * @returns {string} Compacted snapshot
 */
function compactFormat(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  let lines = snapshot.split('\n');

  // --- Pass 1: Link collapsing ---
  // Pattern: "- link "Title":" followed by child "- /url: /path"
  // Collapsed to: "- link "Title" -> /path"
  const linkCollapsed = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    // Check if this is a link line with a colon suffix (has children)
    const linkMatch = content.match(/^- link "([^"]+)":/);
    if (linkMatch) {
      const parentDepth = Math.floor(spaces / 2);

      // Collect children
      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        let cs = 0;
        while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
        if (Math.floor(cs / 2) > parentDepth) {
          children.push({ index: j, line: lines[j], depth: Math.floor(cs / 2) });
          j++;
        } else {
          break;
        }
      }

      // Find /url: child among direct children (depth === parentDepth + 1)
      const urlChildIdx = children.findIndex(c =>
        c.depth === parentDepth + 1 && c.line.trim().match(/^- \/url: (\S+)/)
      );

      if (urlChildIdx !== -1) {
        const urlMatch = children[urlChildIdx].line.trim().match(/^- \/url: (\S+)/);
        const url = urlMatch[1];
        const otherChildren = children.filter((_, idx) => idx !== urlChildIdx);

        if (otherChildren.length === 0) {
          // Simple case: link + /url only -> merge to single line
          linkCollapsed.push(`${' '.repeat(spaces)}- link "${linkMatch[1]}" -> ${url}`);
        } else {
          // Link has extra children beyond /url: append -> url to parent, keep other children
          linkCollapsed.push(`${' '.repeat(spaces)}- link "${linkMatch[1]}" -> ${url}:`);
          for (const child of otherChildren) {
            linkCollapsed.push(child.line);
          }
        }
        i = j;
        continue;
      }
    }

    linkCollapsed.push(line);
    i++;
  }
  lines = linkCollapsed;

  // --- Pass 2: Heading inlining ---
  // Pattern: heading with [level=N] and single link child -> merged
  const headingInlined = [];
  i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    const headingMatch = content.match(/^- heading "([^"]+)" \[level=(\d+)\]:/);
    if (headingMatch) {
      const parentDepth = Math.floor(spaces / 2);

      // Collect direct children
      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        let cs = 0;
        while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
        if (Math.floor(cs / 2) > parentDepth) {
          children.push({ index: j, line: lines[j], depth: Math.floor(cs / 2) });
          j++;
        } else {
          break;
        }
      }

      // Check for single direct child that is a link (possibly with -> url already)
      const directChildren = children.filter(c => c.depth === parentDepth + 1);
      if (directChildren.length === 1) {
        const childContent = directChildren[0].line.trim();
        const linkArrowMatch = childContent.match(/^- link "([^"]+)" -> (\S+)$/);
        if (linkArrowMatch) {
          // heading + link -> url: merge into one line
          headingInlined.push(`${' '.repeat(spaces)}- heading [h${headingMatch[2]}] "${headingMatch[1]}" -> ${linkArrowMatch[2]}`);
          i = j;
          continue;
        }
        const linkPlainMatch = childContent.match(/^- link "([^"]+)"$/);
        if (linkPlainMatch) {
          // heading + plain link (no url): inline
          headingInlined.push(`${' '.repeat(spaces)}- heading [h${headingMatch[2]}] "${headingMatch[1]}"`);
          i = j;
          continue;
        }
      }
    }

    headingInlined.push(line);
    i++;
  }
  lines = headingInlined;

  // --- Pass 3: Decorative image removal ---
  // Remove img nodes with empty name or single-char alt text
  const imagesFiltered = [];
  i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);

    const imgMatch = content.match(/^- img(?:\s+"([^"]*)")?/);
    if (imgMatch) {
      const altText = imgMatch[1] || '';
      if (altText.length <= 1) {
        // Decorative image - skip it and its children
        const parentDepth = Math.floor(spaces / 2);
        let j = i + 1;
        while (j < lines.length) {
          let cs = 0;
          while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
          if (Math.floor(cs / 2) > parentDepth) {
            j++;
          } else {
            break;
          }
        }
        i = j;
        continue;
      }
    }

    imagesFiltered.push(line);
    i++;
  }
  lines = imagesFiltered;

  // --- Pass 4: Duplicate URL dedup ---
  // Track seen URLs per depth scope; second occurrence removed
  // Reset when depth decreases
  const deduped = [];
  const seenUrls = new Map(); // depth -> Set of URLs
  let prevDepth = -1;

  for (i = 0; i < lines.length; i++) {
    const line = lines[i];
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);

    // When depth decreases, clear URL tracking for deeper levels
    if (depth < prevDepth) {
      for (const [d] of seenUrls) {
        if (d > depth) seenUrls.delete(d);
      }
    }
    prevDepth = depth;

    // Extract URL from lines with "-> url" pattern
    const urlArrowMatch = line.match(/ -> (\/\S+|https?:\/\/\S+)/);
    if (urlArrowMatch) {
      const url = urlArrowMatch[1];
      if (!seenUrls.has(depth)) seenUrls.set(depth, new Set());
      const depthSet = seenUrls.get(depth);
      if (depthSet.has(url)) {
        // Duplicate - skip this line and its children
        let j = i + 1;
        while (j < lines.length) {
          let cs = 0;
          while (cs < lines[j].length && lines[j][cs] === ' ') cs++;
          if (Math.floor(cs / 2) > depth) {
            j++;
          } else {
            break;
          }
        }
        i = j - 1; // -1 because for loop increments
        continue;
      }
      depthSet.add(url);
    }

    deduped.push(line);
  }

  return deduped.join('\n');
}

/**
 * Truncate snapshot output to a maximum number of lines.
 * Appends a marker indicating how many lines were omitted.
 *
 * @param {string} snapshot - ARIA snapshot text
 * @param {number} maxLines - Maximum number of lines to keep
 * @returns {string} Truncated snapshot
 */
function trimByLines(snapshot, maxLines) {
  if (maxLines == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');
  if (lines.length <= maxLines) return snapshot;
  const kept = lines.slice(0, maxLines);
  kept.push(`... (${lines.length - maxLines} more lines)`);
  return kept.join('\n');
}

/**
 * Collapse consecutive siblings of the same ARIA type at the same depth.
 * Keeps the first 2 siblings with their full subtrees; collapses the rest
 * into a single "... (K more <type>)" marker.
 *
 * @param {string} snapshot - ARIA snapshot text
 * @returns {string} Collapsed snapshot
 */
function collapseRepeated(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const lines = snapshot.split('\n');

  // Parse each line into { depth, type, raw }
  const typeRe = /^- (\S+)/;
  const parsed = lines.map(line => {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const depth = Math.floor(spaces / 2);
    const content = line.slice(spaces);
    // Extract type: first word after "- "
    const typeMatch = content.match(typeRe);
    const type = typeMatch ? typeMatch[1] : null;
    return { depth, type, raw: line };
  });

  // Process a range of parsed entries, collapsing sibling groups recursively
  function processRange(start, end) {
    const out = [];
    let i = start;
    while (i < end) {
      const current = parsed[i];
      if (!current.type) {
        out.push(current.raw);
        i++;
        continue;
      }

      // Collect all consecutive siblings of the same type at this depth
      const siblings = [];
      let j = i;
      while (j < end) {
        const entry = parsed[j];
        if (j === i || (entry.depth === current.depth && entry.type === current.type)) {
          const siblingStart = j;
          j++;
          while (j < end && parsed[j].depth > current.depth) {
            j++;
          }
          siblings.push({ start: siblingStart, end: j });
        } else {
          break;
        }
      }

      if (siblings.length > 2) {
        // Keep first 2 siblings, recursively process their children
        for (let s = 0; s < 2; s++) {
          out.push(parsed[siblings[s].start].raw);
          // Recursively process children of this sibling
          const childLines = processRange(siblings[s].start + 1, siblings[s].end);
          for (const cl of childLines) out.push(cl);
        }
        const collapsed = siblings.length - 2;
        const safeDepth = Math.min(current.depth, 500);
        const indent = ' '.repeat(safeDepth * 2);
        out.push(`${indent}- ... (${collapsed} more ${current.type})`);
      } else {
        // 2 or fewer siblings - output parent, recursively process children
        for (let s = 0; s < siblings.length; s++) {
          out.push(parsed[siblings[s].start].raw);
          const childLines = processRange(siblings[s].start + 1, siblings[s].end);
          for (const cl of childLines) out.push(cl);
        }
      }
      i = j;
    }
    return out;
  }

  return processRange(0, parsed.length).join('\n');
}

/**
 * Strip structural/container nodes from a snapshot, keeping only content-bearing nodes.
 * Structural nodes without a quoted label are removed; nodes with labels are kept.
 * Indentation is compressed to close gaps left by removed nodes.
 *
 * @param {string} snapshot - ARIA snapshot text
 * @returns {string} Content-only snapshot
 */
function textOnly(snapshot) {
  if (snapshot == null) return snapshot;
  if (typeof snapshot === 'string' && snapshot.startsWith('(')) return snapshot;

  const STRUCTURAL_TYPES = new Set([
    'list', 'listitem', 'group', 'region', 'main', 'complementary',
    'contentinfo', 'banner', 'form', 'table', 'row', 'grid',
    'generic', 'none', 'presentation', 'separator', 'directory'
  ]);

  const lines = snapshot.split('\n');
  const kept = [];
  const typeRe = /^- (\S+)/;

  for (const line of lines) {
    let spaces = 0;
    while (spaces < line.length && line[spaces] === ' ') spaces++;
    const content = line.slice(spaces);
    const typeMatch = content.match(typeRe);
    const type = typeMatch ? typeMatch[1] : null;
    const hasLabel = content.includes('"');

    if (!type || !STRUCTURAL_TYPES.has(type) || hasLabel) {
      kept.push({ depth: Math.floor(spaces / 2), raw: line, content });
    }
  }

  // Re-indent: compress gaps by tracking a depth stack
  // For each kept line, find its effective depth relative to its nearest kept ancestor
  if (kept.length === 0) return '';

  const result = [];
  // depthMap[originalDepth] = outputDepth
  const depthStack = []; // stack of { originalDepth, outputDepth }

  for (const entry of kept) {
    // Pop stack entries that are not ancestors (>= current depth)
    while (depthStack.length > 0 && depthStack[depthStack.length - 1].originalDepth >= entry.depth) {
      depthStack.pop();
    }

    let outputDepth;
    if (depthStack.length === 0) {
      outputDepth = 0;
    } else {
      outputDepth = depthStack[depthStack.length - 1].outputDepth + 1;
    }

    depthStack.push({ originalDepth: entry.depth, outputDepth });
    const safeDepth = Math.min(outputDepth, 500);
    const indent = ' '.repeat(safeDepth * 2);
    result.push(`${indent}${entry.content}`);
  }

  return result.join('\n');
}

// ============ Session Commands ============

async function sessionStart(name) {
  try {
    validateSessionName(name);
    const metadata = sessionStore.createSession(name);
    output({ ok: true, command: 'session start', session: name, result: metadata });
  } catch (err) {
    output({ ok: false, command: 'session start', session: name, error: 'session_exists', message: err.message });
  }
}

async function sessionAuth(name, opts) {
  if (opts.providersFile) loadCustomProviders(opts.providersFile);
  let resolved;
  try {
    resolved = resolveAuthOptions(opts.provider, opts);
  } catch (err) {
    output({ ok: false, command: 'session auth', session: name, error: 'unknown_provider', message: err.message });
    return;
  }

  if (!resolved.url) {
    output({ ok: false, command: 'session auth', session: name, error: 'missing_url', message: '--url is required (or use --provider to set it automatically)' });
    return;
  }

  try { await assertUrlAllowed(resolved.url); } catch (err) {
    output({ ok: false, command: 'session auth', session: name, error: 'invalid_url', message: err.message });
    return;
  }

  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session auth', session: name, error: 'session_not_found', message: `Session "${name}" not found. Run: session start ${name}` });
    return;
  }

  const result = await runAuthFlow(name, resolved.url, {
    successUrl: resolved.successUrl,
    successSelector: resolved.successSelector,
    successCookie: resolved.successCookie,
    captchaSelectors: resolved.captchaSelectors,
    captchaTextPatterns: resolved.captchaTextPatterns,
    twoFactorHint: resolved.twoFactorHint,
    timeout: resolved.timeout ? parseInt(resolved.timeout, 10) : undefined,
    vnc: !!resolved.vnc,
    port: resolved.port ? parseInt(resolved.port, 10) : undefined,
    verifyUrl: resolved.verifyUrl,
    verifySelector: resolved.verifySelector,
    minWait: resolved.minWait != null ? Math.max(0, Math.min(300, parseInt(resolved.minWait, 10) || 0)) : undefined
  });

  output({ command: 'session auth', ...result });
}

async function sessionSave(name) {
  let context;
  try {
    sessionStore.lockSession(name);
    const browser = await launchBrowser(name, { headless: true });
    context = browser.context;
    await closeBrowser(name, context);
    sessionStore.unlockSession(name);
    output({ ok: true, command: 'session save', session: name });
  } catch (err) {
    if (context) try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }
    output({ ok: false, command: 'session save', session: name, error: 'save_error', message: err.message });
  }
}

async function sessionList() {
  const sessions = sessionStore.listSessions();
  output({ ok: true, command: 'session list', sessions });
}

async function sessionStatus(name) {
  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session status', session: name, error: 'session_not_found', message: `Session "${name}" not found` });
    return;
  }
  output({ ok: true, command: 'session status', session: name, result: session });
}

async function sessionEnd(name) {
  try {
    sessionStore.deleteSession(name);
    output({ ok: true, command: 'session end', session: name });
  } catch (err) {
    output({ ok: false, command: 'session end', session: name, error: 'end_error', message: err.message });
  }
}

async function sessionRevoke(name) {
  try {
    sessionStore.deleteSession(name);
    output({ ok: true, command: 'session revoke', session: name, message: 'All session data deleted' });
  } catch (err) {
    output({ ok: false, command: 'session revoke', session: name, error: 'revoke_error', message: err.message });
  }
}

async function sessionVerify(name, opts) {
  try { validateSessionName(name); } catch (err) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_name', message: err.message });
    return;
  }

  const session = sessionStore.getSession(name);
  if (!session) {
    output({ ok: false, command: 'session verify', session: name, error: 'session_not_found', message: `Session "${name}" not found. Run: session start ${name}` });
    return;
  }

  if (session.status === 'expired') {
    output({ ok: false, command: 'session verify', session: name, error: 'session_expired', message: 'Session has expired. Start a new one.' });
    return;
  }

  if (opts.providersFile) loadCustomProviders(opts.providersFile);

  let authOpts = {};
  if (opts.provider) {
    try {
      authOpts = resolveAuthOptions(opts.provider, opts);
    } catch (err) {
      output({ ok: false, command: 'session verify', session: name, error: 'unknown_provider', message: err.message });
      return;
    }
  }

  const url = opts.url || authOpts.successUrl;
  if (!url) {
    output({ ok: false, command: 'session verify', session: name, error: 'missing_url', message: '--url is required (or use --provider with a successUrl)' });
    return;
  }

  try { await assertUrlAllowed(url); } catch (err) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_url', message: err.message });
    return;
  }

  const expectedStatus = opts.expectStatus ? parseInt(opts.expectStatus, 10) : null;
  if (expectedStatus !== null && (isNaN(expectedStatus) || expectedStatus < 100 || expectedStatus > 599)) {
    output({ ok: false, command: 'session verify', session: name, error: 'invalid_expect_status', message: '--expect-status must be a numeric HTTP status code (100-599)' });
    return;
  }

  let context;
  try {
    sessionStore.lockSession(name);
    const browser = await launchBrowser(name, { headless: true });
    context = browser.context;
    const page = browser.page;

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = response ? response.status() : null;

    if (expectedStatus !== null && status !== expectedStatus) {
      try { await closeBrowser(name, context); } catch { /* ignore */ }
      try { sessionStore.unlockSession(name); } catch { /* ignore */ }
      output({ ok: false, command: 'session verify', session: name, authenticated: false, reason: `Expected status ${expectedStatus}, got ${status}`, url, status });
      return;
    }

    const authResult = await checkAuthSuccess(page, context, url, {
      successUrl: authOpts.successUrl,
      successSelector: opts.expectSelector || authOpts.successSelector,
      successCookie: authOpts.successCookie,
      successLocalStorage: authOpts.successLocalStorage
    });

    try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }

    output({
      ok: authResult.success,
      command: 'session verify',
      session: name,
      authenticated: authResult.success,
      reason: authResult.success ? 'Auth check passed' : 'Auth check failed',
      url,
      currentUrl: authResult.currentUrl,
      status
    });
  } catch (err) {
    if (context) try { await closeBrowser(name, context); } catch { /* ignore */ }
    try { sessionStore.unlockSession(name); } catch { /* ignore */ }
    output({ ok: false, command: 'session verify', session: name, error: 'verify_error', message: err.message });
  }
}

// ============ Error Classification ============

/**
 * Classify a Playwright/action error into an actionable error response.
 * Returns { error, message, suggestion } with context-aware recovery hints.
 */
function classifyError(err, { action, selector, snapshot } = {}) {
  const msg = err.message || '';

  // Browser/context closed
  if (msg.includes('browser has been closed') || msg.includes('Target closed') ||
      msg.includes('Target page, context or browser has been closed')) {
    return {
      error: 'browser_closed',
      message: 'Browser closed unexpectedly. The session may have timed out or crashed.',
      suggestion: 'Run: session start <name> to create a fresh session'
    };
  }

  // No display for headed mode
  if (msg.includes('no usable sandbox') || msg.includes('Cannot open display') ||
      msg.includes('Missing X server')) {
    return {
      error: 'no_display',
      message: 'No display available for headed browser.',
      suggestion: 'Use --vnc flag or install: sudo apt-get install xvfb x11vnc'
    };
  }

  // Missing dependency (must be before 'not found' check for element_not_found)
  if (msg.includes('Cannot find module')) {
    const moduleName = msg.match(/Cannot find module '([^']+)'/)?.[1] || 'unknown';
    const pluginDir = path.resolve(__dirname, '..');
    return {
      error: 'missing_dependency',
      message: `Required dependency not found: ${moduleName}`,
      suggestion: `Run: cd ${pluginDir} && npm install && npx playwright install chromium`
    };
  }

  // Element not found / strict mode violation
  if (msg.includes('not found') || msg.includes('waiting for locator') ||
      msg.includes('strict mode violation') || msg.includes('resolved to') ||
      msg.includes('Timeout') && selector) {
    const hint = snapshot
      ? `Current page snapshot available in response for element discovery.`
      : 'Run: snapshot to see current page elements, then adjust selector.';
    return {
      error: 'element_not_found',
      message: `Selector '${selector || 'unknown'}' not found on current page.`,
      suggestion: hint
    };
  }

  // Timeout (general)
  if (msg.includes('Timeout') || msg.includes('timeout')) {
    return {
      error: 'timeout',
      message: `Action '${action}' timed out.`,
      suggestion: 'Increase --timeout value or verify the page is loading correctly'
    };
  }

  // Network errors
  if (msg.includes('net::ERR_') || msg.includes('NS_ERROR_')) {
    return {
      error: 'network_error',
      message: `Network error during '${action}': ${msg.split('\n')[0]}`,
      suggestion: 'Check URL is accessible. If auth is needed, verify session cookies with: session status <name>'
    };
  }

  // Session expired (caught before runAction, but just in case)
  if (msg.includes('expired')) {
    return {
      error: 'session_expired',
      message: 'Session has expired.',
      suggestion: 'Run: session start <name> to create a new session, then re-authenticate'
    };
  }

  // Default
  return {
    error: 'action_error',
    message: msg.split('\n')[0],
    suggestion: null
  };
}

// ============ Run Commands ============

async function runAction(sessionName, action, actionArgs, opts) {
  let session = sessionStore.getSession(sessionName);
  let autoCreated = false;
  if (!session) {
    try {
      session = sessionStore.createSession(sessionName);
      autoCreated = true;
    } catch (err) {
      if (err.message && err.message.includes('already exists')) {
        session = sessionStore.getSession(sessionName);
      }
      if (!session) {
        const isRace = err.message && err.message.includes('already exists');
        output({ ok: false, command: `run ${action}`, session: sessionName, error: isRace ? 'session_not_found' : 'session_create_failed', message: isRace ? `Session "${sessionName}" not found` : err.message });
        return;
      }
    }
  }

  if (session.status === 'expired') {
    output({ ok: false, command: `run ${action}`, session: sessionName, error: 'session_expired', message: 'Session has expired. Start a new one.' });
    return;
  }

  // Validate and normalize snapshot options
  if (opts.snapshotDepth != null) {
    const depth = parseInt(opts.snapshotDepth, 10);
    if (isNaN(depth) || depth <= 0 || depth > 100) {
      output({ ok: false, command: `run ${action}`, session: sessionName, error: 'invalid_option', message: '--snapshot-depth must be a positive integer (max 100)' });
      return;
    }
    opts.snapshotDepth = depth;
  }
  if (opts.snapshotMaxLines != null) {
    const maxLines = parseInt(opts.snapshotMaxLines, 10);
    if (isNaN(maxLines) || maxLines <= 0 || maxLines > 10000) {
      output({ ok: false, command: `run ${action}`, session: sessionName, error: 'invalid_option', message: '--snapshot-max-lines must be a positive integer (max 10000)' });
      return;
    }
    opts.snapshotMaxLines = maxLines;
  }
  if (opts.snapshotSelector != null && (typeof opts.snapshotSelector !== 'string' || opts.snapshotSelector.length === 0 || opts.snapshotSelector === 'true')) {
    output({ ok: false, command: `run ${action}`, session: sessionName, error: 'invalid_option', message: '--snapshot-selector requires a non-empty selector value' });
    return;
  }
  // Explicit snapshot action should always produce a snapshot
  if (action === 'snapshot') {
    delete opts.noSnapshot;
  }

  let context;
  let page;

  try {
    sessionStore.lockSession(sessionName);

    const headless = action !== 'checkpoint';
    const browser = await launchBrowser(sessionName, { headless });
    context = browser.context;
    page = browser.page;
    await installSsrfGuard(page);

    if (action !== 'goto' && session.lastUrl && session.lastUrl !== 'about:blank') {
      try {
        await assertUrlAllowed(session.lastUrl);
        await page.goto(session.lastUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch { /* ignore - best effort restoration */ }
    }

    await randomDelay();

    let result;

    switch (action) {
      case 'goto': {
        const url = actionArgs[0];
        if (!url) throw new Error('URL required: run <session> goto <url>');
        await assertUrlAllowed(url);
        const parsedTimeout = opts.timeout ? parseInt(opts.timeout, 10) : NaN;
        const loadedTimeout = parsedTimeout > 0 ? parsedTimeout : 15000;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (opts.ensureAuth || !opts.noAuthWallDetect) {
          const detection = await detectAuthWall(page, context, url);
          if (detection.detected) {
            console.warn('[WARN] Auth wall detected for ' + new URL(url).hostname);
            await closeBrowser(sessionName, context);
            // Settle: allow Chromium to fully release OS resources before headed probe
            await new Promise(resolve => setTimeout(resolve, 500));
            const headed = await canLaunchHeaded();
            if (headed) {
              const headedBrowser = await launchBrowser(sessionName, { headless: false });
              context = headedBrowser.context;
              page = headedBrowser.page;
              await installSsrfGuard(page);
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
              const ckTimeout = Math.min(opts.timeout ? parseInt(opts.timeout, 10) : 120, 3600) * 1000;
              if (opts.ensureAuth) {
                console.warn('[WARN] Waiting for auth completion (' + (ckTimeout / 1000) + 's timeout)');
                const pollInterval = 2000;
                const startTime = Date.now();
                let authCompleted = false;
                while (Date.now() - startTime < ckTimeout) {
                  await new Promise(resolve => setTimeout(resolve, pollInterval));
                  if (page.isClosed()) break;
                  try {
                    const authResult = await checkAuthSuccess(page, context, url, { loginUrl: url });
                    if (authResult.success) {
                      authCompleted = true;
                      break;
                    }
                  } catch { /* page may have navigated - retry next poll */ }
                }
                if (authCompleted) {
                  await closeBrowser(sessionName, context);
                  try {
                    const headlessBrowser = await launchBrowser(sessionName, { headless: true });
                    context = headlessBrowser.context;
                    page = headlessBrowser.page;
                    await installSsrfGuard(page);
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    if (opts.waitLoaded) {
                      await waitForLoaded(page, { timeout: loadedTimeout });
                    }
                    const snapshot = await getSnapshot(page, opts);
                    result = { url: page.url(), authWallDetected: true, ensureAuthCompleted: true,
                               ...(opts.waitLoaded && { waitLoaded: true }),
                               ...(snapshot != null && { snapshot }) };
                  } catch (relaunchErr) {
                    result = { url, authWallDetected: true, ensureAuthCompleted: true,
                               message: 'Auth completed but headless reload failed: ' + relaunchErr.message };
                    context = null;
                    page = null;
                  }
                  break;
                } else {
                  try { await closeBrowser(sessionName, context); } catch { /* already closed */ }
                  result = { url, authWallDetected: true, ensureAuthCompleted: false,
                             message: 'Auth did not complete within timeout' };
                  context = null;
                  page = null;
                  break;
                }
              } else {
                console.warn('[WARN] Checkpoint open for ' + (ckTimeout / 1000) + 's');
                await new Promise(resolve => setTimeout(resolve, ckTimeout));
                if (opts.waitLoaded) {
                  await waitForLoaded(page, { timeout: loadedTimeout });
                }
                const snapshot = await getSnapshot(page, opts);
                result = { url: page.url(), authWallDetected: true, checkpointCompleted: true,
                           ...(opts.waitLoaded && { waitLoaded: true }),
                           ...(snapshot != null && { snapshot }) };
                break;
              }
            } else {
              if (opts.ensureAuth) {
                result = { url: page.url(), authWallDetected: true, ensureAuthCompleted: false,
                           message: 'Auth wall detected but no display available for headed browser.' };
                break;
              }
              if (opts.waitLoaded) {
                await waitForLoaded(page, { timeout: loadedTimeout });
              }
              const snapshot = await getSnapshot(page, opts);
              result = { url: page.url(), authWallDetected: true, checkpointCompleted: false,
                         message: 'Auth wall detected but no display for headed checkpoint.',
                         ...(opts.waitLoaded && { waitLoaded: true }),
                         ...(snapshot != null && { snapshot }) };
              break;
            }
          }
        }
        if (opts.waitLoaded) {
          await waitForLoaded(page, { timeout: loadedTimeout });
        }
        // Content blocking detection (e.g. X.com empty feeds in headless)
        let contentBlockResult = null;
        if (!opts.noContentBlockDetect) {
          const provider = matchProviderByDomain(url);
          contentBlockResult = await detectContentBlocked(page, {
            contentSelectors: provider?.contentSelectors,
            contentBlockedIndicators: provider?.contentBlockedIndicators
          });
        }
        // Auto headed fallback when content is blocked
        if (contentBlockResult?.detected && !opts.noAutoRecover) {
          const headed = await cachedCanLaunchHeaded();
          if (headed) {
            console.warn('[WARN] Content blocked in headless - falling back to headed browser');
            // Save headless snapshot before closing (fallback may fail)
            const headlessSnapshot = await getSnapshot(page, opts);
            const headlessUrl = page.url();
            const headlessStatus = response ? response.status() : null;
            await closeBrowser(sessionName, context);
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
              const headedBrowser = await launchBrowser(sessionName, { headless: false });
              context = headedBrowser.context;
              page = headedBrowser.page;
              await installSsrfGuard(page);
              const headedResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
              if (opts.waitLoaded) {
                await waitForLoaded(page, { timeout: loadedTimeout });
              }
              // Re-detect content blocking in headed mode
              const headedProvider = matchProviderByDomain(url);
              const headedBlockResult = await detectContentBlocked(page, {
                contentSelectors: headedProvider?.contentSelectors,
                contentBlockedIndicators: headedProvider?.contentBlockedIndicators
              });
              const headedSnapshot = await getSnapshot(page, opts);
              result = {
                url: page.url(),
                status: headedResponse ? headedResponse.status() : null,
                contentBlocked: true,
                headedFallback: true,
                ...(headedBlockResult?.detected && { headedAlsoBlocked: true }),
                warning: headedBlockResult?.detected ? 'content_blocked_headed_also' : 'content_blocked_headed_fallback',
                suggestion: headedBlockResult?.detected
                  ? 'Content blocked in both headless and headed modes.'
                  : 'Content was blocked in headless mode. Retrieved via headed browser.',
                ...(opts.waitLoaded && { waitLoaded: true }),
                ...(headedSnapshot != null && { snapshot: headedSnapshot })
              };
              break;
            } catch (fallbackErr) {
              console.warn('[WARN] Headed fallback failed: ' + fallbackErr.message);
              // Return headless result captured before close
              context = null;
              page = null;
              result = {
                url: headlessUrl,
                status: headlessStatus,
                contentBlocked: true,
                headedFallback: false,
                warning: 'content_blocked',
                contentBlockedReason: contentBlockResult.reason,
                suggestion: 'Headed fallback failed: ' + fallbackErr.message,
                ...(opts.waitLoaded && { waitLoaded: true }),
                ...(headlessSnapshot != null && { snapshot: headlessSnapshot })
              };
              break;
            }
          }
        }
        const snapshot = await getSnapshot(page, opts);
        result = {
          url: page.url(),
          status: response ? response.status() : null,
          ...(opts.waitLoaded && { waitLoaded: true }),
          ...(contentBlockResult?.detected && {
            contentBlocked: true,
            headedFallback: false,
            warning: 'content_blocked',
            contentBlockedReason: contentBlockResult.reason,
            suggestion: opts.noAutoRecover
              ? "Site may be blocking headless browsers. Try: (1) authenticate with 'session auth <name> --provider <provider>', (2) use --ensure-auth for headed mode"
              : 'Content blocked and no display for headed fallback. Try: ssh -X or set DISPLAY.'
          }),
          ...(snapshot != null && { snapshot })
        };
        break;
      }

      case 'snapshot': {
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'click': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> click <selector>');
        const locator = resolveSelector(page, selector);
        await locator.click({ timeout: 10000 });
        if (opts.waitStable) {
          const stableTimeout = opts.timeout ? parseInt(opts.timeout, 10) : 5000;
          await waitForStable(page, { timeout: stableTimeout });
        } else {
          await randomDelay();
        }
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), clicked: selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'click-wait': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> click-wait <selector>');
        const locator = resolveSelector(page, selector);
        await locator.click({ timeout: 10000 });
        const stableTimeout = opts.timeout ? parseInt(opts.timeout, 10) : 5000;
        await waitForStable(page, { timeout: stableTimeout });
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), clicked: selector, settled: true, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'type': {
        const selector = actionArgs[0];
        const text = actionArgs.slice(1).join(' ');
        if (!selector || !text) throw new Error('Selector and text required: run <session> type <selector> <text>');
        const locator = resolveSelector(page, selector);
        await locator.type(text, { delay: 50 + Math.random() * 100 });
        await randomDelay();
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), typed: '[INPUT]', selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'read': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> read <selector>');
        const locator = resolveSelector(page, selector);
        const text = await locator.textContent({ timeout: 10000 });
        result = { url: page.url(), selector, content: sanitizeWebContent(text || '') };
        break;
      }

      case 'fill': {
        const selector = actionArgs[0];
        const value = actionArgs.slice(1).join(' ');
        if (!selector || !value) throw new Error('Selector and value required: run <session> fill <selector> <value>');
        const locator = resolveSelector(page, selector);
        await locator.fill(value);
        await randomDelay();
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), filled: selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'wait': {
        const selector = actionArgs[0];
        if (!selector) throw new Error('Selector required: run <session> wait <selector>');
        const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 30000;
        const locator = resolveSelector(page, selector);
        await locator.waitFor({ state: 'visible', timeout });
        const snapshot = await getSnapshot(page, opts);
        result = { url: page.url(), found: selector, ...(snapshot != null && { snapshot }) };
        break;
      }

      case 'evaluate': {
        // WARNING: Only execute agent-authored code. NEVER pass web page content as code.
        const code = actionArgs.join(' ');
        if (!code) throw new Error('JS code required: run <session> evaluate <code>');
        await confirmEvaluate(code);
        const evalResult = await page.evaluate(code);
        const stringResult = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult);
        result = { url: page.url(), result: sanitizeWebContent(stringResult || '') };
        break;
      }

      case 'screenshot': {
        const sessionDir = sessionStore.getSessionDir(sessionName);
        const defaultPath = path.join(sessionDir, `screenshot-${Date.now()}.png`);
        let screenshotPath = opts.path || defaultPath;
        // Prevent path traversal — resolve and verify within session dir
        if (opts.path) {
          const resolved = path.resolve(opts.path);
          const resolvedSession = path.resolve(sessionDir);
          if (!resolved.startsWith(resolvedSession + path.sep) && resolved !== resolvedSession) {
            throw new Error('Screenshot path must be within the session directory. Use --path relative to session dir.');
          }
          screenshotPath = resolved;
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result = { url: page.url(), path: screenshotPath };
        break;
      }

      case 'network': {
        const filter = opts.filter;
        const requests = [];

        page.on('request', req => {
          if (!filter || req.url().includes(filter)) {
            requests.push({ method: req.method(), url: req.url() });
          }
        });

        // Wait a brief moment to collect ongoing requests
        await new Promise(resolve => setTimeout(resolve, 2000));

        result = { url: page.url(), requests: requests.slice(0, 50) };
        break;
      }

      case 'checkpoint': {
        // Open headed browser for user to interact (solve CAPTCHAs etc.)
        const timeout = (opts.timeout ? parseInt(opts.timeout, 10) : 120) * 1000;
        // Note: browser is already headed (action !== 'checkpoint' check above sets headless=false)
        await new Promise(resolve => setTimeout(resolve, timeout));
        result = { url: page.url(), message: `Checkpoint complete after ${timeout / 1000}s` };
        break;
      }

      default: {
        const macro = macros[action];
        if (macro) {
          const helpers = { resolveSelector, waitForStable, waitForLoaded, randomDelay, getSnapshot: (page) => getSnapshot(page, opts), sanitizeWebContent };
          result = await macro(page, actionArgs, opts, helpers);
          // Clean up null snapshot from macros when --no-snapshot is active
          if (result && result.snapshot == null) delete result.snapshot;
        } else {
          const allActions = ['goto', 'snapshot', 'click', 'click-wait', 'type', 'read', 'fill', 'wait', 'evaluate', 'screenshot', 'network', 'checkpoint', ...Object.keys(macros)];
          throw new Error(`Unknown action: ${action}. Available: ${allActions.join(', ')}`);
        }
        break;
      }
    }

    try {
      const currentUrl = page.url();
      if (currentUrl && currentUrl !== 'about:blank') {
        sessionStore.updateSession(sessionName, { lastUrl: currentUrl });
      }
    } catch { /* ignore - page may have closed before URL read */ }

    if (context) await closeBrowser(sessionName, context);
    sessionStore.unlockSession(sessionName);
    output({ ok: true, command: `run ${action}`, session: sessionName, ...(autoCreated && { autoCreated: true }), result });

  } catch (err) {
    let snapshot = null;
    if (page) {
      try { snapshot = await getSnapshot(page, opts); } catch { /* getSnapshot handles internally; guard against unexpected state */ }
      try {
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== 'about:blank') {
          sessionStore.updateSession(sessionName, { lastUrl: currentUrl });
        }
      } catch { /* ignore */ }
    }
    if (context) {
      try { await closeBrowser(sessionName, context); } catch { /* ignore */ }
    }
    try { sessionStore.unlockSession(sessionName); } catch { /* ignore */ }

    const classified = classifyError(err, { action, selector: actionArgs[0], snapshot });
    output({
      ok: false,
      command: `run ${action}`,
      session: sessionName,
      ...(autoCreated && { autoCreated: true }),
      ...classified,
      ...(snapshot != null && { snapshot })
    });
  }
}

// ============ Help ============

function printHelp() {
  console.log(`web-ctl - Browser automation for AI agents

Usage:
  web-ctl session <command> <name> [options]
  web-ctl run <session> <action> [args] [options]

Session commands:
  start <name>                  Create a new session
  auth <name> --url <url>       Open headed browser for auth
    [--provider <name>]         Use pre-built provider (sets url, success checks)
    [--success-url <url>]       URL to detect auth completion
    [--success-selector <sel>]  DOM selector to detect auth completion
    [--success-cookie <json>]   Cookie presence to detect auth completion
    [--providers-file <path>]   Load custom providers from JSON file
    [--timeout <seconds>]       Timeout in seconds (default: 300)
    [--min-wait <seconds>]      Grace period before auth checks (default: 5)
  providers                     List available auth providers
  save <name>                   Save session state
  list                          List all sessions
  status <name>                 Show session status
  end <name>                    End and delete session
  revoke <name>                 Delete all session data
  verify <name> --url <url>     Verify session is still authenticated
    [--provider <name>]         Use provider defaults for success checks
    [--expect-status <code>]    Assert HTTP status code
    [--expect-selector <sel>]   Assert DOM element presence

Run actions:
  goto <url>                    Navigate to URL
    [--ensure-auth]             Poll for auth completion instead of timed checkpoint
    [--wait-loaded]             Wait for async content to finish rendering
    [--no-content-block-detect] Skip content blocking detection
    [--timeout <ms>]            Wait timeout (default: 15000)
  snapshot                      Get accessibility tree
  click <selector>              Click element
    [--wait-stable]             Wait for DOM + network to settle after click
    [--timeout <ms>]            Stability wait timeout (default: 5000)
  click-wait <selector>         Click and wait for page to settle
    [--timeout <ms>]            Stability wait timeout (default: 5000)
  type <selector> <text>        Type text into element
  read <selector>               Read element text content
  fill <selector> <value>       Fill form field
  wait <selector>               Wait for element to appear
    [--timeout <ms>]            Wait timeout (default: 30000)
  evaluate <js-code>            Execute JavaScript
  screenshot [--path <file>]    Take screenshot
  network [--filter <pattern>]  Capture network requests
  checkpoint [--timeout <sec>]  Open headed browser for interaction

Macros (higher-level actions):
  select-option <sel> <text>    Click trigger, pick option by text
  tab-switch <name>             Switch to tab by name
  modal-dismiss [--accept]      Auto-detect and dismiss modal/dialog
  form-fill --fields '<json>'   Fill form fields by label
    [--submit] [--submit-text]
  search-select <sel> <q>       Type query, pick from suggestions
    --pick <text>
  date-pick <sel> --date <d>    Pick date from calendar widget
  file-upload <sel> <path>      Upload file to input element
  hover-reveal <sel>            Hover trigger, click revealed target
    --click <target>
  scroll-to <sel>               Scroll element into view
  wait-toast [--dismiss]        Wait for toast/notification
  iframe-action <sel> <action>  Perform action inside iframe
  login --user <u> --pass <p>   Auto-detect and fill login form
  next-page                   Detect and follow next-page link
  paginate --selector <sel>   Collect items across paginated pages
    [--max-pages N]             Max pages to visit (default: 5, max: 20)
    [--max-items N]             Max items to collect (default: 100, max: 500)
  extract --selector <sel>     Extract structured data from repeated elements
    --fields <f1,f2,...>          Fields to extract (default: title,url,text)
    [--max-items N]               Max items to extract (default: 100, max: 500)
    [--max-field-length N]        Max chars per field (default: 500, max: 2000)
    [--auto]                      Auto-detect mode finds repeated patterns

Snapshot options (apply to any action that returns a snapshot):
  --snapshot-depth <N>          Limit ARIA tree depth (e.g. 3 for top 3 levels)
  --snapshot-selector <sel>     Scope snapshot to a DOM subtree
  --no-snapshot                 Omit snapshot from output entirely
  --snapshot-max-lines <N>      Truncate snapshot to N lines
  --snapshot-compact            Compact format: collapse links, inline headings,
                                  remove decorative images, dedup URLs
  --snapshot-collapse           Collapse repeated siblings (show first 2)
  --snapshot-text-only          Strip structural nodes, keep content only
  --snapshot-full               Use full page body (skip <main> auto-detection)

Selector syntax:
  role=button[name='Submit']    ARIA role selector
  css=div.my-class              CSS selector
  text=Click here               Text content selector
  #my-id                        ID shorthand

Examples:
  web-ctl session start github
  web-ctl session auth github --provider github
  web-ctl session auth github --url "https://github.com/login"
  web-ctl session providers
  web-ctl run github goto "https://github.com"
  web-ctl run github snapshot
  web-ctl run github click "role=link[name='Settings']"
  web-ctl run github click-wait "role=button[name='Save']"
  web-ctl run github click "role=tab[name='Code']" --wait-stable
  web-ctl run github snapshot --snapshot-depth 3
  web-ctl run github goto "https://github.com" --snapshot-selector "css=nav"
  web-ctl run github click "#btn" --no-snapshot
  web-ctl run github snapshot --snapshot-collapse
  web-ctl run github snapshot --snapshot-compact
  web-ctl run github snapshot --snapshot-text-only --snapshot-max-lines 50
  web-ctl session end github`);
}

// ============ Main Router ============

async function main() {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  const command = args[0];

  if (command === 'session') {
    const subcommand = args[1];
    const name = args[2];
    const opts = parseOptions(args.slice(3));

    switch (subcommand) {
      case 'start':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionStart(name);
        break;
      case 'auth':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionAuth(name, opts);
        break;
      case 'save':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionSave(name);
        break;
      case 'providers':
        if (opts && opts.providersFile) loadCustomProviders(opts.providersFile);
        output({ ok: true, command: 'session providers', providers: listProviders() });
        break;
      case 'list':
        await sessionList();
        break;
      case 'status':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionStatus(name);
        break;
      case 'end':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionEnd(name);
        break;
      case 'revoke':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionRevoke(name);
        break;
      case 'verify':
        if (!name) { output({ ok: false, error: 'missing_name', message: 'Session name required' }); return; }
        await sessionVerify(name, opts);
        break;
      default:
        output({ ok: false, error: 'unknown_command', message: `Unknown session command: ${subcommand}. Use: start, auth, providers, save, list, status, end, revoke, verify` });
    }
  } else if (command === 'run') {
    const sessionName = args[1];
    const action = args[2];
    const opts = parseOptions(args.slice(3));
    // Extract non-option args after action
    const cleanArgs = [];
    for (let i = 3; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        // Skip option and its value
        if (args[i + 1] && !args[i + 1].startsWith('--') && !BOOLEAN_FLAGS.has(args[i])) i++;
      } else {
        cleanArgs.push(args[i]);
      }
    }

    if (!sessionName || !action) {
      output({ ok: false, error: 'missing_args', message: 'Usage: run <session> <action> [args]' });
      return;
    }

    try { validateSessionName(sessionName); } catch (err) {
      output({ ok: false, error: 'invalid_name', message: err.message });
      return;
    }

    await runAction(sessionName, action, cleanArgs, opts);
  } else {
    output({ ok: false, error: 'unknown_command', message: `Unknown command: ${command}. Use: session, run, --help` });
  }
}

if (require.main === module) {
  main().catch(err => {
    output({ ok: false, error: 'fatal', message: err.message });
    process.exit(1);
  });
}

module.exports = {
  validateUrl,
  assertUrlAllowed,
  isPrivateIpv4,
  isPrivateIpv6,
  installSsrfGuard,
};
