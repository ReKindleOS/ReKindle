/*
 * Server-side guard for KindleChat pixel art / flipbook posts.
 * ---------------------------------------------------------------------------
 * The chat used to trust the client for everything about an art post:
 * `is_pixel_art`, `grid_data` and `pixel_art` were copied into the message
 * verbatim, and the only size check was `gridSize === 64`. An unpacked
 * desktop extension ("Pixel Art Auto-Draw", used by atomthefox / paxthefox on
 * 2026-11-25) uploaded an image, rendered it at 256x256 and POSTed it straight
 * to the moderation worker, bypassing pixel.html's 16/32/64 grid picker. The
 * worker accepted it because 256 !== 64, and the chat rendered the PNG at
 * 512 CSS pixels (message -P7J0AGeY66GIVppy-E5: "256x256 is OUT CHAT WOO").
 *
 * Two rules now hold for every new art post:
 *
 *   1. A pixel-art post in chat must carry a SQUARE 16x16 or 32x32 grid of
 *      numbers in [0, 1]. Nothing larger is accepted (64x64 was already
 *      rejected; there is no chat use for it).
 *   2. The stored PNG is no longer the client's image. It is rasterised here
 *      from the validated grid, so a caller cannot attach a high-resolution
 *      image, a non-PNG data URL, or an image whose pixels differ from the
 *      grid. `pixel_art` is therefore ignored on input.
 *
 * Flipbooks legitimately use a 256x256 canvas (flipbook.html CANVAS_SIZE), so
 * their frames are only shape-checked: PNG data URLs, 256x256, bounded frame
 * count and payload size. That stops a flipbook being used as a container for
 * an arbitrary large image while leaving real animations untouched.
 *
 * Keep scripts/test-pixel-art-guard.js in sync when editing this module.
 */

export const CHAT_PIXEL_GRID_SIZES = [16, 32];
export const FLIPBOOK_CANVAS_SIZE = 256;
export const MAX_GRID_JSON_CHARS = 16384; // keep <= rtdb-social-rules.json grid_data cap
export const MAX_FLIP_FRAMES = 240;
export const MAX_FLIP_FRAME_CHARS = 400000; // ~300 KB decoded
export const MAX_FLIP_TOTAL_CHARS = 6000000; // ~4.5 MB decoded

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ------------------------------------------------------------------ */
/*  GRID VALIDATION                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse and validate chat pixel-art grid data.
 *
 * @param {*} gridData JSON string from the client (`JSON.stringify(grid)`).
 * @returns {{ok: true, grid: number[][], size: number} | {ok: false, error: string}}
 */
export function parsePixelGrid(gridData) {
    if (typeof gridData !== "string") {
        return { ok: false, error: "Pixel art data is missing." };
    }
    if (gridData.length > MAX_GRID_JSON_CHARS) {
        return { ok: false, error: "Pixel art data is too large." };
    }

    let grid;
    try {
        grid = JSON.parse(gridData);
    } catch (e) {
        return { ok: false, error: "Pixel art data is invalid." };
    }

    if (!Array.isArray(grid)) {
        return { ok: false, error: "Pixel art data is invalid." };
    }
    const size = grid.length;
    if (CHAT_PIXEL_GRID_SIZES.indexOf(size) === -1) {
        return { ok: false, error: "Pixel art in chat must be 16x16 or 32x32." };
    }

    for (let r = 0; r < size; r++) {
        const row = grid[r];
        if (!Array.isArray(row) || row.length !== size) {
            return { ok: false, error: "Pixel art in chat must be 16x16 or 32x32." };
        }
        for (let c = 0; c < size; c++) {
            const value = row[c];
            if (typeof value !== "number" || !isFinite(value) || value < 0 || value > 1) {
                return { ok: false, error: "Pixel art data is invalid." };
            }
        }
    }

    return { ok: true, grid: grid, size: size };
}

/** True when every cell is 0 (the app already blocks posting blank art). */
export function isBlankGrid(grid) {
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        for (let c = 0; c < row.length; c++) {
            if (row[c] !== 0) return false;
        }
    }
    return true;
}

/* ------------------------------------------------------------------ */
/*  SERVER-SIDE PNG RASTERISER                                         */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < bytes.length; i++) {
        a = (a + bytes[i]) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

/** zlib stream using stored (uncompressed) deflate blocks - no deps needed. */
function zlibStore(data) {
    const blockCount = Math.max(1, Math.ceil(data.length / 65535));
    const out = new Uint8Array(2 + data.length + blockCount * 5 + 4);
    out[0] = 0x78; // CMF: deflate, 32K window
    out[1] = 0x01; // FLG: no dict, fastest; (0x7801 % 31 === 0)
    let p = 2;
    for (let i = 0; i < blockCount; i++) {
        const start = i * 65535;
        const len = Math.min(65535, data.length - start);
        const final = i === blockCount - 1 ? 1 : 0;
        out[p++] = final; // BFINAL + BTYPE=00 (stored)
        out[p++] = len & 0xff;
        out[p++] = (len >>> 8) & 0xff;
        out[p++] = (~len) & 0xff;
        out[p++] = ((~len) >>> 8) & 0xff;
        out.set(data.subarray(start, start + len), p);
        p += len;
    }
    const adler = adler32(data);
    out[p++] = (adler >>> 24) & 0xff;
    out[p++] = (adler >>> 16) & 0xff;
    out[p++] = (adler >>> 8) & 0xff;
    out[p++] = adler & 0xff;
    return out;
}

function pngChunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes, 0);
    body.set(data, typeBytes.length);
    const out = new Uint8Array(4 + body.length + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(4 + body.length, crc32(body));
    return out;
}

function bytesToBase64(bytes) {
    if (typeof btoa === "function") {
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    throw new Error("No base64 encoder available");
}

/**
 * Rasterise a validated grid to a grayscale PNG data URL at 1:1 resolution.
 * Matches pixel.html's createGridImageDataUrl(): 0 = white, 1 = black,
 * 0 < v < 1 = the same grey the editor uses.
 *
 * @param {number[][]} grid
 * @param {number} size
 * @returns {string} `data:image/png;base64,...`
 */
export function renderPixelGridPng(grid, size) {
    const rowBytes = size + 1; // filter byte + pixels
    const raw = new Uint8Array(size * rowBytes);
    for (let r = 0; r < size; r++) {
        const row = grid[r];
        const offset = r * rowBytes;
        raw[offset] = 0; // filter: none
        for (let c = 0; c < size; c++) {
            const value = row[c];
            const gray = value === 1 ? 0 : Math.max(0, Math.min(255, Math.round((1 - value) * 255)));
            raw[offset + 1 + c] = gray;
        }
    }

    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, size);
    view.setUint32(4, size);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 0; // colour type: greyscale
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const signature = new Uint8Array(PNG_SIGNATURE);
    const idat = zlibStore(raw);
    const chunks = [
        signature,
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", idat),
        pngChunk("IEND", new Uint8Array(0))
    ];
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const png = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
    }
    return PNG_DATA_URL_PREFIX + bytesToBase64(png);
}

/* ------------------------------------------------------------------ */
/*  FLIPBOOK VALIDATION                                                */
/* ------------------------------------------------------------------ */

function decodeBase64Prefix(base64, chars) {
    const slice = base64.slice(0, chars);
    // 32 base64 chars decode to 24 bytes: enough for the IHDR width/height.
    if (slice.length < chars) return null;
    try {
        const binary = atob(slice);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch (e) {
        return null;
    }
}

/**
 * Read width/height from a PNG data URL without decoding the whole image.
 * @returns {{width: number, height: number} | null}
 */
export function pngDataUrlSize(dataUrl) {
    if (typeof dataUrl !== "string" || dataUrl.indexOf(PNG_DATA_URL_PREFIX) !== 0) return null;
    const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
    const head = decodeBase64Prefix(base64, 32);
    if (!head || head.length < 24) return null;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (head[i] !== PNG_SIGNATURE[i]) return null;
    }
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Validate a flipbook payload. Frames must be 256x256 PNG data URLs (the
 * flipbook canvas size), so the same request cannot smuggle a 1024px image.
 *
 * @param {*} flipnoteData
 * @returns {{ok: true, data: {fps: number, frames: string[]}} | {ok: false, error: string}}
 */
export function validateFlipnote(flipnoteData) {
    if (!flipnoteData || typeof flipnoteData !== "object" || Array.isArray(flipnoteData)) {
        return { ok: false, error: "Flipbook data is invalid." };
    }

    const rawFps = Number(flipnoteData.fps);
    const fps = isFinite(rawFps) && rawFps >= 1 && rawFps <= 30 ? rawFps : 6;

    const frames = flipnoteData.frames;
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_FLIP_FRAMES) {
        return { ok: false, error: "Flipbook data is invalid." };
    }

    let totalChars = 0;
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (typeof frame !== "string" || frame.length > MAX_FLIP_FRAME_CHARS) {
            return { ok: false, error: "Flipbook data is invalid." };
        }
        totalChars += frame.length;
        if (totalChars > MAX_FLIP_TOTAL_CHARS) {
            return { ok: false, error: "Flipbook is too large to post." };
        }
        const size = pngDataUrlSize(frame);
        if (!size || size.width !== FLIPBOOK_CANVAS_SIZE || size.height !== FLIPBOOK_CANVAS_SIZE) {
            return { ok: false, error: "Flipbook frames must be 256x256." };
        }
    }

    return { ok: true, data: { fps: fps, frames: frames.slice() } };
}
