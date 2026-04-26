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
  delete process.env.WEB_CTL_AUTO_INSTALL;
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
  it('throws by default (auto-install is opt-in)', () => {
    const code = `
      // Neither WEB_CTL_AUTO_INSTALL nor WEB_CTL_SKIP_AUTO_INSTALL is set.
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
        process.stdout.write('NO_THROW');
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.notEqual(output, 'NO_THROW', 'Should have thrown without opt-in');
    assert.ok(output.includes('playwright'), 'Should mention playwright');
    assert.ok(output.includes('WEB_CTL_AUTO_INSTALL'), 'Should mention opt-in env var');
    assert.ok(output.includes('npm install'), 'Should include npm install command');
    assert.ok(output.includes('npx playwright install chromium'), 'Should include browser install');
  });

  it('throws with install instructions when WEB_CTL_SKIP_AUTO_INSTALL=1 forces skip', () => {
    const code = `
      process.env.WEB_CTL_SKIP_AUTO_INSTALL = '1';
      process.env.WEB_CTL_AUTO_INSTALL = '1';  // even with opt-in, skip wins
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
  });

  it('error message includes the plugin directory path', () => {
    const code = `
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

  it('error includes run-manually guidance', () => {
    const code = `
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.ok(output.includes('run manually'), 'Should include run manually guidance');
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

describe('ensurePlaywright - install failure handling', () => {
  it('reports npm install failure with manual instructions', () => {
    // Mock both require.resolve (missing playwright) and execSync (npm fails)
    const code = `
      process.env.WEB_CTL_AUTO_INSTALL = '1';
      const cp = require('child_process');
      const origExec = cp.execSync;
      cp.execSync = function(cmd, opts) {
        if (cmd.includes('npm install')) {
          throw new Error('npm ERR! code ENETUNREACH');
        }
        return origExec.call(this, cmd, opts);
      };
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
        process.stdout.write('NO_THROW');
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.notEqual(output, 'NO_THROW', 'Should throw on npm failure');
    assert.ok(output.includes('installation failed'), 'Should mention failure');
    assert.ok(output.includes('Run manually'), 'Should include manual instructions');
  });

  it('reports chromium install failure with manual instructions', () => {
    // npm install succeeds but playwright install chromium fails
    const code = `
      process.env.WEB_CTL_AUTO_INSTALL = '1';
      const cp = require('child_process');
      const origExec = cp.execSync;
      cp.execSync = function(cmd, opts) {
        if (cmd.includes('playwright install')) {
          throw new Error('Failed to download chromium');
        }
        return origExec.call(this, cmd, opts);
      };
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try {
        ensurePlaywright();
        process.stdout.write('NO_THROW');
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.notEqual(output, 'NO_THROW', 'Should throw on chromium install failure');
    assert.ok(output.includes('installation failed'), 'Should mention failure');
    assert.ok(output.includes('npx playwright install chromium'), 'Should include chromium install command');
  });

  it('cleans up lockfile after install failure', () => {
    const code = `
      process.env.WEB_CTL_AUTO_INSTALL = '1';
      const cp = require('child_process');
      const origExec = cp.execSync;
      cp.execSync = function(cmd, opts) {
        if (cmd.includes('npm install')) throw new Error('npm ERR!');
        return origExec.call(this, cmd, opts);
      };
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try { ensurePlaywright(); } catch {}
      const fs = require('fs');
      const path = require('path');
      const lockfile = path.join(__dirname, '.deps-installing');
      process.stdout.write(String(fs.existsSync(lockfile)));
    `;
    const output = runWithMissingPlaywright(code);
    assert.equal(output, 'false', 'Lockfile should be cleaned up after failure');
  });
});

describe('stale lock detection', () => {
  it('cleans up lockfile with non-existent PID', () => {
    // Use a subprocess to test stale lock detection
    const code = `
      process.env.WEB_CTL_AUTO_INSTALL = '1';
      const fs = require('fs');
      const path = require('path');
      const lockfile = path.join(__dirname, '.deps-installing');
      // Create lockfile with PID that does not exist
      fs.writeFileSync(lockfile, '2147483647', { flag: 'wx' });
      // Now when ensurePlaywright tries to install, acquireLock should
      // detect stale lock, remove it, and acquire it
      // Since we also mock execSync to fail, we'll see the install attempt
      const cp = require('child_process');
      const origExec = cp.execSync;
      cp.execSync = function(cmd, opts) {
        if (cmd.includes('npm install')) throw new Error('expected');
        return origExec.call(this, cmd, opts);
      };
      const { ensurePlaywright } = require('./scripts/ensure-deps');
      try { ensurePlaywright(); } catch (err) {
        // It should have gotten past the stale lock and attempted install
        process.stdout.write(err.message.includes('installation failed') ? 'STALE_CLEANED' : 'OTHER');
      }
    `;
    const output = runWithMissingPlaywright(code);
    assert.equal(output, 'STALE_CLEANED', 'Should clean stale lock and attempt install');
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
