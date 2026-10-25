/*
 * Shared failure handling for the social Cloudflare Workers.
 *
 * Why: the account is on the Workers Free plan, which allows 100,000 requests
 * per day across ALL Workers *and* Pages Functions. When that is used up every
 * worker URL answers 429 with Cloudflare's plain-text "error code: 1027" page.
 * That page has no CORS headers, so the browser rejects the fetch itself
 * (Safari: "Load failed", Chrome: "Failed to fetch") instead of returning a
 * Response. Social pages used to surface that raw message as
 * "Unable to post: Load failed", and every retry popped another alert
 * (Suggestions reports 2026-10-24).
 *
 * Pages that opt in get:
 *   - readJson(resp): JSON body, or { error } for a non-JSON 429/5xx outage.
 *     The outage is remembered for two minutes so a quota-exhausted day is not
 *     made worse by retry storms.
 *   - isTransportFailure(err) / outageActive() / noteOutage()
 *   - errorMessage(err): the friendly outage text, or null for other errors.
 *
 * KindleChat has its own copy of this logic because it also needs the same
 * cooldown for its translation retry ladder; keep the message/cooldown in sync.
 * See docs/agent/usage-limits.md (2026-10-25 incident).
 */
(function () {
    'use strict';

    var COOLDOWN_MS = 120000;
    var OUTAGE_MESSAGE = 'This is temporarily unavailable. Please try again in a few minutes.';
    var outageUntil = 0;

    function isTransportFailure(err) {
        if (!err) return false;
        var msg = String(err.message || '');
        return err.name === 'TypeError' || /load failed|failed to fetch|networkerror|network request failed/i.test(msg);
    }

    function outageActive() {
        return outageUntil > Date.now();
    }

    function noteOutage() {
        outageUntil = Date.now() + COOLDOWN_MS;
    }

    function outageMessage() {
        return OUTAGE_MESSAGE;
    }

    // Resolves to the parsed body, or a synthetic { error } object for the
    // platform outage page. Callers already handle { error } by showing it, so
    // no page-specific parsing is needed. Other non-JSON replies throw.
    function readJson(resp) {
        return resp.text().then(function (raw) {
            var data = null;
            if (raw) {
                try { data = JSON.parse(raw); } catch (e) { data = null; }
            }
            if (!data) {
                if (resp.status === 429 || resp.status >= 500) {
                    noteOutage();
                    return { error: OUTAGE_MESSAGE, __outage: true, __status: resp.status };
                }
                throw new Error('HTTP ' + resp.status);
            }
            data.__status = resp.status;
            return data;
        });
    }

    // Returns the outage text when the error is a transport failure or an
    // outage is already active, otherwise null (caller keeps its own message).
    function errorMessage(err) {
        if (isTransportFailure(err) || outageActive()) {
            noteOutage();
            return OUTAGE_MESSAGE;
        }
        return null;
    }

    window.rekindleWorkerClient = {
        isTransportFailure: isTransportFailure,
        outageActive: outageActive,
        noteOutage: noteOutage,
        outageMessage: outageMessage,
        readJson: readJson,
        errorMessage: errorMessage
    };
})();
