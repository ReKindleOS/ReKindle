#!/usr/bin/env node

/**
 * Remove KindleChat pixel-art posts that are larger than the chat limit.
 *
 * The 2026-11-25 extension posted 256x256 art (21+ messages) before the worker
 * enforced 16x16 / 32x32. This script scans `kindlechat/art_index` (one read,
 * no message bodies) and flags pixel-art entries whose stored thumbnail PNG is
 * wider or taller than 32px, which is exactly what the chat renders. Flipbook
 * entries are skipped: their 256x256 canvas is a supported size.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/rekindle-socials-service-account.json
 *   node scripts/purge-oversized-chat-art.js                    # dry run, lists only
 *   node scripts/purge-oversized-chat-art.js --delete           # delete message + index
 *   node scripts/purge-oversized-chat-art.js --uid=<uid> [...]  # limit to one author
 *
 * Deletion is one multi-path update per batch (message, art_index entry and any
 * translation entries). It is safe to re-run: deleted keys simply disappear.
 */

const admin = require('firebase-admin');
const path = require('path');
const { pathToFileURL } = require('url');

const DATABASE_URL = 'https://rekindle-socials-default-rtdb.firebaseio.com';
const MAX_CHAT_PIXEL_SIZE = 32;
const BATCH_SIZE = 50;

const doDelete = process.argv.indexOf('--delete') !== -1;
const uidArg = process.argv.filter(function (a) { return a.indexOf('--uid=') === 0; })[0];
const uidFilter = uidArg ? uidArg.slice('--uid='.length) : '';

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: DATABASE_URL
});

const db = admin.database();

function dataUrlSize(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png;base64,') !== 0) return null;
    try {
        const head = Buffer.from(dataUrl.slice('data:image/png;base64,'.length, 'data:image/png;base64,'.length + 32), 'base64');
        if (head.length < 24 || head.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
        return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('Reading kindlechat/art_index...');
    const snap = await db.ref('kindlechat/art_index').once('value');
    const index = snap.val() || {};

    const offenders = [];
    let pixelCount = 0;
    let flipCount = 0;
    for (const key of Object.keys(index)) {
        const entry = index[key];
        if (!entry || !entry.type) continue;
        if (entry.type === 'flipbook') {
            flipCount++;
            continue;
        }
        if (entry.type !== 'pixel_art') continue;
        if (uidFilter && entry.uid !== uidFilter) continue;
        pixelCount++;
        const size = dataUrlSize(entry.thumbnail);
        if (size && (size.width > MAX_CHAT_PIXEL_SIZE || size.height > MAX_CHAT_PIXEL_SIZE)) {
            offenders.push({ key: key, uid: entry.uid || '', ts: entry.timestamp || 0, size: size });
        }
    }

    offenders.sort(function (a, b) { return a.ts - b.ts; });
    console.log('pixel art entries:', pixelCount, '(oversized:', offenders.length + ')', '| flipbooks skipped:', flipCount);
    for (const o of offenders) {
        console.log('  ' + o.key + '  uid=' + o.uid + '  ' + o.size.width + 'x' + o.size.height +
            '  ' + (o.ts ? new Date(o.ts).toISOString() : 'no timestamp'));
    }

    if (!offenders.length) return;
    if (!doDelete) {
        console.log('\nDry run. Re-run with --delete to remove the ' + offenders.length + ' listed post(s).');
        return;
    }

    // Translations are keyed by language, then message id.
    const langSnap = await db.ref('kindlechat/translations_by_lang').once('value');
    const langs = Object.keys(langSnap.val() || {});

    for (let i = 0; i < offenders.length; i += BATCH_SIZE) {
        const batch = offenders.slice(i, i + BATCH_SIZE);
        const updates = {};
        for (const o of batch) {
            updates['kindlechat/messages/' + o.key] = null;
            updates['kindlechat/art_index/' + o.key] = null;
            for (const lang of langs) updates['kindlechat/translations_by_lang/' + lang + '/' + o.key] = null;
        }
        await db.ref().update(updates);
        console.log('deleted', i + batch.length, 'of', offenders.length);
    }
    console.log('Done. Deleted ' + offenders.length + ' oversized pixel-art post(s).');
}

main().then(function () {
    process.exit(0);
}).catch(function (err) {
    console.error('FAILED:', err && err.message);
    process.exit(1);
});
