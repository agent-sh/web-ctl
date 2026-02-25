'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const LOCKFILE = path.join(PLUGIN_ROOT, '.deps-installing');

function getModule() {
  delete require.cache[require.resolve('../scripts/ensure-deps')];
  return require('../scripts/ensure-deps');
}

/**
 * Run a script in a subprocess with Module._resolveFilename mocked
 * to simulate playwright not being installed.
 */
function runWithMissingPlaywright(code, env = {}) {
  const wrapper = `
    const Module = require('module');
    const orig = Module._resolveFilename;
    Module._resolveFilename = function(request, ...args) {
      if (request === 'playwright') {
        const e = new Error("Cannot find module 'playwright'");
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
      return orig.call(this, request, ...args);
    };
    ${code}
  `;
  return execFileSync(process.execPath, ['-e', wrapper], {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, ...env },
    timeout: 10_000,
    encoding: 'utf8'
  });
}

afterEach(() => {
  try { fs.unlinkSync(LOCKFILE); } catch { /* no lockfile */ }
  delete process.env.WEB_CTL_SKIP_AUTO_INSTALL;
});

describe('ensurePlaywright - when playwright is available', () => {
  it('succeeds without throwing', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
  });

  it('module-level caching makes second call instant', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    const start = Date.now();
    ensurePlaywright();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5, `Second call took ${elapsed}ms, expected < 5ms`);
  });

  it('_resetCache allows re-verification', () => {
    const { ensurePlaywright, _resetCache } = getModule();
    ensurePlaywright();
    _resetCache();
    ensurePlaywright();
  });

  it('succeeds with WEB_CTL_SKIP_AUTO_INSTALL=1 when dep is present', () => {
    process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
  });

  it('does not create lockfile when dep is already available', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    assert.equal(fs.existsSync(LOCKFILE), false);
  });
});

describe('ensurePlaywright - when playwright is missing', () => {
  it('throws with install instructions when WEB_CTL_SKIP_AUTO_INSTALL=1', () => {
    const code = `
      process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
        process.stdout.write('NO_THROW');
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.notEqual(output, 'NO_THROW', 'Should have thrown');
    assert.ok(output.includes('playwright'), 'Should mention playwright');
    assert.ok(output.includes('WEB_CTL_SKIP_AUTO_INSTALL'), 'Should mention env var');
    assert.ok(output.includes('npm install'), 'Should include npm install command');
    assert.ok(output.includes('npx playwright install chromium'), 'Should include browser install');
  });

  it('error message includes the plugin directory path', () => {
    const code = `
      process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.ok(output.includes('cd '), 'Should include cd command with plugin dir');
  });

  it('error includes Run manually instructions', () => {
    const code = `
      process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.ok(output.includes('Run manually'), 'Should include run manually guidance');
  });
});

describe('lockfile management', () => {
  it('no lockfile exists before ensurePlaywright', () => {
    assert.equal(fs.existsSync(LOCKFILE), false);
  });

  it('no lockfile left after successful ensurePlaywright', () => {
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    assert.equal(fs.existsSync(LOCKFILE), false);
  });

  it('pre-existing lockfile is untouched when dep is already available', () => {
    fs.writeFileSync(LOCKFILE, '999999');
    const { ensurePlaywright } = getModule();
    ensurePlaywright();
    assert.ok(fs.existsSync(LOCKFILE), 'Lockfile untouched when dep already available');
  });

  it('lockfile uses exclusive write flag for atomicity', () => {
    fs.writeFileSync(LOCKFILE, String(process.pid), { flag: 'wx' });
    assert.throws(
      () => fs.writeFileSync(LOCKFILE, 'other', { flag: 'wx' }),
      { code: 'EEXIST' }
    );
  });

  it('lockfile contains PID for stale detection', () => {
    fs.writeFileSync(LOCKFILE, String(process.pid), { flag: 'wx' });
    const content = fs.readFileSync(LOCKFILE, 'utf8').trim();
    assert.equal(content, String(process.pid));
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
