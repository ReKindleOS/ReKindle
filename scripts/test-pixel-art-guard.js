/*
 * Hermetic checks for the KindleChat pixel-art / flipbook guard.
 * Run: node scripts/test-pixel-art-guard.js
 *
 * Regression: a desktop extension ("Pixel Art Auto-Draw", used by
 * atomthefox / paxthefox on 2026-11-25) uploaded an image, rendered it at
 * 256x256 and POSTed it straight to the moderation worker. The worker only
 * rejected a grid of exactly 64, so 256 was stored and the chat displayed it
 * at 512 CSS pixels. The guard now accepts only square 16x16 / 32x32 grids,
 * rasterises the PNG itself, and keeps flipbook frames at the app's 256x256
 * canvas size.
 *
 * If this fails, check workers/rekindle-moderate/pixel-art-guard.mjs and the
 * kindlechat handler in workers/rekindle-moderate/worker.js.
 */
const assert = require('assert');
const zlib = require('zlib');
const path = require('path');
const { pathToFileURL } = require('url');

function buildGrid(size, valueFn) {
    const grid = [];
    for (let r = 0; r < size; r++) {
        const row = [];
        for (let c = 0; c < size; c++) row.push(valueFn ? valueFn(r, c) : 0);
        grid.push(row);
    }
    return grid;
}

function parsePng(dataUrl) {
    assert.ok(dataUrl.indexOf('data:image/png;base64,') === 0, 'PNG data URL prefix');
    const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    assert.strictEqual(bytes.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
    let offset = 8;
    const chunks = [];
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const data = bytes.slice(offset + 8, offset + 8 + length);
        chunks.push({ type: type, data: data });
        offset += 12 + length;
    }
    const ihdr = chunks.find(function (c) { return c.type === 'IHDR'; });
    assert.ok(ihdr, 'IHDR present');
    const width = ihdr.data.readUInt32BE(0);
    const height = ihdr.data.readUInt32BE(4);
    const idat = Buffer.concat(chunks.filter(function (c) { return c.type === 'IDAT'; }).map(function (c) { return c.data; }));
    const raw = zlib.inflateSync(idat);
    return {
        width: width,
        height: height,
        bitDepth: ihdr.data[8],
        colourType: ihdr.data[9],
        raw: raw,
        bytes: bytes
    };
}

(async function () {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'workers', 'rekindle-moderate', 'pixel-art-guard.mjs')).href);
    const { parsePixelGrid, isBlankGrid, renderPixelGridPng, pngDataUrlSize, validateFlipnote } = mod;

    /* ---------- 1. Legit grids are accepted ---------- */
    const grid16 = buildGrid(16, function (r, c) { return (r + c) % 3 === 0 ? 1 : 0; });
    let parsed = parsePixelGrid(JSON.stringify(grid16));
    assert.strictEqual(parsed.ok, true, '16x16 grid must be accepted');
    assert.strictEqual(parsed.size, 16);
    assert.strictEqual(isBlankGrid(parsed.grid), false, 'drawn grid is not blank');

    const grid32 = buildGrid(32, function (r, c) { return (r * 31 + c) % 100 === 0 ? 1 : 0; });
    parsed = parsePixelGrid(JSON.stringify(grid32));
    assert.strictEqual(parsed.ok, true, '32x32 grid must be accepted');
    assert.strictEqual(parsed.size, 32);

    const blank = parsePixelGrid(JSON.stringify(buildGrid(32)));
    assert.strictEqual(blank.ok, true, 'blank grid parses');
    assert.strictEqual(isBlankGrid(blank.grid), true, 'blank grid is detected');

    /* ---------- 2. Higher-resolution / malformed grids are rejected ---------- */
    let r = parsePixelGrid(JSON.stringify(buildGrid(64, function () { return 0; })));
    assert.strictEqual(r.ok, false, '64x64 must be rejected');
    assert.ok(/16x16 or 32x32/.test(r.error), '64x64 error names the allowed sizes: ' + r.error);

    r = parsePixelGrid(JSON.stringify(buildGrid(256, function () { return 0; })));
    assert.strictEqual(r.ok, false, '256x256 must be rejected');

    // Rows must be square: a 32-row grid with 64 columns is not 32x32.
    const wide = buildGrid(32, function () { return 0; });
    for (const row of wide) row.push(0);
    r = parsePixelGrid(JSON.stringify(wide));
    assert.strictEqual(r.ok, false, 'non-square rows must be rejected');

    const ragged = buildGrid(32, function () { return 0; });
    ragged[5].pop();
    r = parsePixelGrid(JSON.stringify(ragged));
    assert.strictEqual(r.ok, false, 'ragged rows must be rejected');

    r = parsePixelGrid('not json');
    assert.strictEqual(r.ok, false, 'invalid JSON must be rejected');
    r = parsePixelGrid(null);
    assert.strictEqual(r.ok, false, 'missing grid must be rejected');
    r = parsePixelGrid(JSON.stringify({ rows: 32 }));
    assert.strictEqual(r.ok, false, 'non-array JSON must be rejected');

    const strings = buildGrid(16);
    strings[0][0] = '1';
    r = parsePixelGrid(JSON.stringify(strings));
    assert.strictEqual(r.ok, false, 'string cell must be rejected');

    const outOfRange = buildGrid(16);
    outOfRange[0][0] = 2;
    r = parsePixelGrid(JSON.stringify(outOfRange));
    assert.strictEqual(r.ok, false, 'cell > 1 must be rejected');

    const negative = buildGrid(16);
    negative[0][0] = -0.1;
    r = parsePixelGrid(JSON.stringify(negative));
    assert.strictEqual(r.ok, false, 'negative cell must be rejected');

    // Padding a valid grid past the JSON cap is rejected before parsing.
    const padded = JSON.stringify(buildGrid(16)) + ' '.repeat(40000);
    r = parsePixelGrid(padded);
    assert.strictEqual(r.ok, false, 'oversized grid JSON must be rejected');

    /* ---------- 3. The stored PNG is generated from the grid, at 1:1 ---------- */
    const shades = buildGrid(32, function (r, c) {
        if (r === 0 && c === 0) return 1; // black
        if (r === 0 && c === 1) return 0.5; // mid grey
        return 0; // white
    });
    const url = renderPixelGridPng(shades, 32);
    const png = parsePng(url);
    assert.strictEqual(png.width, 32, 'PNG width equals grid size');
    assert.strictEqual(png.height, 32, 'PNG height equals grid size');
    assert.strictEqual(png.bitDepth, 8, '8-bit greyscale');
    assert.strictEqual(png.colourType, 0, 'greyscale colour type');
    assert.strictEqual(png.raw.length, 32 * 33, 'filter byte + 32 pixels per row');
    assert.strictEqual(png.raw[0], 0, 'filter type none');
    assert.strictEqual(png.raw[1], 0, 'value 1 renders black');
    assert.strictEqual(png.raw[2], 128, '0.5 renders mid grey');
    assert.strictEqual(png.raw[3], 255, '0 renders white');
    assert.deepStrictEqual(pngDataUrlSize(url), { width: 32, height: 32 }, 'pngDataUrlSize reads IHDR');
    assert.ok(url.length < 8000, '32x32 PNG stays small, actual ' + url.length);

    const url16 = renderPixelGridPng(grid16, 16);
    assert.deepStrictEqual(pngDataUrlSize(url16), { width: 16, height: 16 });
    assert.strictEqual(parsePng(url16).raw.length, 16 * 17);

    assert.deepStrictEqual(pngDataUrlSize('https://example.com/x.png'), null, 'non-data URL is not a PNG');
    assert.deepStrictEqual(pngDataUrlSize('data:image/jpeg;base64,/9j/4AAQ'), null, 'JPEG data URL is not a PNG');
    assert.deepStrictEqual(pngDataUrlSize('data:image/png;base64,AAAA'), null, 'too-short PNG is rejected');

    /* ---------- 4. Flipbooks: 256x256 frames only, bounded count/size ---------- */
    const frame256 = renderPixelGridPng(buildGrid(256, function () { return 0; }), 256);
    assert.deepStrictEqual(pngDataUrlSize(frame256), { width: 256, height: 256 });

    let flip = validateFlipnote({ fps: 6, frames: [frame256, frame256] });
    assert.strictEqual(flip.ok, true, 'valid 256x256 flipbook accepted');
    assert.strictEqual(flip.data.frames.length, 2);
    assert.strictEqual(flip.data.fps, 6);

    flip = validateFlipnote({ fps: 999, frames: [frame256] });
    assert.strictEqual(flip.ok, true, 'out-of-range fps is clamped to a default');
    assert.strictEqual(flip.data.fps, 6);

    flip = validateFlipnote({ frames: [url] });
    assert.strictEqual(flip.ok, false, '32x32 frame rejected');
    assert.ok(/256x256/.test(flip.error), 'frame error names the canvas size: ' + flip.error);

    flip = validateFlipnote({ frames: ['data:image/jpeg;base64,/9j/4AAQ'] });
    assert.strictEqual(flip.ok, false, 'JPEG frame rejected');

    flip = validateFlipnote({ frames: [] });
    assert.strictEqual(flip.ok, false, 'empty frame list rejected');

    flip = validateFlipnote({ frames: new Array(241).fill(frame256) });
    assert.strictEqual(flip.ok, false, 'more than 240 frames rejected');

    flip = validateFlipnote(null);
    assert.strictEqual(flip.ok, false, 'missing flipbook data rejected');

    console.log('PASS test-pixel-art-guard');
})().catch(function (err) {
    console.error('FAIL test-pixel-art-guard:', err && err.message);
    process.exit(1);
});
