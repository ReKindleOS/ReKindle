#!/usr/bin/env node
/*
 * Regenerate js/pixel-templates.js from the hand-authored grids in
 * scripts/pixel-template-art.js.
 *
 * The output is deterministic: running this twice produces identical bytes.
 * No image library or binary source assets are involved.
 *
 *     node scripts/build-pixel-templates.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { renderSource, buildTemplates } = require('./lib/pixel-templates.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'pixel-templates.js');

const source = renderSource();
fs.writeFileSync(OUT, source, 'utf8');
console.log('wrote ' + OUT + ' (' + buildTemplates().length + ' templates, ' + Buffer.byteLength(source) + ' bytes)');
