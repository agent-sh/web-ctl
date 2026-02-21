'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ctl-test-'));
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

describe('createSession', () => {
  it('creates session directory and metadata', () => {
    const store = getStore();
    const meta = store.createSession('test');
    assert.equal(meta.name, 'test');
    assert.equal(meta.status, 'active');
    assert.ok(meta.createdAt);
    assert.ok(meta.expiresAt);

    const sessionDir = store.getSessionDir('test');
    assert.ok(fs.existsSync(sessionDir));
    assert.ok(fs.existsSync(path.join(sessionDir, 'metadata.json')));
    assert.ok(fs.existsSync(path.join(sessionDir, 'profile')));
  });

  it('throws if session already exists', () => {
    const store = getStore();
    store.createSession('dup');
    assert.throws(() => store.createSession('dup'), /already exists/);
  });
});

describe('getSession', () => {
  it('returns null for unknown session', () => {
    const store = getStore();
    assert.equal(store.getSession('nonexistent'), null);
  });

  it('returns metadata for valid session', () => {
    const store = getStore();
    store.createSession('valid');
    const meta = store.getSession('valid');
    assert.equal(meta.name, 'valid');
    assert.equal(meta.status, 'active');
  });

  it('marks expired sessions', () => {
    const store = getStore();
    store.createSession('expired');
    // Manually set expiresAt to past
    const metaPath = path.join(store.getSessionDir('expired'), 'metadata.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    const result = store.getSession('expired');
    assert.equal(result.status, 'expired');
  });
});

describe('listSessions', () => {
  it('returns empty array when no sessions exist', () => {
    const store = getStore();
    assert.deepEqual(store.listSessions(), []);
  });

  it('returns all sessions', () => {
    const store = getStore();
    store.createSession('a');
    store.createSession('b');
    const list = store.listSessions();
    assert.equal(list.length, 2);
    const names = list.map(s => s.name).sort();
    assert.deepEqual(names, ['a', 'b']);
  });
});

describe('deleteSession', () => {
  it('removes session directory', () => {
    const store = getStore();
    store.createSession('del');
    store.deleteSession('del');
    assert.equal(store.getSession('del'), null);
  });

  it('throws for unknown session', () => {
    const store = getStore();
    assert.throws(() => store.deleteSession('nope'), /not found/);
  });
});

describe('saveStorageState / loadStorageState', () => {
  it('round-trips encrypted state', () => {
    const store = getStore();
    store.createSession('enc');

    const state = {
      cookies: [{ name: 'sid', value: 'secret123', domain: '.example.com' }],
      origins: [{ origin: 'https://example.com', localStorage: [] }]
    };

    store.saveStorageState('enc', state);
    const loaded = store.loadStorageState('enc');
    assert.deepEqual(loaded, state);
  });

  it('returns null when no encrypted state exists', () => {
    const store = getStore();
    store.createSession('noenc');
    assert.equal(store.loadStorageState('noenc'), null);
  });

  it('rejects tampered ciphertext (GCM auth tag mismatch)', () => {
    const store = getStore();
    store.createSession('tampered');
    store.saveStorageState('tampered', { cookies: [{ name: 'a' }] });

    // Corrupt a byte in storage.enc
    const encPath = path.join(store.getSessionDir('tampered'), 'storage.enc');
    const data = fs.readFileSync(encPath);
    data[data.length - 1] ^= 0xff; // flip last byte
    fs.writeFileSync(encPath, data);

    assert.throws(() => store.loadStorageState('tampered'));
  });

  it('updates metadata with cookie count and domain', () => {
    const store = getStore();
    store.createSession('meta');

    const state = {
      cookies: [{ name: 'a' }, { name: 'b' }],
      origins: [{ origin: 'https://test.com' }]
    };

    store.saveStorageState('meta', state);
    const meta = store.getSession('meta');
    assert.equal(meta.cookieCount, 2);
    assert.equal(meta.domain, 'https://test.com');
  });
});

describe('lockSession / unlockSession', () => {
  it('creates and removes lock file', () => {
    const store = getStore();
    store.createSession('lock');
    store.lockSession('lock');

    const lockPath = path.join(store.getSessionDir('lock'), 'session.lock');
    assert.ok(fs.existsSync(lockPath));

    store.unlockSession('lock');
    assert.ok(!fs.existsSync(lockPath));
  });

  it('throws when session is already locked by active process', () => {
    const store = getStore();
    store.createSession('locked');
    store.lockSession('locked');
    assert.throws(() => store.lockSession('locked'), /is locked/);
    store.unlockSession('locked');
  });

  it('cleans up stale lock from non-existent process', () => {
    const store = getStore();
    store.createSession('stale');
    // Write a lock file with a PID that doesn't exist
    const lockPath = path.join(store.getSessionDir('stale'), 'session.lock');
    fs.writeFileSync(lockPath, '999999999');
    // Should succeed — stale lock is cleaned
    store.lockSession('stale');
    store.unlockSession('stale');
  });
});

describe('updateSession', () => {
  it('merges fields into metadata', () => {
    const store = getStore();
    store.createSession('upd');
    const result = store.updateSession('upd', { status: 'authenticated', domain: 'x.com' });
    assert.equal(result.status, 'authenticated');
    assert.equal(result.domain, 'x.com');
    assert.equal(result.name, 'upd');
  });

  it('throws for unknown session', () => {
    const store = getStore();
    assert.throws(() => store.updateSession('nope', {}), /not found/);
  });
});
