/*
 * Hermetic checks for the moderation threshold policy.
 * Run: node scripts/test-moderation-policy.js
 *
 * The worker applies REKINDLE's own text thresholds so ordinary conversation
 * ("my petfish died", "evil") is not rejected by OpenAI's broad categories,
 * while severe categories keep the model's verdict. If this test fails, check
 * workers/rekindle-moderate/moderation-policy.mjs.
 */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async function () {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'workers', 'rekindle-moderate', 'moderation-policy.mjs')).href);
    const apply = mod.applyModerationPolicy;

    function run(categories, scores, opts) {
        const result = {
            flagged: Object.keys(categories).some(function (k) { return categories[k] === true; }),
            categories: categories,
            categoryScores: scores
        };
        return apply(result, opts);
    }

    // Broad categories: low-confidence flags are suppressed.
    let r = run({ violence: true }, { violence: 0.35 });
    assert.strictEqual(r.flagged, false, 'violence 0.35 should not reject');
    assert.deepStrictEqual(r.suppressed, ['violence']);

    r = run({ violence: true }, { violence: 0.85 });
    assert.strictEqual(r.flagged, true, 'violence 0.85 should reject');

    r = run({ harassment: true }, { harassment: 0.55 });
    assert.strictEqual(r.flagged, false, 'harassment 0.55 should not reject');

    r = run({ harassment: true }, { harassment: 0.8 });
    assert.strictEqual(r.flagged, true, 'harassment 0.8 should reject');

    // Only violence and harassment are relaxed; the rest keep the model's
    // verdict even at low scores.
    r = run({ 'self-harm': true }, { 'self-harm': 0.2 });
    assert.strictEqual(r.flagged, true, 'self-harm must keep the model verdict');

    r = run({ hate: true }, { hate: 0.2 });
    assert.strictEqual(r.flagged, true, 'hate must keep the model verdict');

    r = run({ sexual: true }, { sexual: 0.2 });
    assert.strictEqual(r.flagged, true, 'sexual must keep the model verdict');

    // Severe categories: the model's verdict always stands (threshold 0).
    const severe = ['sexual/minors', 'hate/threatening', 'harassment/threatening', 'self-harm/intent', 'self-harm/instructions', 'violence/graphic'];
    severe.forEach(function (key) {
        const cats = {};
        const scores = {};
        cats[key] = true;
        scores[key] = 0.01;
        const out = run(cats, scores);
        assert.strictEqual(out.flagged, true, key + ' must reject at any score');
    });

    // Missing scores fail closed: keep the original flag.
    r = run({ violence: true }, {});
    assert.strictEqual(r.flagged, true, 'missing score must keep the flag');

    r = run({ violence: true }, { violence: '0.9' });
    assert.strictEqual(r.flagged, true, 'non-numeric score must keep the flag');

    // Non-flagged categories never become flagged.
    r = run({ violence: false, hate: false }, { violence: 0.99, hate: 0.99 });
    assert.strictEqual(r.flagged, false);

    // Images are not relaxed.
    r = run({ violence: true }, { violence: 0.35 }, { isImage: true });
    assert.strictEqual(r.flagged, true, 'image moderation must keep the model verdict');
    assert.deepStrictEqual(r.suppressed, []);

    // Unknown categories default to the model's verdict.
    r = run({ 'made-up': true }, { 'made-up': 0.2 });
    assert.strictEqual(r.flagged, true, 'unknown category must not be silently dropped');

    // Mixed: one suppressed, one sustained.
    r = run({ violence: true, 'sexual/minors': true }, { violence: 0.2, 'sexual/minors': 0.1 });
    assert.strictEqual(r.flagged, true);
    assert.deepStrictEqual(r.suppressed, ['violence']);

    console.log('moderation policy checks passed (14 cases)');
})().catch(function (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
