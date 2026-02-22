'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const webCtlSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'web-ctl.js'),
  'utf8'
);

describe('web-ctl navigation state persistence', () => {
  it('saves lastUrl before closeBrowser on success path', () => {
    assert.ok(
      webCtlSource.includes("sessionStore.updateSession(sessionName, { lastUrl: currentUrl })"),
      'web-ctl.js must save lastUrl via updateSession before closing browser'
    );
  });

  it('restores lastUrl for non-goto actions after browser launch', () => {
    assert.ok(
      webCtlSource.includes("action !== 'goto' && session.lastUrl"),
      'web-ctl.js must check for lastUrl and restore it for non-goto actions'
    );
    assert.ok(
      webCtlSource.includes("await page.goto(session.lastUrl"),
      'web-ctl.js must navigate to session.lastUrl on restore'
    );
  });

  it('skips restore for goto action', () => {
    assert.ok(
      webCtlSource.includes("action !== 'goto'"),
      'web-ctl.js must skip URL restore for goto actions'
    );
  });

  it('saves lastUrl in error path too', () => {
    const matches = webCtlSource.match(/sessionStore\.updateSession\(sessionName, \{ lastUrl: currentUrl \}\)/g);
    assert.ok(matches && matches.length >= 2,
      'web-ctl.js must save lastUrl in both success and error paths'
    );
  });
});
