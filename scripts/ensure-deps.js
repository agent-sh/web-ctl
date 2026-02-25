'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const LOCKFILE = path.join(PLUGIN_ROOT, '.deps-installing');
const LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 1000;

let _playwrightVerified = false;

/**
 * Check whether a process with the given PID is still running.
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire an exclusive lockfile for dependency installation.
 * Waits up to LOCK_TIMEOUT_MS if another process holds the lock.
 * Returns true if lock was acquired, false if another process finished first
 * (meaning deps should now be available).
 */
function acquireLock() {
  const start = Date.now();

  while (true) {
    try {
      fs.writeFileSync(LOCKFILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Lock exists - check if holder is still alive
      let holderPid;
      try {
        holderPid = parseInt(fs.readFileSync(LOCKFILE, 'utf8').trim(), 10);
      } catch {
        // Lock file disappeared between check and read - retry
        continue;
      }

      if (holderPid && !isProcessAlive(holderPid)) {
        // Stale lock - remove and retry
        try { fs.unlinkSync(LOCKFILE); } catch { /* race with another cleaner */ }
        continue;
      }

      // Another process is installing - wait
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for dependency installation by PID ${holderPid}. ` +
          `Remove ${LOCKFILE} if the process is no longer running.`
        );
      }

      // Busy-wait (sync context, cannot use setTimeout)
      const waitUntil = Date.now() + LOCK_POLL_MS;
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
}

/**
 * Release the installation lockfile.
 */
function releaseLock() {
  try { fs.unlinkSync(LOCKFILE); } catch { /* already removed */ }
}

/**
 * Ensure playwright is available. Installs it automatically if missing.
 *
 * This function is synchronous. It uses a module-level cache so repeated
 * calls within the same process are free after the first successful check.
 *
 * Set WEB_CTL_SKIP_AUTO_INSTALL=1 to disable auto-install (for CI/sandboxed
 * environments). When set, throws an error with manual install instructions
 * if playwright is missing.
 */
function ensurePlaywright() {
  if (_playwrightVerified) return;

  try {
    require.resolve('playwright', { paths: [PLUGIN_ROOT] });
    _playwrightVerified = true;
    return;
  } catch {
    // playwright not found - proceed to install
  }

  if (process.env.WEB_CTL_SKIP_AUTO_INSTALL === '1') {
    throw new Error(
      `Required dependency 'playwright' is not installed.\n` +
      `Auto-install is disabled (WEB_CTL_SKIP_AUTO_INSTALL=1).\n` +
      `Run manually:\n` +
      `  cd ${PLUGIN_ROOT} && npm install && npx playwright install chromium`
    );
  }

  const acquired = acquireLock();
  if (!acquired) {
    // Another process finished installing - verify
    try {
      require.resolve('playwright', { paths: [PLUGIN_ROOT] });
      _playwrightVerified = true;
      return;
    } catch {
      throw new Error(
        `Dependency installation by another process did not resolve playwright.\n` +
        `Run manually: cd ${PLUGIN_ROOT} && npm install && npx playwright install chromium`
      );
    }
  }

  try {
    process.stderr.write('[web-ctl] Installing dependencies...\n');

    execSync('npm install --production', {
      cwd: PLUGIN_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000
    });

    process.stderr.write('[web-ctl] Installing Chromium browser...\n');

    execSync('npx playwright install chromium', {
      cwd: PLUGIN_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000
    });

    process.stderr.write('[web-ctl] Dependencies installed.\n');
  } catch (err) {
    releaseLock();
    throw new Error(
      `Automatic dependency installation failed: ${err.message}\n` +
      `Run manually: cd ${PLUGIN_ROOT} && npm install && npx playwright install chromium`
    );
  }

  releaseLock();

  // Verify installation succeeded
  try {
    // Clear require cache so Node picks up newly installed module
    delete require.cache[require.resolve('playwright', { paths: [PLUGIN_ROOT] })];
  } catch { /* ignore if cache clear fails */ }

  try {
    require.resolve('playwright', { paths: [PLUGIN_ROOT] });
    _playwrightVerified = true;
  } catch {
    throw new Error(
      `Playwright installed but still not resolvable from ${PLUGIN_ROOT}.\n` +
      `Run manually: cd ${PLUGIN_ROOT} && npm install && npx playwright install chromium`
    );
  }
}

/**
 * Reset the module-level cache. Exposed for testing only.
 */
function _resetCache() {
  _playwrightVerified = false;
}

module.exports = { ensurePlaywright, _resetCache };
