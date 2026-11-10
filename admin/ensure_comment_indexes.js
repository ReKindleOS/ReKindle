/*
 * Ensure the social Firestore `comments` collection group has the
 * single-field indexes used by the archive/admin tooling (formerly also by
 * `deleteAccount`; account deletion no longer touches the social project).
 *
 * Usage:
 *   firebase login                 # once, so the CLI token below is fresh
 *   node admin/ensure_comment_indexes.js              # dry run
 *   node admin/ensure_comment_indexes.js --apply      # create the indexes
 *
 * Why this exists: Firestore creates single-field indexes in COLLECTION scope
 * automatically, but a collection-group query (`collectionGroup('comments')`)
 * needs a COLLECTION_GROUP-scope index. The historical account-deletion sweep
 * used such a query; without the index it fell back to one comments query per
 * topic/post and timed out (2026-11-08). Account deletion no longer touches the
 * social project, but the index is still kept for admin/archive queries and
 * any future retention tooling.
 *
 * The Firebase CLI does not expose single-field index creation
 * (`firebase firestore:indexes` only lists composite indexes), so this script
 * calls the Firestore Admin REST API with the CLI's current access token.
 * It never prints the token.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const PROJECT = 'rekindle-socials';
const FIELDS = ['authorId', 'uid'];
const COLLECTION = 'comments';

function readToken() {
    const candidates = [
        path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
        path.join(os.homedir(), 'Library', 'Preferences', 'configstore', 'firebase-tools.json')
    ];
    for (let i = 0; i < candidates.length; i++) {
        try {
            const raw = fs.readFileSync(candidates[i], 'utf8');
            const parsed = JSON.parse(raw);
            const token = parsed && parsed.tokens && parsed.tokens.access_token;
            if (token) return token;
        } catch (e) { /* try the next location */ }
    }
    return null;
}

async function request(token, url, options) {
    const res = await fetch(url, Object.assign({
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    }, options || {}));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    return { status: res.status, data: data };
}

function fieldUrl(field) {
    return 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
        '/databases/(default)/collectionGroups/' + COLLECTION + '/fields/' + field;
}

(async function main() {
    const token = readToken();
    if (!token) {
        console.error('No Firebase CLI access token found. Run `firebase login` (or any firebase command) first.');
        process.exit(1);
    }

    for (let i = 0; i < FIELDS.length; i++) {
        const field = FIELDS[i];
        const url = fieldUrl(field);
        const current = await request(token, url);
        if (current.status !== 200) {
            console.log('SKIP ' + field + ': cannot read index config (HTTP ' + current.status + ')');
            continue;
        }
        const indexes = (current.data.indexConfig && current.data.indexConfig.indexes) || [];
        const hasCollectionGroup = indexes.some(function (index) {
            return index.queryScope === 'COLLECTION_GROUP';
        });
        if (hasCollectionGroup) {
            const state = indexes.filter(function (index) {
                return index.queryScope === 'COLLECTION_GROUP';
            }).map(function (index) { return index.state || 'UNKNOWN'; }).join(',');
            console.log('OK   ' + COLLECTION + '.' + field + ' has COLLECTION_GROUP (' + state + ')');
            continue;
        }

        console.log((APPLY ? 'CREATE ' : 'WOULD CREATE ') + COLLECTION + '.' + field + ' COLLECTION_GROUP ASCENDING');
        if (!APPLY) continue;

        const body = {
            name: current.data.name,
            indexConfig: {
                indexes: indexes.concat([{
                    queryScope: 'COLLECTION_GROUP',
                    fields: [{ fieldPath: field, order: 'ASCENDING' }]
                }])
            }
        };
        const patched = await request(token, url + '?updateMask=indexConfig', {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
        if (patched.status !== 200) {
            console.error('FAILED ' + field + ': HTTP ' + patched.status + ' ' + JSON.stringify(patched.data));
            process.exitCode = 1;
            continue;
        }
        const updated = (patched.data.indexConfig && patched.data.indexConfig.indexes) || [];
        const cg = updated.filter(function (index) {
            return index.queryScope === 'COLLECTION_GROUP';
        }).map(function (index) { return index.state || 'UNKNOWN'; }).join(',');
        console.log('REQUESTED ' + COLLECTION + '.' + field + ' (' + cg + '); Firestore may take a few minutes.');
    }

    if (!APPLY) console.log('\nDry run: re-run with --apply to create missing indexes.');
    console.log('Verify with: node admin/ensure_comment_indexes.js');
})().catch(function (err) {
    console.error('Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
