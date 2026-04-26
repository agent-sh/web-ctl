'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { generateVncToken } = require('../scripts/vnc-auth');

describe('VNC token', () => {
  it('is exactly 8 characters (RFB protocol truncates to 8 bytes via DES)', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateVncToken();
      assert.equal(t.length, 8, `token "${t}" should be 8 chars`);
    }
  });

  it('uses only alphanumeric chars (safe for RFB framing, no base64 padding)', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateVncToken();
      assert.match(t, /^[A-Za-z0-9]{8}$/);
    }
  });

  it('has adequate randomness (no duplicates across many draws)', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(generateVncToken());
    // 200 draws from 62^8 (~218 trillion) should be all unique with
    // overwhelming probability. If this ever fails the RNG is broken.
    assert.equal(seen.size, 200);
  });
});
