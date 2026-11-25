/*
 * Avatar rendering semantics (social pages).
 *
 * Run: node scripts/test-avatars.js
 *
 * Pins the rules that regressed twice:
 *   - a deliberately white avatar ('blank' or a complete all-zero 8x8/16x16
 *     grid) must stay white instead of falling back to the uid pattern;
 *   - malformed customAvatar data still falls back to the generated pattern;
 *   - deleted profiles are drawn as the neutral person outline, not white.
 *
 * The drawAvatar() copies are inline in huge HTML files, so this test extracts
 * the function source, evaluates it against a recording canvas, and inspects
 * the fillRect calls. It is hermetic (no browser, no Firebase).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Pull `function NAME(...) { ... }` out of a file, respecting strings/comments
// so a brace inside a literal cannot end the function early.
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert(start !== -1, 'missing function ' + name);
    let depth = 0;
    let state = null;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        const c = src[i];
        const next = src[i + 1];
        if (state === '//') {
            if (c === '\n') state = null;
            continue;
        }
        if (state === '/*') {
            if (c === '*' && next === '/') { state = null; i++; }
            continue;
        }
        if (state) {
            if (c === '\\') { i++; continue; }
            if (c === state) state = null;
            continue;
        }
        if (c === '/' && next === '/') { state = '//'; i++; continue; }
        if (c === '/' && next === '*') { state = '/*'; i++; continue; }
        if (c === '"' || c === "'") { state = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('unterminated function ' + name);
}

// Recording 2D context: every fillRect is kept with the fillStyle in force.
function makeCanvas(width) {
    const rects = [];
    const ctx = {
        fillStyle: '#000',
        fillRect(x, y, w, h) {
            rects.push({ x: x, y: y, w: w, h: h, fill: ctx.fillStyle });
        }
    };
    const canvas = {
        width: width,
        height: width,
        rects: rects,
        getContext: function () { return ctx; }
    };
    const doc = {
        getElementById: function (id) { return id === 'avatar' ? canvas : null; }
    };
    return { canvas: canvas, doc: doc, rects: rects };
}

function loadDrawAvatar(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const fnSrc = extractFunction(src, 'drawAvatar');
    const factory = new Function('document', 'window', fnSrc + '\nreturn drawAvatar;');
    return function (doc) { return factory(doc, {}); };
}

function assertOnlyWhite(rects, size) {
    assert.deepStrictEqual(rects, [{ x: 0, y: 0, w: size, h: size, fill: '#fff' }],
        'expected a single white canvas fill');
}

const SOCIAL_PAGES = ['neighbourhood.html', 'kindlechat.html', 'topics.html'];

for (const file of SOCIAL_PAGES) {
    const makeDrawAvatar = loadDrawAvatar(file);

    // 'blank' sentinel -> white.
    let h = makeCanvas(128);
    makeDrawAvatar(h.doc)('avatar', 'blank');
    assertOnlyWhite(h.rects, 128);

    // A complete all-zero grid (8x8 and 16x16) -> white, not a uid pattern.
    h = makeCanvas(128);
    makeDrawAvatar(h.doc)('avatar', new Array(256).fill(0));
    assertOnlyWhite(h.rects, 128);

    h = makeCanvas(128);
    makeDrawAvatar(h.doc)('avatar', new Array(64).fill(0), 'some-uid');
    assertOnlyWhite(h.rects, 128);

    // A near-white grid keeps its ink (Yannick's old avatar had one pixel).
    h = makeCanvas(128);
    const onePixel = new Array(256).fill(0);
    onePixel[255] = 1;
    makeDrawAvatar(h.doc)('avatar', onePixel, 'some-uid');
    assert.deepStrictEqual(h.rects, [
        { x: 0, y: 0, w: 128, h: 128, fill: '#fff' },
        { x: 120, y: 120, w: 8, h: 8, fill: '#000' }
    ], file + ': one stray pixel must still render, not be replaced');

    // A uid seed still draws the generated pattern.
    h = makeCanvas(128);
    makeDrawAvatar(h.doc)('avatar', 'uid123');
    assert(h.rects.length > 1, file + ': uid seed should draw a pattern');
    assert(h.rects.some(function (r) { return r.fill === '#000'; }), file + ': pattern needs black pixels');

    // Malformed data (not a full grid) still falls back to the pattern.
    h = makeCanvas(128);
    makeDrawAvatar(h.doc)('avatar', { message: 'broken' }, 'uid123');
    assert(h.rects.length > 1, file + ': malformed seed should fall back to a pattern');
}

// Deleted profiles / guests: the guest16.png portrait from js/deleted-user.js.
const helperSrc = fs.readFileSync(path.join(ROOT, 'js/deleted-user.js'), 'utf8');
const shared = {};
const sandbox = { window: shared, document: null, console: console };
vm.createContext(sandbox);
vm.runInContext(helperSrc, sandbox);

assert.strictEqual(typeof shared.rekindleDrawDeletedAvatar, 'function', 'deleted avatar helper exported');
assert.strictEqual(shared.rekindleDrawDeletedAvatar, shared.rekindleDrawGuestAvatar, 'guest and deleted share one drawing');
assert.strictEqual(typeof shared.rekindleDeletedUserName, 'function', 'deleted name helper exported');

// The dashboard has its own copy (index does not load js/deleted-user.js).
// Extract both GUEST_ICON and drawGuestAvatar and compare the renders.
function loadHomeGuestAvatar() {
    const src = fs.readFileSync(path.join(ROOT, 'js/home.js'), 'utf8');
    const iconStart = src.indexOf('const GUEST_ICON = [');
    assert(iconStart !== -1, 'missing GUEST_ICON in js/home.js');
    const iconEnd = src.indexOf('];', iconStart) + 2;
    const fnSrc = extractFunction(src, 'drawGuestAvatar');
    const factory = new Function('document', 'window',
        src.slice(iconStart, iconEnd) + '\n' + fnSrc + '\nreturn drawGuestAvatar;');
    return factory;
}
const homeFactory = loadHomeGuestAvatar();

// The attached guest16.png art, row by row. Update together with both copies.
const GUEST_ART = [
    '................',
    '.....######.....',
    '...##......##...',
    '..#...####...#..',
    '..#..#....#..#..',
    '.#...#....#...#.',
    '.#...#....#...#.',
    '.#....####....#.',
    '.#............#.',
    '.#...######...#.',
    '.#..#......#..#.',
    '..##........##..',
    '..##........##..',
    '...##......##...',
    '.....######.....',
    '................'
];
const INK_RUNS = GUEST_ART.reduce(function (sum, row) {
    return sum + row.split('.').filter(function (run) { return run.length; }).length;
}, 0);

for (const size of [16, 32, 48, 128]) {
    const a = makeCanvas(size);
    sandbox.document = a.doc;
    shared.rekindleDrawDeletedAvatar('avatar');
    const b = makeCanvas(size);
    homeFactory(b.doc, {})(b.canvas);
    assert.deepStrictEqual(a.rects, b.rects,
        size + 'px: js/deleted-user.js and js/home.js guest art must match');

    assert.strictEqual(a.rects[0].fill, '#fff', 'guest avatar starts white');
    assert.strictEqual(a.rects[0].w, size, 'guest avatar fills the canvas');
    assert.strictEqual(a.rects[0].h, size, 'guest avatar fills the canvas');
    const ink = a.rects.slice(1);
    assert.strictEqual(ink.length, INK_RUNS, size + 'px: one rect per ink run');
    assert(ink.every(function (r) { return r.fill === '#000'; }), size + 'px: ink is black');
    assert(ink.every(function (r) {
        const u = size / 16;
        return r.x % u === 0 && r.y % u === 0 && r.w % u === 0 && r.h === u &&
            r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size;
    }), size + 'px: ink rects stay on the 16x16 grid');
}

// At 16px the pixels must match the attached art exactly.
{
    const h = makeCanvas(16);
    sandbox.document = h.doc;
    shared.rekindleDrawDeletedAvatar('avatar');
    const grid = [];
    for (let y = 0; y < 16; y++) grid.push(new Array(16).fill(false));
    h.rects.slice(1).forEach(function (r) {
        for (let y = r.y; y < r.y + r.h; y++) {
            for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = true;
        }
    });
    for (let y = 0; y < 16; y++) {
        const expected = GUEST_ART[y].split('').map(function (c) { return c === '#'; });
        assert.deepStrictEqual(grid[y], expected, 'guest icon row ' + y + ' must match guest16.png');
    }
}

// A missing element must not throw (avatars resolve asynchronously).
const emptyDoc = { getElementById: function () { return null; } };
sandbox.document = emptyDoc;
shared.rekindleDrawDeletedAvatar('missing');
shared.rekindleClearAvatar('missing');

console.log('PASS - avatars (white, deleted profile and malformed seeds)');
