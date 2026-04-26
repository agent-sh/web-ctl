'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function load() {
  delete require.cache[require.resolve('../scripts/web-ctl')];
  return require('../scripts/web-ctl');
}

beforeEach(() => { delete process.env.WEB_CTL_ALLOW_PRIVATE_NETWORK; });
afterEach(() => { delete process.env.WEB_CTL_ALLOW_PRIVATE_NETWORK; });

describe('isPrivateIpv4', () => {
  const { isPrivateIpv4 } = load();

  it('flags loopback 127.0.0.0/8', () => {
    assert.equal(isPrivateIpv4('127.0.0.1'), true);
    assert.equal(isPrivateIpv4('127.255.255.254'), true);
  });

  it('flags link-local / metadata 169.254.0.0/16', () => {
    assert.equal(isPrivateIpv4('169.254.169.254'), true);
    assert.equal(isPrivateIpv4('169.254.0.1'), true);
  });

  it('flags RFC1918', () => {
    assert.equal(isPrivateIpv4('10.0.0.1'), true);
    assert.equal(isPrivateIpv4('10.255.255.255'), true);
    assert.equal(isPrivateIpv4('172.16.0.1'), true);
    assert.equal(isPrivateIpv4('172.31.255.254'), true);
    assert.equal(isPrivateIpv4('192.168.1.1'), true);
  });

  it('flags 0.0.0.0/8', () => {
    assert.equal(isPrivateIpv4('0.0.0.0'), true);
    assert.equal(isPrivateIpv4('0.1.2.3'), true);
  });

  it('does not flag public addresses', () => {
    assert.equal(isPrivateIpv4('8.8.8.8'), false);
    assert.equal(isPrivateIpv4('1.1.1.1'), false);
    assert.equal(isPrivateIpv4('172.32.0.1'), false); // outside 172.16/12
    assert.equal(isPrivateIpv4('172.15.255.255'), false);
    assert.equal(isPrivateIpv4('93.184.216.34'), false); // example.com
  });
});

describe('isPrivateIpv6', () => {
  const { isPrivateIpv6 } = load();

  it('flags ::1 loopback', () => {
    assert.equal(isPrivateIpv6('::1'), true);
  });

  it('flags fc00::/7 unique local', () => {
    assert.equal(isPrivateIpv6('fc00::1'), true);
    assert.equal(isPrivateIpv6('fd12:3456:789a::1'), true);
  });

  it('flags fe80::/10 link-local', () => {
    assert.equal(isPrivateIpv6('fe80::1'), true);
    assert.equal(isPrivateIpv6('febf::1'), true);
  });

  it('flags IPv4-mapped private addresses', () => {
    assert.equal(isPrivateIpv6('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIpv6('::ffff:169.254.169.254'), true);
  });

  it('does not flag public IPv6', () => {
    assert.equal(isPrivateIpv6('2606:4700:4700::1111'), false); // cloudflare
    assert.equal(isPrivateIpv6('2001:4860:4860::8888'), false); // google
  });
});

describe('assertUrlAllowed', () => {
  it('rejects non-http schemes', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(() => assertUrlAllowed('file:///etc/passwd'), /scheme/i);
    await assert.rejects(() => assertUrlAllowed('javascript:alert(1)'), /scheme/i);
    await assert.rejects(() => assertUrlAllowed('ftp://example.com'), /scheme/i);
  });

  it('rejects http://169.254.169.254 (AWS/GCP metadata)', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(
      () => assertUrlAllowed('http://169.254.169.254/latest/meta-data/'),
      /169\.254\.169\.254|private/i
    );
  });

  it('rejects http://127.0.0.1', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(() => assertUrlAllowed('http://127.0.0.1:8080/'), /127\.0\.0\.1|loopback|private/i);
  });

  it('rejects RFC1918 literals', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(() => assertUrlAllowed('http://10.0.0.1/'), /private/i);
    await assert.rejects(() => assertUrlAllowed('http://192.168.0.1/'), /private/i);
    await assert.rejects(() => assertUrlAllowed('http://172.16.0.1/'), /private/i);
  });

  it('rejects cloud metadata hostnames before DNS', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(
      () => assertUrlAllowed('http://metadata.google.internal/computeMetadata/v1/'),
      /metadata/i
    );
    await assert.rejects(() => assertUrlAllowed('http://metadata/'), /metadata/i);
    await assert.rejects(() => assertUrlAllowed('http://instance-data/'), /metadata/i);
  });

  it('rejects [::1] IPv6 loopback', async () => {
    const { assertUrlAllowed } = load();
    await assert.rejects(() => assertUrlAllowed('http://[::1]:8080/'), /IPv6|loopback|private/i);
  });

  it('allows denylist bypass via WEB_CTL_ALLOW_PRIVATE_NETWORK=1', async () => {
    process.env.WEB_CTL_ALLOW_PRIVATE_NETWORK = '1';
    const { assertUrlAllowed } = load();
    await assertUrlAllowed('http://127.0.0.1:3000/'); // must not throw
    await assertUrlAllowed('http://169.254.169.254/');
  });
});
