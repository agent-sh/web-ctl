'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const launcherSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'browser-launcher.js'),
  'utf8'
);

describe('browser stealth init script', () => {

  it('hides navigator.webdriver', () => {
    assert.ok(
      launcherSource.includes("navigator, 'webdriver'"),
      'should spoof navigator.webdriver'
    );
  });

  it('spoofs window.chrome object', () => {
    assert.ok(
      launcherSource.includes('window.chrome'),
      'should define window.chrome'
    );
  });

  it('spoofs navigator.plugins', () => {
    assert.ok(
      launcherSource.includes("navigator, 'plugins'"),
      'should spoof navigator.plugins'
    );
    assert.ok(
      launcherSource.includes('Chrome PDF Plugin'),
      'should include a realistic plugin'
    );
  });

  it('spoofs navigator.languages', () => {
    assert.ok(
      launcherSource.includes("navigator, 'languages'"),
      'should spoof navigator.languages'
    );
  });

  it('overrides WebGL renderer', () => {
    assert.ok(
      launcherSource.includes('UNMASKED_VENDOR_WEBGL'),
      'should override WebGL vendor'
    );
    assert.ok(
      launcherSource.includes('UNMASKED_RENDERER_WEBGL'),
      'should override WebGL renderer'
    );
  });

  it('overrides permissions.query', () => {
    assert.ok(
      launcherSource.includes('permissions.query'),
      'should override permissions.query'
    );
  });

  it('removes known CDP detection artifacts', () => {
    assert.ok(
      launcherSource.includes('cdc_adoQpoasnfa76pfcZLmcfl_Array'),
      'should target known CDP artifact names'
    );
  });

  it('spoofs screen dimensions', () => {
    assert.ok(
      launcherSource.includes("'outerWidth'"),
      'should spoof window.outerWidth'
    );
    assert.ok(
      launcherSource.includes("'outerHeight'"),
      'should spoof window.outerHeight'
    );
    assert.ok(
      launcherSource.includes("'availWidth'"),
      'should spoof screen.availWidth'
    );
    assert.ok(
      launcherSource.includes("'availHeight'"),
      'should spoof screen.availHeight'
    );
  });

  it('spoofs navigator.connection', () => {
    assert.ok(
      launcherSource.includes('navigator.connection'),
      'should spoof navigator.connection'
    );
    assert.ok(
      launcherSource.includes("effectiveType: '4g'"),
      'should report 4g connection'
    );
  });

  it('prevents WebRTC IP leak', () => {
    assert.ok(
      launcherSource.includes('RTCPeerConnection'),
      'should override RTCPeerConnection'
    );
    assert.ok(
      launcherSource.includes('iceServers'),
      'should clear iceServers'
    );
  });
});

describe('browser launch options', () => {

  it('sets realistic viewport size', () => {
    assert.ok(
      launcherSource.includes('viewport:'),
      'should set viewport'
    );
    assert.ok(
      launcherSource.includes('1920'),
      'should use 1920 width'
    );
    assert.ok(
      launcherSource.includes('1080'),
      'should use 1080 height'
    );
  });

  it('sets window-size arg', () => {
    assert.ok(
      launcherSource.includes('--window-size=1920,1080'),
      'should set --window-size arg'
    );
  });

  it('disables automation controlled features', () => {
    assert.ok(
      launcherSource.includes('--disable-blink-features=AutomationControlled'),
      'should disable AutomationControlled'
    );
  });
});
