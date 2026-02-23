'use strict';

const fs = require('fs');
const builtinProviders = require('./providers.json');

const providerMap = new Map();
let allProviders = [...builtinProviders];

function rebuildMap(providerList) {
  providerMap.clear();
  for (const p of providerList) {
    providerMap.set(p.slug, p);
    if (p.aliases) {
      for (const alias of p.aliases) {
        providerMap.set(alias, p);
      }
    }
  }
}

rebuildMap(allProviders);

/**
 * Load custom providers from a JSON file and merge with built-ins.
 * Custom providers with the same slug override built-in ones.
 */
function loadCustomProviders(filePath) {
  if (!filePath) {
    allProviders = [...builtinProviders];
    rebuildMap(allProviders);
    return;
  }

  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return; }

  let custom;
  try { custom = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(custom)) return;

  const builtinMap = new Map(builtinProviders.map(p => [p.slug, p]));
  for (const cp of custom) {
    if (!cp.slug || !cp.loginUrl) continue;
    builtinMap.set(cp.slug, cp);
  }
  allProviders = [...builtinMap.values()];
  rebuildMap(allProviders);
}

/**
 * Get a provider by name (case-insensitive, supports aliases).
 * Returns null if not found.
 */
function getProvider(name) {
  if (!name) return null;
  return providerMap.get(name.toLowerCase()) || null;
}

/**
 * List all providers with slug, name, and loginUrl.
 */
function listProviders() {
  return allProviders.map(p => ({ slug: p.slug, name: p.name, loginUrl: p.loginUrl }));
}

/**
 * Merge provider defaults with CLI options. CLI options win.
 * Throws if providerName is given but not found.
 * Returns the merged options object.
 */
function resolveAuthOptions(providerName, cliOpts = {}) {
  if (!providerName) return { ...cliOpts };

  const provider = getProvider(providerName);
  if (!provider) {
    throw new Error(`Unknown provider "${providerName}". Run 'session providers' to list available providers.`);
  }

  const merged = {
    url: cliOpts.url || provider.loginUrl,
    successUrl: cliOpts.successUrl || provider.successUrl || undefined,
    successSelector: cliOpts.successSelector || provider.successSelector || undefined,
    successCookie: cliOpts.successCookie || provider.successCookie || undefined,
    successLocalStorage: cliOpts.successLocalStorage || provider.successLocalStorage || undefined,
    twoFactorHint: cliOpts.twoFactorHint || provider.twoFactorHint || undefined,
    twoFactorSelectors: provider.twoFactorSelectors || undefined,
    flowType: provider.flowType || undefined,
    notes: provider.notes || undefined,
    verifyUrl: cliOpts.verifyUrl || provider.verifyUrl || undefined,
    verifySelector: cliOpts.verifySelector || provider.verifySelector || undefined,
    minWait: cliOpts.minWait || provider.minWait || undefined
  };

  if (provider.captchaSelectors && provider.captchaSelectors.length > 0) {
    merged.captchaSelectors = provider.captchaSelectors;
  }
  if (provider.captchaTextPatterns && provider.captchaTextPatterns.length > 0) {
    merged.captchaTextPatterns = provider.captchaTextPatterns;
  }

  if (cliOpts.timeout) merged.timeout = cliOpts.timeout;
  if (cliOpts.vnc) merged.vnc = cliOpts.vnc;
  if (cliOpts.port) merged.port = cliOpts.port;

  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  return merged;
}

module.exports = { getProvider, listProviders, resolveAuthOptions, loadCustomProviders };
