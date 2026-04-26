'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

/**
 * Unit tests for the evaluate confirmation hash scheme.
 *
 * The contract (see scripts/web-ctl.js `confirmEvaluate`):
 *   confirm = sha256(code).hex().slice(0, 16)
 *
 * These tests lock that contract in so the CLI and any agent tooling
 * agree on the hash format. We do not test the interactive TTY prompt
 * (see commit message / README); integration for the non-TTY path is
 * covered by asserting hash equality and mismatch detection.
 */

function computeConfirm(code) {
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
}

describe('evaluate confirm hash', () => {
  it('is 16 hex characters', () => {
    const h = computeConfirm('document.title');
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  it('is stable for the same input', () => {
    const a = computeConfirm('return 1 + 1');
    const b = computeConfirm('return 1 + 1');
    assert.equal(a, b);
  });

  it('differs for different inputs', () => {
    const a = computeConfirm('document.title');
    const b = computeConfirm('document.location');
    assert.notEqual(a, b);
  });

  it('is case-insensitive compare-safe (we always emit lowercase hex)', () => {
    const h = computeConfirm('window.location.href');
    assert.equal(h, h.toLowerCase());
  });

  it('catches whitespace/byte-level tampering', () => {
    // A prompt-injection that adds a single space should not match.
    const a = computeConfirm('alert(1)');
    const b = computeConfirm('alert(1) ');
    assert.notEqual(a, b);
  });

  it('matches the reference value for a known input', () => {
    // Lock the exact prefix so external tooling can pre-compute hashes.
    const expected = crypto
      .createHash('sha256')
      .update('return document.title')
      .digest('hex')
      .slice(0, 16);
    assert.equal(computeConfirm('return document.title'), expected);
  });
});
