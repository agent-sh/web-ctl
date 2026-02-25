'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const LOCKFILE = path.join(PLUGIN_ROOT, '.deps-installing');

function getModule() {
  // Clear require cache so each test gets fresh module state
  delete require.cache[require.resolve('../scripts/ensure-deps')];
  return require('../scripts/ensure-deps');
}

afterEach(() => {
  // Clean up any leftover lockfiles
  try { fs.unlinkSync(LOCKFILE); } catch { /* no lockfile */ }
  // Restore env
  delete process.env.WEB_CTL_SKIP_AUTO_INSTALL;
});

describe('ensurePlaywright', () => {
  it('is a no-op when playwright is already available', () => {
    const { ensurePlaywright } = getModule();
    // Should not throw - playwright is installed in dev environment
    ensurePlaywright();
  });

  it('module-level caching makes second call instant', () => {
    const { ensurePlaywright } = getModule();
    // First call does the resolve check
    ensurePlaywright();
    // Second call should return immediately from cache
    const start = Date.now();
    ensurePlaywright();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5, `Second call took ${elapsed}ms, expected < 5ms`);
  });

  it('_resetCache allows re-verification', () => {
    const { ensurePlaywright, _resetCache } = getModule();
    ensurePlaywright();
    _resetCache();
    // After reset, next call should re-check (still succeeds since playwright is installed)
    ensurePlaywright();
  });

  it('succeeds even with WEB_CTL_SKIP_AUTO_INSTALL=1 when dep is present', () => {
    process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
    const { ensurePlaywright } = getModule();
    // With playwright installed, this should succeed regardless of env var
    // (the env var only blocks auto-install, not the resolve check)
    ensurePlaywright();
  });

  it('does not create lockfile when playwright is already available', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    assert.equal(fs.existsSync(LOCKFILE), false, 'No lockfile when dep is present');
  });
});

describe('ensure-deps source contracts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'ensure-deps.js'),
    'utf8'
  );

  it('checks WEB_CTL_SKIP_AUTO_INSTALL env var', () => {
    assert.ok(
      source.includes('WEB_CTL_SKIP_AUTO_INSTALL'),
      'Should check WEB_CTL_SKIP_AUTO_INSTALL env var'
    );
  });

  it('error message includes manual install instructions', () => {
    assert.ok(
      source.includes('npm install && npx playwright install chromium'),
      'Should include manual install instructions'
    );
  });

  it('uses require.resolve with plugin root paths', () => {
    assert.ok(
      source.includes("require.resolve('playwright'"),
      'Should use require.resolve to check for playwright'
    );
  });

  it('acquires lockfile before installation', () => {
    assert.ok(
      source.includes('.deps-installing'),
      'Should use .deps-installing lockfile'
    );
  });

  it('stores PID in lockfile for stale detection', () => {
    assert.ok(
      source.includes('process.pid'),
      'Should write process PID to lockfile'
    );
  });

  it('checks if lock holder process is alive', () => {
    assert.ok(
      source.includes('isProcessAlive'),
      'Should check if lock holder PID is alive'
    );
  });

  it('runs npm install --production during auto-install', () => {
    assert.ok(
      source.includes('npm install --production'),
      'Should run npm install --production'
    );
  });

  it('runs npx playwright install chromium during auto-install', () => {
    assert.ok(
      source.includes('npx playwright install chromium'),
      'Should install chromium browser'
    );
  });

  it('uses stdio pipe to avoid polluting JSON output', () => {
    assert.ok(
      source.includes("stdio: ['pipe', 'pipe', 'pipe']"),
      'Should pipe stdio to avoid polluting output'
    );
  });

  it('logs progress to stderr', () => {
    assert.ok(
      source.includes('process.stderr.write'),
      'Should log progress to stderr'
    );
  });
});

describe('lockfile management', () => {
  it('no lockfile exists before ensurePlaywright', () => {
    assert.equal(fs.existsSync(LOCKFILE), false, 'Lockfile should not exist initially');
  });

  it('no lockfile left after successful ensurePlaywright', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    assert.equal(fs.existsSync(LOCKFILE), false, 'Lockfile should be cleaned up');
  });

  it('stale lockfile is not disturbed when dep is already available', () => {
    // When playwright is already installed, ensurePlaywright returns before
    // the lockfile path is ever reached. Verify a pre-existing lockfile is
    // untouched (it would only matter during an install flow).
    fs.writeFileSync(LOCKFILE, '999999');
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    // Lockfile is still there because ensurePlaywright returned early
    // (playwright was already found). The afterEach hook cleans it up.
    assert.ok(fs.existsSync(LOCKFILE), 'Lockfile untouched when dep already available');
  });

  it('lockfile uses exclusive write flag', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'ensure-deps.js'),
      'utf8'
    );
    assert.ok(source.includes("flag: 'wx'"), 'Should use wx flag for atomic creation');
  });
});

describe('ensure-deps exports', () => {
  it('exports ensurePlaywright function', () => {
    const mod = getModule();
    assert.equal(typeof mod.ensurePlaywright, 'function');
  });

  it('exports _resetCache function', () => {
    const mod = getModule();
    assert.equal(typeof mod._resetCache, 'function');
  });
});
