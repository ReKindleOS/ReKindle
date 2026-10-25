/*
 * Direct-message unit + wiring checks.
 *
 * Run: node scripts/test-dm.js
 *
 * Covers the security-critical pure helpers exported by the moderation
 * worker, plus static assertions that keep DM data in the SOCIAL project and
 * keep client writes out of DM content.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

(async () => {
    const {
        dmThreadId,
        parseDmMessagePath,
        dmFlagKeyForOrigin,
        isValidDmText,
        dmStatusAfterUnblock
    } = await import('../workers/rekindle-moderate/worker.js');

    /* ------------------------------------------------------------------ */
    /* Thread IDs                                                          */
    /* ------------------------------------------------------------------ */
    const a = 'A'.repeat(28);
    const b = 'B'.repeat(28);

    assert.strictEqual(dmThreadId(a, b), dmThreadId(b, a), 'thread id must be order-independent');
    assert.strictEqual(dmThreadId(a, b), 'dm_' + [a, b].sort().join('_'));
    assert.strictEqual(dmThreadId(a, a), '', 'self threads are invalid');
    assert.strictEqual(dmThreadId('', b), '', 'empty uids are invalid');
    assert.strictEqual(dmThreadId('bad uid!', b), '', 'non-alphanumeric uids are invalid');
    assert.strictEqual(dmThreadId('short', b), '', 'too-short uids are invalid');

    /* ------------------------------------------------------------------ */
    /* Report path parsing (auto-delete must never leave the DM subtree)   */
    /* ------------------------------------------------------------------ */
    const goodPath = 'kindlechat/dm_messages/' + dmThreadId(a, b) + '/-Nabc_123';
    const parsed = parseDmMessagePath(goodPath);
    assert.deepStrictEqual(parsed, {
        threadId: dmThreadId(a, b),
        messageId: '-Nabc_123'
    });

    [
        '',
        'kindlechat/messages/xyz',
        'kindlechat/dm_messages/' + dmThreadId(a, b),
        'kindlechat/dm_messages/' + dmThreadId(a, b) + '/x/extra',
        'kindlechat/dm_messages/../../users/x',
        'kindlechat/dm_messages/dm_bad/x',
        'kindlechat/dm_messages/' + dmThreadId(a, b) + '/has space'
    ].forEach(function (bad) {
        assert.strictEqual(parseDmMessagePath(bad), null, 'must reject path: ' + bad);
    });

    /* ------------------------------------------------------------------ */
    /* Flags / text validation                                             */
    /* ------------------------------------------------------------------ */
    assert.strictEqual(dmFlagKeyForOrigin('https://beta.rekindle.ink'), 'dm_beta_enabled');
    assert.strictEqual(dmFlagKeyForOrigin('https://rekindle.ink'), 'dm_enabled');
    assert.strictEqual(dmFlagKeyForOrigin(null), 'dm_enabled');

    assert.strictEqual(isValidDmText('hello', 1000), true);
    assert.strictEqual(isValidDmText('   ', 1000), false);
    assert.strictEqual(isValidDmText('x'.repeat(1001), 1000), false);
    assert.strictEqual(isValidDmText(123, 1000), false);

    /* ------------------------------------------------------------------ */
    /* Unblock restores the status the block replaced                      */
    /* ------------------------------------------------------------------ */
    // A block overwrites status, so blockedFromStatus is the only way to put
    // an accepted conversation back without a second acceptance gate. These
    // cases pin the restore rules (and the legacy-thread fallback).
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', blockedFromStatus: 'accepted' }), 'accepted');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', blockedFromStatus: 'pending' }), 'pending',
        'a blocked request must return to pending, never straight to accepted');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', blockedFromStatus: 'declined' }), 'declined',
        'unblocking must not resurrect a declined request');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', acceptedAt: 1 }), 'accepted',
        'legacy accepted block falls back on acceptedAt');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', declinedAt: 1 }), 'declined',
        'legacy declined block falls back on declinedAt');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked' }), 'pending',
        'legacy pending block falls back on pending');
    assert.strictEqual(dmStatusAfterUnblock({ status: 'blocked', blockedFromStatus: 'nonsense', acceptedAt: 1 }), 'accepted',
        'an unknown blockedFromStatus must fall back on the timestamps');
    assert.strictEqual(dmStatusAfterUnblock(null), 'pending');

    /* ------------------------------------------------------------------ */
    /* Rules: no client writes to DM content, participant-only reads       */
    /* ------------------------------------------------------------------ */
    const rules = JSON.parse(fs.readFileSync(path.join(root, 'rtdb-social-rules.json'), 'utf8')).rules;
    const kc = rules.kindlechat;
    const SA = '@rekindle-socials\\.iam\\.gserviceaccount\\.com';

    assert.ok(kc.config && kc.config['.read'].includes('auth != null'), 'DM flags must be readable by signed-in clients');
    assert.ok(kc.config['.write'].includes(SA), 'DM flags must be service-account writable only');

    assert.ok(kc.dm_threads, 'dm_threads rules missing');
    const threadRule = kc.dm_threads.$threadId;
    assert.ok(threadRule['.read'].includes('participants'), 'thread reads must require thread membership');
    assert.ok(threadRule['.read'].includes('auth.uid'), 'thread reads must check auth.uid');
    assert.ok(!/\bauth\s*!=\s*null\s*$/.test(threadRule['.write']), 'thread writes must not be open to any signed-in user');
    assert.ok(threadRule['.write'].includes(SA), 'thread writes must be service-account only');

    assert.ok(kc.dm_messages, 'dm_messages rules missing');
    const messageRoot = kc.dm_messages.$threadId;
    assert.ok(messageRoot['.read'].includes('participants'), 'message reads must require thread membership');
    assert.ok(messageRoot['.write'].includes(SA), 'message writes must be service-account only');
    const messageRule = messageRoot.$messageId;
    assert.ok(!messageRule['.write'].includes('auth != null'), 'clients must never write DM messages directly');
    assert.ok(messageRule['.write'].includes(SA), 'DM message writes must be service-account only');
    assert.ok(messageRule['.validate'].includes('<= 1000'), 'DM messages must be capped at 1000 chars');

    assert.ok(kc.dm_user_threads.$uid['.read'].includes('auth.uid === $uid'), 'inbox reads must be owner-only');
    assert.ok(kc.dm_user_threads.$uid.$threadId.lastReadAt['.write'].includes('auth.uid === $uid'), 'only the owner may write their read marker');
    assert.ok(kc.dm_user_threads.$uid.$threadId.lastReadAt['.write'].includes('dm_threads'), 'read markers may only be written for a thread the user belongs to');
    assert.ok(kc.dm_prefs.$uid.allowRequests['.write'].includes('auth.uid === $uid'), 'only the owner may change their request preference');
    assert.ok(kc.dm_blocks.$uid['.read'].includes('auth.uid === $uid'), 'block lists must be owner-readable only');
    assert.ok(kc.dm_blocks.$uid['.write'].includes(SA), 'block writes must be service-account only');

    // The unsafe legacy Firestore DM collection must never come back.
    const firestoreSocial = fs.readFileSync(path.join(root, 'firestore-social.rules'), 'utf8');
    assert.ok(!/match\s+\/rooms\b/.test(firestoreSocial), 'legacy /rooms rules must not return to firestore-social.rules');

    /* ------------------------------------------------------------------ */
    /* Wiring: client reads/writes only socialRtdb, worker writes social    */
    /* ------------------------------------------------------------------ */
    const chat = fs.readFileSync(path.join(root, 'kindlechat.html'), 'utf8');
    assert.ok(chat.includes("socialRtdb.ref(DM_MESSAGES_PATH"), 'client must read DM messages from socialRtdb');
    assert.ok(chat.includes("socialRtdb.ref(DM_USER_THREADS_PATH"), 'client must read the DM inbox from socialRtdb');
    assert.ok(chat.includes("socialRtdb.ref(DM_PREFS_PATH"), 'client must write DM prefs to socialRtdb');
    assert.ok(!/rtdb\.ref\(['"]kindlechat\/dm_/.test(chat), 'client must never use the primary rtdb for DM paths');

    const worker = fs.readFileSync(path.join(root, 'workers/rekindle-moderate/worker.js'), 'utf8');
    assert.ok(worker.includes('const DM_THREADS_PATH = "kindlechat/dm_threads"'), 'worker DM paths missing');
    assert.ok(worker.includes('kindlechat/dm_messages/${parsed.threadId}/${parsed.messageId}'), 'DM auto-delete must use the social RTDB helper path');
    assert.ok(!/dm_message[\s\S]{0,400}rtdbDeletePrimaryWithAccessToken/.test(worker), 'DM deletion must never target the primary RTDB');

    /* ------------------------------------------------------------------ */
    /* Unblock wiring: blocker-only, block record removed, rows refreshed  */
    /* ------------------------------------------------------------------ */
    assert.ok(worker.includes('type === "dm_unblock"'), 'worker must handle dm_unblock');
    assert.ok(worker.includes('thread.blockedBy !== uid'), 'only the person who blocked may unblock');
    assert.ok(worker.includes('rtdbDeleteWithAccessToken(`${DM_BLOCKS_PATH}/${uid}/${other}`'),
        'unblock must delete the caller\'s dm_blocks entry');
    assert.ok(worker.includes('updated.blockedFromStatus = thread.status'),
        'dm_block must record the status it replaced');
    assert.ok(worker.includes('"dm_unblock"]'), 'dm_unblock must be exempt from the timeout check');
    assert.ok(worker.includes('writeDmStatusToIndexRows(uid, other, threadId, restored'),
        'unblock must refresh both inbox rows');
    assert.ok(worker.includes('restored.blockedBy = other'),
        'a block-back by the other participant must keep the thread closed');

    assert.ok(chat.includes("dmAction('unblock')"), 'client must offer the unblock action');
    assert.ok(chat.includes('dmHeaderBlockAction'), 'the header button must block and unblock');
    assert.ok(chat.includes("kindlechat.dm.confirm_unblock"), 'unblock must be confirmed first');
    assert.ok(chat.includes("actions.appendChild(makeDmBannerButton(dmT('kindlechat.dm.unblock'"),
        'the blocked banner must offer Unblock to the blocker');

    const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
    assert.ok(en['kindlechat.dm.unblock'], 'locales/en.json is missing kindlechat.dm.unblock');
    assert.ok(en['kindlechat.dm.confirm_unblock'], 'locales/en.json is missing kindlechat.dm.confirm_unblock');

    console.log('PASS - direct message helpers, rules and social-RTDB wiring');
})().catch(function (err) {
    console.error('FAIL - direct message checks');
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
