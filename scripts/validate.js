#!/usr/bin/env node
'use strict';

const { validateManifestFile } = require('../lib/schemas/validator');

const result = validateManifestFile('.claude-plugin/plugin.json');
if (!result.valid) {
  console.error('[ERROR] Plugin manifest invalid:', result.errors);
  process.exit(1);
}
console.log('[OK] Plugin manifest valid');
