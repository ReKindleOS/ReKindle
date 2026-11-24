#!/usr/bin/env node
/* Guard: js/home-deps.js must match its five source files. */
'use strict';

const fs = require('fs');
const path = require('path');
const { build } = require('./build-home-deps');

const target = path.join(__dirname, '..', 'js', 'home-deps.js');
let actual = '';
try {
    actual = fs.readFileSync(target, 'utf8');
} catch (e) {
    console.error('FAIL - js/home-deps.js is missing; run npm run build:home-deps');
    process.exit(1);
}
const expected = build();
if (actual !== expected) {
    console.error('FAIL - js/home-deps.js is stale; run npm run build:home-deps');
    process.exit(1);
}
console.log('PASS - home dependency bundle is in sync');
