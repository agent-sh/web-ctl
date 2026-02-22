'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { macros } = require('../scripts/macros');

describe('macros exports', () => {
  it('exports all 12 macros', () => {
    const expected = [
      'select-option', 'tab-switch', 'modal-dismiss', 'form-fill',
      'search-select', 'date-pick', 'file-upload', 'hover-reveal',
      'scroll-to', 'wait-toast', 'iframe-action', 'login'
    ];
    for (const name of expected) {
      assert.equal(typeof macros[name], 'function', `macro "${name}" should be a function`);
    }
    assert.equal(Object.keys(macros).length, 12, 'should have exactly 12 macros');
  });
});

describe('macro argument validation', () => {
  // Stub helpers and page that won't be reached due to validation errors
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    randomDelay: async () => {},
    getSnapshot: async () => '(stub)',
    sanitizeWebContent: s => s
  };
  const stubPage = {};

  it('select-option requires trigger and option text', async () => {
    await assert.rejects(
      () => macros['select-option'](stubPage, [], {}, stubHelpers),
      /Usage: select-option/
    );
  });

  it('tab-switch requires tab name', async () => {
    await assert.rejects(
      () => macros['tab-switch'](stubPage, [], {}, stubHelpers),
      /Usage: tab-switch/
    );
  });

  it('form-fill requires --fields', async () => {
    await assert.rejects(
      () => macros['form-fill'](stubPage, [], {}, stubHelpers),
      /Usage: form-fill/
    );
  });

  it('form-fill rejects invalid JSON', async () => {
    await assert.rejects(
      () => macros['form-fill'](stubPage, [], { fields: 'not-json' }, stubHelpers),
      /Invalid JSON/
    );
  });

  it('search-select requires input selector and query', async () => {
    await assert.rejects(
      () => macros['search-select'](stubPage, [], {}, stubHelpers),
      /Usage: search-select/
    );
  });

  it('search-select requires --pick', async () => {
    await assert.rejects(
      () => macros['search-select'](stubPage, ['#input', 'query'], {}, stubHelpers),
      /--pick/
    );
  });

  it('date-pick requires input selector', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, [], {}, stubHelpers),
      /Usage: date-pick/
    );
  });

  it('date-pick requires --date', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], {}, stubHelpers),
      /--date/
    );
  });

  it('file-upload requires selector and file path', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, [], {}, stubHelpers),
      /Usage: file-upload/
    );
  });

  it('hover-reveal requires trigger selector', async () => {
    await assert.rejects(
      () => macros['hover-reveal'](stubPage, [], {}, stubHelpers),
      /Usage: hover-reveal/
    );
  });

  it('hover-reveal requires --click', async () => {
    await assert.rejects(
      () => macros['hover-reveal'](stubPage, ['#trigger'], {}, stubHelpers),
      /--click/
    );
  });

  it('scroll-to requires selector', async () => {
    await assert.rejects(
      () => macros['scroll-to'](stubPage, [], {}, stubHelpers),
      /Usage: scroll-to/
    );
  });

  it('iframe-action requires iframe selector and action', async () => {
    await assert.rejects(
      () => macros['iframe-action'](stubPage, [], {}, stubHelpers),
      /Usage: iframe-action/
    );
  });

  it('iframe-action rejects unknown action', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'dance'], {}, stubHelpers),
      /Unknown iframe action/
    );
  });

  it('login requires --user and --pass', async () => {
    await assert.rejects(
      () => macros['login'](stubPage, [], {}, stubHelpers),
      /Usage: login/
    );
  });

  it('date-pick rejects invalid date format', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2024/01/15' }, stubHelpers),
      /Invalid date format/
    );
  });

  it('date-pick rejects non-date strings', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: 'not-a-date' }, stubHelpers),
      /Invalid date format/
    );
  });

  it('date-pick rejects semantically invalid dates', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2026-02-30' }, stubHelpers),
      /Date out of range/
    );
  });

  it('date-pick rejects month 13', async () => {
    await assert.rejects(
      () => macros['date-pick'](stubPage, ['#input'], { date: '2026-13-01' }, stubHelpers),
      /Date out of range/
    );
  });

  it('file-upload rejects paths outside allowed directories', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/etc/passwd'], {}, stubHelpers),
      /File path must be within/
    );
  });

  it('file-upload rejects dotfiles even in allowed dirs', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/tmp/.env'], {}, stubHelpers),
      /dotfile/
    );
  });

  it('file-upload rejects home directory paths', async () => {
    await assert.rejects(
      () => macros['file-upload'](stubPage, ['input', '/home/user/.ssh/id_rsa'], {}, stubHelpers),
      /File path must be within/
    );
  });

  it('iframe-action click requires selector', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'click'], {}, stubHelpers),
      /Selector required/
    );
  });

  it('iframe-action fill requires selector and value', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'fill'], {}, stubHelpers),
      /Selector and value required/
    );
  });

  it('iframe-action read requires selector', async () => {
    const pageWithFrame = { frameLocator: () => ({}) };
    await assert.rejects(
      () => macros['iframe-action'](pageWithFrame, ['#frame', 'read'], {}, stubHelpers),
      /Selector required/
    );
  });
});

describe('modal-dismiss detection', () => {
  const stubHelpers = {
    resolveSelector: () => {},
    waitForStable: async () => {},
    getSnapshot: async () => '(stub)'
  };

  it('throws when no modal is detected', async () => {
    const page = {
      locator: () => ({
        first: () => ({ count: async () => 0, isVisible: async () => false }),
        count: async () => 0
      })
    };
    await assert.rejects(
      () => macros['modal-dismiss'](page, [], {}, stubHelpers),
      /No visible modal detected/
    );
  });
});

describe('wait-toast detection', () => {
  const stubHelpers = {
    getSnapshot: async () => '(stub)'
  };

  it('rejects non-numeric timeout', async () => {
    await assert.rejects(
      () => macros['wait-toast']({}, [], { timeout: 'abc' }, stubHelpers),
      /--timeout must be a positive integer/
    );
  });

  it('throws when no toast appears within timeout', async () => {
    const page = {
      locator: () => ({
        first: () => ({ waitFor: async () => { throw new Error('Timeout'); } })
      })
    };
    await assert.rejects(
      () => macros['wait-toast'](page, [], { timeout: '100' }, stubHelpers),
      /Timeout/
    );
  });
});
