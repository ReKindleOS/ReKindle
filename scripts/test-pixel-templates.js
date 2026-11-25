/*
 * Pixel tracing-template checks.
 *
 * Run: node scripts/test-pixel-templates.js
 *
 * The templates are deterministic 1-bit art generated from the hand-authored
 * grids in scripts/pixel-template-art.js. This test pins the shipped set and
 * fails if js/pixel-templates.js drifts from that source, so a bad build cannot
 * ship blank, malformed or unlicensed templates. It also checks that pixel.html
 * loads the data, keeps the template out of the saved grid, and builds gallery
 * thumbnails from the logical grid (not the scaled editor canvas).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const dataFile = path.join(ROOT, 'js', 'pixel-templates.js');
const artFile = path.join(ROOT, 'scripts', 'pixel-template-art.js');
const licenseFile = path.join(ROOT, 'assets', 'templates', 'LICENSE.txt');
const sourcesFile = path.join(ROOT, 'assets', 'templates', 'SOURCES.md');
const stalePngDir = path.join(ROOT, 'assets', 'templates', 'source');
const pixel = fs.readFileSync(path.join(ROOT, 'pixel.html'), 'utf8');

assert.ok(fs.existsSync(dataFile), 'js/pixel-templates.js must exist');
assert.ok(fs.existsSync(artFile), 'scripts/pixel-template-art.js must exist');
assert.ok(fs.existsSync(licenseFile), 'assets/templates/LICENSE.txt must exist');
assert.ok(fs.existsSync(sourcesFile), 'assets/templates/SOURCES.md must exist');
assert.ok(!fs.existsSync(stalePngDir),
    'assets/templates/source PNGs were replaced by hand-authored art; do not ship stale PNG sources');

const builder = require(path.join(ROOT, 'scripts', 'lib', 'pixel-templates.js'));
const committed = fs.readFileSync(dataFile, 'utf8');

// Deterministic build: the same source must produce byte-identical output.
assert.strictEqual(builder.renderSource(), builder.renderSource(), 'template build must be deterministic');
assert.strictEqual(committed, builder.renderSource(),
    'js/pixel-templates.js must match scripts/build-pixel-templates.js output');
assert.ok(committed.indexOf('Kenney') === -1, 'generated data must not reference the retired icon pack');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(committed, sandbox, { filename: 'js/pixel-templates.js' });
const templates = sandbox.window.REKINDLE_PIXEL_TEMPLATES;

assert.ok(Array.isArray(templates), 'REKINDLE_PIXEL_TEMPLATES must be an array');
assert.ok(templates.length >= 12, 'expected at least 12 templates, got ' + templates.length);
assert.ok(templates.length <= 24, 'keep the tracing set small, got ' + templates.length);

// The tracing set is deliberately friendly pixel art, not UI icons.
const expectedIds = [
    'heart', 'star', 'smile', 'cat', 'flower', 'tree', 'house', 'mushroom',
    'cloud', 'sun', 'moon', 'fish', 'ghost', 'robot', 'diamond', 'lightning'
];
// Copy into a host-realm array: map() on the vm array would return a vm array,
// whose prototype differs under deepStrictEqual.
const actualIds = [];
for (const t of templates) actualIds.push(t.id);
actualIds.sort();
assert.deepStrictEqual(actualIds, expectedIds.slice().sort(),
    'shipped template ids must be the friendly tracing set');

const ids = new Set();
const names = new Set();
const categories = new Set();

for (const t of templates) {
    assert.ok(t && typeof t.id === 'string' && t.id, 'template id');
    assert.ok(!ids.has(t.id), 'duplicate template id: ' + t.id);
    ids.add(t.id);
    assert.ok(typeof t.name === 'string' && t.name, 'template name: ' + t.id);
    assert.ok(!names.has(t.name), 'duplicate template name: ' + t.name);
    names.add(t.name);
    assert.ok(typeof t.category === 'string' && t.category, 'template category: ' + t.id);
    categories.add(t.category);
    assert.ok(t.size === 16 || t.size === 32, 'template size must be 16 or 32: ' + t.id);
    assert.ok(Array.isArray(t.rows) && t.rows.length === t.size, 'row count for ' + t.id);
    let ink = 0;
    for (const row of t.rows) {
        assert.strictEqual(typeof row, 'string', 'row type for ' + t.id);
        assert.strictEqual(row.length, t.size, 'row width for ' + t.id);
        assert.ok(/^[01]+$/.test(row), 'row must be 1-bit for ' + t.id);
        for (const ch of row) if (ch === '1') ink++;
    }
    assert.ok(ink >= 16, 'template has too little ink: ' + t.id);
    assert.ok(/^0+$/.test(t.rows[0]), 'template needs an empty top row: ' + t.id);
    assert.ok(/^0+$/.test(t.rows[t.size - 1]), 'template needs an empty bottom row: ' + t.id);
}

assert.ok(categories.size >= 3, 'templates need at least three categories');
assert.ok(templates.filter(t => t.size === 16).length >= 12, 'most shapes should use the 16x16 grid');

const license = fs.readFileSync(licenseFile, 'utf8');
assert.ok(/original/i.test(license), 'license file must record that the art is original');
assert.ok(/CC0/i.test(license), 'license file must record CC0');
assert.ok(!/Kenney/i.test(license), 'license file must not reference the retired icon pack');

const sources = fs.readFileSync(sourcesFile, 'utf8');
assert.ok(/original/i.test(sources), 'sources file must record original art');
assert.ok(sources.indexOf('pixel-template-art.js') !== -1, 'sources file must point at the art source');
assert.ok(!/Kenney/i.test(sources), 'sources file must not reference the retired icon pack');

// Pixel templates are intentionally disabled in the app for now. Keep the
// generated data/source tests above so the feature can be restored later, but
// do not require the picker/script to be wired into pixel.html.
assert.ok(pixel.indexOf('js/pixel-templates.js') === -1, 'pixel.html must not load template data while disabled');
assert.ok(pixel.indexOf('id="templates-modal"') === -1, 'pixel.html must not show the template picker while disabled');
assert.ok(pixel.indexOf('onclick="openTemplates()"') === -1, 'pixel.html must not offer a Templates button while disabled');

// The template must never be written into the grid payload: saveDrawingData
// only receives grid + template id, and the grid comes from `grid`.
assert.ok(/saveDrawingData\(currentDrawingId, grid, templateId\)/.test(pixel),
    'drawing save must keep the template out of the grid');

// Gallery thumbnails: fixed-size render of the logical grid, never the editor
// canvas (which is device/window scaled and can produce blank previews).
assert.ok(pixel.indexOf('const THUMBNAIL_SIZE = 64;') !== -1, 'thumbnails need a fixed canvas size');
assert.ok(pixel.indexOf('function createThumbnailDataUrl') !== -1, 'pixel.html must build thumbnails from the grid');
assert.ok(pixel.indexOf('return createGridImageDataUrl(gridData, size, THUMBNAIL_SIZE);') !== -1,
    'createThumbnailDataUrl must render into the fixed thumbnail canvas');
assert.ok(pixel.indexOf('item.thumbnail = createThumbnailDataUrl(grid, gridSize);') !== -1,
    'saving must regenerate the thumbnail from the logical grid');
assert.ok(pixel.indexOf('if (refreshDrawingThumbnail(item)) saveManifest();') !== -1,
    'opening a drawing must heal its existing thumbnail');
assert.ok(pixel.indexOf('item.thumbnail = canvas.toDataURL') === -1,
    'thumbnails must not be captured from the editor canvas');
assert.ok(pixel.indexOf('<img src="${item.thumbnail}" class="gallery-preview">') !== -1,
    'gallery must render the stored thumbnail');

// Execute the thumbnail helpers against a fake canvas so the fixed size, white
// background and grid-only cell rendering are pinned, not just their names.
const helperStart = pixel.indexOf('function createGridImageDataUrl');
const helperEnd = pixel.indexOf('async function postToPixelChat', helperStart);
assert.ok(helperStart !== -1 && helperEnd > helperStart, 'pixel.html must keep the thumbnail helpers');
const canvases = [];
function makeCanvas() {
    const c2d = {
        fillStyle: '',
        fills: [],
        fillRect: function (x, y, w, h) {
            this.fills.push({ style: this.fillStyle, x: x, y: y, w: w, h: h });
        }
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: function () { return c2d; },
        toDataURL: function (type) {
            const payload = JSON.stringify({ w: canvas.width, h: canvas.height, fills: c2d.fills });
            return 'data:' + type + ';base64,' + Buffer.from(payload).toString('base64');
        }
    };
    canvases.push(canvas);
    return canvas;
}
const helperSandbox = {
    THUMBNAIL_SIZE: 64,
    document: {
        createElement: function (tag) {
            assert.strictEqual(tag, 'canvas', 'thumbnail helper must create a canvas');
            return makeCanvas();
        }
    }
};
vm.createContext(helperSandbox);
vm.runInContext(pixel.slice(helperStart, helperEnd), helperSandbox, { filename: 'pixel-thumbnail-helpers.js' });

const grid16 = [];
for (let r = 0; r < 16; r++) {
    const row = [];
    for (let c = 0; c < 16; c++) row.push(0);
    grid16.push(row);
}
grid16[8][8] = 1;
const thumbUrl = helperSandbox.createThumbnailDataUrl(grid16, 16);
const thumb = JSON.parse(Buffer.from(thumbUrl.split(',')[1], 'base64').toString('utf8'));
assert.strictEqual(thumb.w, 64, 'thumbnail canvas must be 64px wide');
assert.strictEqual(thumb.h, 64, 'thumbnail canvas must be 64px tall');
assert.ok(thumb.fills.length > 0, 'thumbnail must paint something');
assert.deepStrictEqual(thumb.fills[0], { style: 'white', x: 0, y: 0, w: 64, h: 64 },
    'thumbnail must start with an opaque white background');
const inkCells = thumb.fills.slice(1);
assert.strictEqual(inkCells.length, 1, 'one logical ink cell must produce exactly one thumbnail cell (no grid lines)');
assert.deepStrictEqual(inkCells[0], { style: 'black', x: 32, y: 32, w: 4, h: 4 },
    '16x16 grid cells must scale 4x into the 64px thumbnail');
const blankUrl = helperSandbox.createThumbnailDataUrl([], 0);
assert.ok(blankUrl.indexOf('data:image/png') === 0, 'missing grid must still return a PNG');

// The KindleChat post image still renders 1:1 from the logical grid.
const postUrl = helperSandbox.createPixelArtDataUrl(grid16, 16);
const post = JSON.parse(Buffer.from(postUrl.split(',')[1], 'base64').toString('utf8'));
assert.strictEqual(post.w, 16, 'post image must stay 16px for a 16x16 grid');
assert.strictEqual(post.h, 16, 'post image must stay 16px for a 16x16 grid');
assert.deepStrictEqual(post.fills.slice(1), [{ style: 'black', x: 8, y: 8, w: 1, h: 1 }],
    'post image must keep 1px logical cells');

console.log('PASS - pixel templates (' + templates.length + ' templates, ' + categories.size + ' categories)');
