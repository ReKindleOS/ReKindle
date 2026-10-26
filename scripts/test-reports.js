/**
 * Unit tests for report-comment validation.
 *
 * Run:  node scripts/test-reports.js
 *
 * Every social report must carry a comment with at least one real word. The
 * Worker is the authoritative gate (the client can be bypassed) and
 * js/reports.js mirrors it so the modal can show the message inline, so this
 * test checks both and asserts they agree.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');

(async () => {
    const { reportCommentError } = await import('../workers/rekindle-moderate/worker.js');
    assert.strictEqual(typeof reportCommentError, 'function', 'worker must export reportCommentError');

    /* ------------------------------------------------------------------ */
    /* 1. Comments that must be rejected                                  */
    /* ------------------------------------------------------------------ */
    const rejected = [
        '',
        '   ',
        '\n\t ',
        '!!!',
        '???',
        '....',
        '---',
        '12345',
        '0 1 2 3 4',
        ':)',
        ':) :( :|',
        '¯\\_(ツ)_/¯',
        '🙂🙂🙂',
        '😂 😂',
        '#$%^&*()',
        '• • •',
        'a',
        'x y z'
    ];

    for (const comment of rejected) {
        const message = reportCommentError(comment);
        assert.ok(message, 'comment should be rejected but passed: ' + JSON.stringify(comment));
        assert.ok(/word|comment/i.test(message), 'rejection should explain itself: ' + message);
    }

    /* ------------------------------------------------------------------ */
    /* 2. Comments that must be accepted                                  */
    /* ------------------------------------------------------------------ */
    const accepted = [
        'spam',
        'ok',
        'Spam',
        'no way',
        'harassment!!!',
        '123 abc',
        'spamming the same message over and over',
        'being rude to another user',
        'This user keeps posting the same link. spam spam spam.',
        'это спам',
        'これはスパムです',
        'esto es spam',
        '  padded word  '
    ];

    for (const comment of accepted) {
        assert.strictEqual(reportCommentError(comment), '', 'valid comment was rejected: ' + JSON.stringify(comment));
    }

    /* ------------------------------------------------------------------ */
    /* 3. Length ceiling                                                  */
    /* ------------------------------------------------------------------ */
    const justUnder = 'a'.repeat(498) + ' ok';          // 501 chars -> too long
    assert.ok(reportCommentError(justUnder), 'a 501-character comment must be rejected');

    const atLimit = 'a'.repeat(500);                     // 500 chars -> allowed
    assert.strictEqual(reportCommentError(atLimit), '', 'a 500-character comment must pass');

    /* ------------------------------------------------------------------ */
    /* 4. Client mirror (js/reports.js) agrees with the Worker            */
    /* ------------------------------------------------------------------ */
    const sandbox = { window: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/reports.js'), 'utf8'), sandbox);
    const client = sandbox.window;

    assert.strictEqual(typeof client.rekindleReportCommentError, 'function', 'client must expose rekindleReportCommentError');
    assert.strictEqual(typeof client.rekindleReportCommentIsValid, 'function', 'client must expose rekindleReportCommentIsValid');

    const samples = rejected.concat(accepted);
    for (const comment of samples) {
        const workerMessage = reportCommentError(comment);
        const clientMessage = client.rekindleReportCommentError(comment);
        assert.strictEqual(clientMessage === '', workerMessage === '',
            'client/worker disagree on ' + JSON.stringify(comment) +
            ' (client: ' + JSON.stringify(clientMessage) + ', worker: ' + JSON.stringify(workerMessage) + ')');
        assert.strictEqual(client.rekindleReportCommentIsValid(comment), workerMessage === '',
            'rekindleReportCommentIsValid disagrees on ' + JSON.stringify(comment));
    }

    // The client caps its textarea at 200 characters, so anything that fits
    // there must never be rejected for length.
    assert.strictEqual(client.rekindleReportCommentError('word ' + 'x'.repeat(195)), '',
        'a client-length comment must pass the client gate');

    /* ------------------------------------------------------------------ */
    /* 5. The report handler actually calls the gate                      */
    /* ------------------------------------------------------------------ */
    const workerSource = fs.readFileSync(path.join(root, 'workers/rekindle-moderate/worker.js'), 'utf8');
    assert.ok(/const reportCommentProblem = reportCommentError\(comment\);/.test(workerSource),
        'the report handler must run reportCommentError() on the submitted comment');
    assert.ok(/error: reportCommentProblem/.test(workerSource),
        'a rejected report must return the comment error to the client');

    const clientSource = fs.readFileSync(path.join(root, 'js/reports.js'), 'utf8');
    assert.ok(/var commentProblem = reportCommentError\(comment\);/.test(clientSource),
        'the modal must validate the comment before submitting');
    assert.ok(/commentLabel\.textContent = 'Comment \*'/.test(clientSource),
        'the modal must mark the comment as required');

    /* ------------------------------------------------------------------ */
    /* 6. One report cannot delete content on its own (2026-10-26)         */
    /* ------------------------------------------------------------------ */
    // Repeat reports of a single user deleting other people's messages ended
    // the "1 report = instant removal" rule. Chat/comment/DM content now needs a
    // moderation hit or a second independent reporter, and the old
    // unconditional path must not come back.
    assert.ok(!/shouldDeleteImmediately/.test(workerSource),
        'the unconditional immediate-delete path must be gone from the Worker');
    assert.ok(/await moderateContent\(reportContentSnapshot, env\.OPENAI_API_KEY\)/.test(workerSource),
        'a single report must be confirmed by moderateContent() before deleting');
    assert.ok(/if \(!moderationChecked \|\| flagged\)/.test(workerSource),
        'a failed moderation call must fall back to the old delete behaviour');
    assert.ok(/Auto-deleted after 2 reports/.test(workerSource),
        'two independent reporters must still remove the content');
    assert.ok(/Held for review \(moderation found nothing\)/.test(workerSource),
        'a cleared report must be kept pending with a note, not deleted');
    assert.ok(/removed immediately when reported and moderation agrees/.test(clientSource),
        'the client warning must describe the moderation-confirmed rule');

    console.log('PASS - report comments');
    console.log('  rejected samples: ' + rejected.length);
    console.log('  accepted samples: ' + accepted.length);
    console.log('  client mirror agrees with the Worker on all ' + samples.length + ' samples');
})().catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
});
