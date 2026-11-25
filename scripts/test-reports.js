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

    /* ------------------------------------------------------------------ */
    /* 7. Reported content is resolved server-side (2026-11-24)            */
    /* ------------------------------------------------------------------ */
    // The client used to supply contentSnapshot, so any signed-in user could
    // forge a slur in a report and have the Worker auto-delete someone else's
    // real message. Only dm_message was fetched server-side; every type now is.
    assert.ok(/resolveReportedContent\(contentType, contentPath, contentId, env, accessToken\)/.test(workerSource),
        'non-DM reports must resolve their content server-side');
    assert.ok(/reportContentSnapshot = resolved\.text\.substring\(0, 2000\)/.test(workerSource),
        'the moderation snapshot must come from the server-side lookup');
    assert.ok(/reportContentResolved = resolved\.resolved/.test(workerSource),
        'the Worker must track whether the content could be resolved');
    assert.ok(!/let reportContentSnapshot = \(contentSnapshot \|\| ""\)/.test(workerSource),
        'the client-supplied report snapshot must no longer be trusted');
    assert.ok(/else if \(!reportContentResolved\)/.test(workerSource),
        'an unresolvable report must be held, not auto-deleted');

    /* ------------------------------------------------------------------ */
    /* 8. Signed-in reporters are found even when the page block-scopes    */
    /*    auth (2026-11-26)                                               */
    /* ------------------------------------------------------------------ */
    // suggestions.html wraps its whole bootstrap in try/catch, so its
    // `const auth` / `let currentUser` are block-scoped and invisible here.
    // A signed-in user got "You must be signed in to submit a report."
    const suggestionsSource = fs.readFileSync(path.join(root, 'suggestions.html'), 'utf8');
    assert.ok(/window\.currentUser = user;/.test(suggestionsSource),
        'suggestions.html must mirror the signed-in user on window');
    assert.ok(/window\.currentUser = null;/.test(suggestionsSource),
        'suggestions.html must clear the mirrored user on sign-out');

    // Drive the real modal in a tiny fake DOM. No `currentUser` or `auth`
    // global is defined, exactly like suggestions.html from reports.js's
    // point of view; only `window.firebase` can supply the reporter.
    function makeFakeDocument() {
        function makeNode(tag) {
            return {
                tagName: tag,
                id: '',
                className: '',
                style: {},
                children: [],
                parentNode: null,
                appendChild: function (child) {
                    child.parentNode = this;
                    this.children.push(child);
                    return child;
                },
                setAttribute: function (key, value) { this[key] = value; },
                removeAttribute: function (key) { delete this[key]; }
            };
        }
        var doc = {
            body: makeNode('body'),
            createElement: makeNode,
            querySelector: function () { return null; },
            getElementById: function (id) {
                var found = null;
                function walk(node) {
                    if (node.id === id) { found = node; return true; }
                    for (var i = 0; i < node.children.length; i++) {
                        if (walk(node.children[i])) return true;
                    }
                    return false;
                }
                walk(doc.body);
                return found;
            }
        };
        return doc;
    }

    async function submitViaModal(user) {
        var doc = makeFakeDocument();
        var fetchCalls = [];
        var sandbox = {
            // The signed-out case logs its expected failure; keep the test
            // output clean.
            console: { log: console.log, warn: console.warn, error: function () { } },
            document: doc,
            setTimeout: setTimeout,
            fetch: function (url, init) {
                fetchCalls.push({ url: url, init: init });
                return Promise.resolve({ json: function () { return Promise.resolve({ success: true }); } });
            }
        };
        sandbox.window = sandbox;
        if (user) {
            sandbox.firebase = { auth: function () { return { currentUser: user }; } };
        }
        vm.createContext(sandbox);
        vm.runInContext(clientSource, sandbox);
        sandbox.rekindleOpenReportModal({ contentType: 'suggestion', contentId: 'sugg-1' });
        doc.getElementById('report-reason-select').value = 'spam';
        doc.getElementById('report-comment-input').value = 'spam';
        doc.getElementById('report-submit-btn').onclick();

        var errorEl = doc.getElementById('report-error');
        var started = Date.now();
        while (!fetchCalls.length && !(errorEl && errorEl.textContent) && Date.now() - started < 200) {
            await new Promise(function (resolve) { setTimeout(resolve, 5); });
        }
        return { fetchCalls: fetchCalls, errorText: errorEl ? errorEl.textContent : '' };
    }

    var signedIn = await submitViaModal({
        uid: 'test-uid',
        getIdToken: function () { return Promise.resolve('test-token'); }
    });
    assert.strictEqual(signedIn.fetchCalls.length, 1,
        'a signed-in reporter must submit even with block-scoped page auth');
    assert.strictEqual(signedIn.fetchCalls[0].init.headers.Authorization, 'Bearer test-token',
        'the report must carry the fetched ID token');
    assert.ok(signedIn.fetchCalls[0].init.body.indexOf('"contentType":"suggestion"') !== -1,
        'the report body must reach the moderation worker');

    var signedOut = await submitViaModal(null);
    assert.strictEqual(signedOut.fetchCalls.length, 0,
        'a signed-out visitor must not send a report');
    assert.ok(/signed in/i.test(signedOut.errorText),
        'a signed-out visitor must still see the sign-in message');

    console.log('PASS - report comments');
    console.log('  rejected samples: ' + rejected.length);
    console.log('  accepted samples: ' + accepted.length);
    console.log('  client mirror agrees with the Worker on all ' + samples.length + ' samples');
})().catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
});
