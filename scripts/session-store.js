'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getStateDir() {
  return process.env.AI_STATE_DIR || path.join(process.cwd(), '.claude');
}

function getSessionsDir() {
  return path.join(getStateDir(), 'web-ctl', 'sessions');
}

function getSessionDir(name) {
  return path.join(getSessionsDir(), name);
}

function getMasterKeyPath() {
  return path.join(getStateDir(), 'web-ctl', '.master-key');
}

function ensureDir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode: mode || 0o700 });
}

/**
 * Get or create the master encryption key.
 */
function getMasterKey() {
  const keyPath = getMasterKeyPath();
  ensureDir(path.dirname(keyPath));

  if (fs.existsSync(keyPath)) {
    const key = Buffer.from(fs.readFileSync(keyPath, 'utf8'), 'hex');
    if (key.length !== 32) {
      throw new Error('Master key file is corrupt: expected 32 bytes. Delete ' + keyPath + ' to regenerate.');
    }
    return key;
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  return key;
}

/**
 * Derive a per-session encryption key using HKDF.
 */
function deriveSessionKey(masterKey, sessionName) {
  return crypto.hkdfSync('sha256', masterKey, 'web-ctl-session-v1', sessionName, 32);
}

/**
 * Create a new session.
 */
function createSession(name) {
  const sessionDir = getSessionDir(name);
  const profileDir = path.join(sessionDir, 'profile');

  if (fs.existsSync(sessionDir)) {
    throw new Error(`Session "${name}" already exists`);
  }

  ensureDir(profileDir, 0o700);

  const metadata = {
    name,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    domain: null,
    cookieCount: 0,
    status: 'active'
  };

  fs.writeFileSync(
    path.join(sessionDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  return metadata;
}

/**
 * Get session metadata. Returns null if expired or not found.
 */
function getSession(name) {
  const metaPath = path.join(getSessionDir(name), 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  // Check TTL
  if (new Date(metadata.expiresAt) < new Date()) {
    metadata.status = 'expired';
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    return metadata;
  }

  return metadata;
}

/**
 * List all sessions.
 */
function listSessions() {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = getSession(entry.name);
      if (meta) {
        sessions.push(meta);
      }
    }
  }

  return sessions;
}

/**
 * Delete a session and all its data.
 */
function deleteSession(name) {
  const sessionDir = getSessionDir(name);

  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Session "${name}" not found`);
  }

  fs.rmSync(sessionDir, { recursive: true, force: true });
}

/**
 * Save encrypted storage state.
 */
function saveStorageState(name, state) {
  const sessionDir = getSessionDir(name);
  const masterKey = getMasterKey();
  const key = Buffer.from(deriveSessionKey(masterKey, name));

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(state);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Store as: iv (12) + tag (16) + ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  fs.writeFileSync(path.join(sessionDir, 'storage.enc'), combined);

  // Update metadata
  const metaPath = path.join(sessionDir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    metadata.cookieCount = (state.cookies || []).length;
    metadata.domain = state.origins && state.origins[0] ? state.origins[0].origin : metadata.domain;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  }
}

/**
 * Load and decrypt storage state.
 */
function loadStorageState(name) {
  const encPath = path.join(getSessionDir(name), 'storage.enc');

  if (!fs.existsSync(encPath)) {
    return null;
  }

  const masterKey = getMasterKey();
  const key = Buffer.from(deriveSessionKey(masterKey, name));
  const combined = fs.readFileSync(encPath);

  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(12, 28);
  const ciphertext = combined.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * File-based session lock.
 */
function lockSession(name) {
  const lockPath = path.join(getSessionDir(name), 'session.lock');
  const pid = process.pid.toString();

  try {
    // Atomic lock creation — fails if file already exists
    const fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeSync(fd, pid);
    fs.closeSync(fd);
  } catch (e) {
    if (e.code === 'EEXIST') {
      // Lock file exists — check if stale
      const existingPid = fs.readFileSync(lockPath, 'utf8').trim();
      try {
        process.kill(parseInt(existingPid, 10), 0);
        // Process exists, lock is active
        throw new Error(`Session "${name}" is locked by process ${existingPid}`);
      } catch (killErr) {
        if (killErr.code === 'ESRCH') {
          // Stale lock (process gone), remove and retry
          fs.unlinkSync(lockPath);
          return lockSession(name);
        } else if (killErr.code === 'EPERM') {
          // Process exists but owned by another user — treat as active lock
          throw new Error(`Session "${name}" is locked by process ${existingPid}`);
        }
        throw killErr;
      }
    } else if (e.code === 'ENOENT') {
      throw new Error(`Session "${name}" not found`);
    }
    throw e;
  }
}

/**
 * Release session lock.
 */
function unlockSession(name) {
  const lockPath = path.join(getSessionDir(name), 'session.lock');

  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

/**
 * Get the profile directory path for a session.
 */
function getProfileDir(name) {
  return path.join(getSessionDir(name), 'profile');
}

/**
 * Update session metadata fields.
 */
function updateSession(name, updates) {
  const metaPath = path.join(getSessionDir(name), 'metadata.json');

  if (!fs.existsSync(metaPath)) {
    throw new Error(`Session "${name}" not found`);
  }

  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  Object.assign(metadata, updates);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  return metadata;
}

module.exports = {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  saveStorageState,
  loadStorageState,
  lockSession,
  unlockSession,
  getProfileDir,
  updateSession,
  getSessionDir
};
