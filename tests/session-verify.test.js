'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ctl-verify-'));
  process.env.AI_STATE_DIR = tmpDir;
  // Clear require cache so session-store picks up new env
  delete require.cache[require.resolve('../scripts/session-store')];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.AI_STATE_DIR;
});

function getStore() {
  return require('../scripts/session-store');
}

function runCli(...args) {
  const result = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
    ...args
  ], {
    env: { ...process.env, AI_STATE_DIR: tmpDir },
    encoding: 'utf8',
    timeout: 10000
  });
  return JSON.parse(result);
}

function runCliSafe(...args) {
  try {
    return runCli(...args);
  } catch (err) {
    // Process may exit non-zero but still produce JSON on stdout
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* fall through */ }
    }
    throw err;
  }
}

describe('session verify', () => {
  it('returns error when session name is missing', () => {
    const result = runCliSafe('session', 'verify');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing_name');
  });

  it('returns session_not_found for non-existent session', () => {
    const result = runCliSafe('session', 'verify', 'nonexistent', '--url', 'https://example.com');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'session_not_found');
    assert.ok(result.message.includes('not found'));
  });

  it('returns session_expired for expired session', () => {
    const store = getStore();
    store.createSession('expired');
    const metaPath = path.join(store.getSessionDir('expired'), 'metadata.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    const result = runCliSafe('session', 'verify', 'expired', '--url', 'https://example.com');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'session_expired');
  });

  it('returns missing_url when no --url and no --provider', () => {
    const store = getStore();
    store.createSession('nourl');

    const result = runCliSafe('session', 'verify', 'nourl');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'missing_url');
  });

  it('returns unknown_provider for invalid provider name', () => {
    const store = getStore();
    store.createSession('badprov');

    const result = runCliSafe('session', 'verify', 'badprov', '--provider', 'nonexistent-provider-xyz');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'unknown_provider');
  });

  it('returns invalid_url for malformed URL', () => {
    const store = getStore();
    store.createSession('invalidurl');

    const result = runCliSafe('session', 'verify', 'invalidurl', '--url', 'not-a-url');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_url');
  });

  it('returns invalid_name for bad session name', () => {
    const result = runCliSafe('session', 'verify', 'bad name!@#');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_name');
  });

  it('returns invalid_expect_status for non-numeric status', () => {
    const store = getStore();
    store.createSession('statustest');

    const result = runCliSafe('session', 'verify', 'statustest', '--url', 'https://example.com', '--expect-status', 'abc');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_expect_status');
  });
});
