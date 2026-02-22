'use strict';

const providers = require('./providers.json');

// Build lookup map: slug and aliases -> provider
const providerMap = new Map();
for (const p of providers) {
  providerMap.set(p.slug, p);
  if (p.aliases) {
    for (const alias of p.aliases) {
      providerMap.set(alias, p);
    }
  }
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
  return providers.map(p => ({ slug: p.slug, name: p.name, loginUrl: p.loginUrl }));
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
    twoFactorHint: cliOpts.twoFactorHint || provider.twoFactorHint || undefined
  };

  // Merge captcha selectors - provider-specific ones come first
  if (provider.captchaSelectors && provider.captchaSelectors.length > 0) {
    merged.captchaSelectors = provider.captchaSelectors;
  }
  if (provider.captchaTextPatterns && provider.captchaTextPatterns.length > 0) {
    merged.captchaTextPatterns = provider.captchaTextPatterns;
  }

  // CLI options override everything they explicitly set
  if (cliOpts.timeout) merged.timeout = cliOpts.timeout;
  if (cliOpts.vnc) merged.vnc = cliOpts.vnc;
  if (cliOpts.port) merged.port = cliOpts.port;

  // Clean undefined values
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  return merged;
}

module.exports = { getProvider, listProviders, resolveAuthOptions };
