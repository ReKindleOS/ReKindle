/*
 * Text-moderation thresholds for the rekindle-moderate worker.
 * ---------------------------------------------------------------------------
 * OpenAI's omni-moderation model returns `flagged` using its own per-category
 * thresholds. In practice it over-flags ordinary conversation: "I wanted to
 * tell my petfish died" trips violence, "evil" trips harassment, and a long
 * innocent message occasionally trips one of the broad categories. Users then
 * have to retype whole messages on a Kindle keyboard (board reports
 * -P4yKVDOwcezy4DVXoS3, -OyrwO-L9sGSJUYOzwZw).
 *
 * Policy: relax ONLY the two categories with documented false positives
 * (violence, harassment) by requiring a high-confidence score. Every other
 * category keeps the model's own verdict, so sexual, hate, self-harm and the
 * severe categories are exactly as strict as before. Image moderation is not
 * relaxed at all, because an image false negative is much worse than a text
 * false positive.
 *
 * Missing scores keep the original flag (fail closed), so a model/API change
 * can never silently let content through.
 *
 * Keep scripts/test-moderation-policy.js in sync when editing this table.
 */

export const TEXT_THRESHOLDS = {
    // Broad categories with documented text false positives: require a
    // high-confidence score before rejecting.
    violence: 0.80,
    harassment: 0.75,
    // Everything else keeps OpenAI's verdict (threshold 0 means "any flag").
    // Listed explicitly so the policy is auditable.
    "self-harm": 0.0,
    hate: 0.0,
    sexual: 0.0,
    "sexual/minors": 0.0,
    "hate/threatening": 0.0,
    "harassment/threatening": 0.0,
    "self-harm/intent": 0.0,
    "self-harm/instructions": 0.0,
    "violence/graphic": 0.0
};

/**
 * Apply REKINDLE's text thresholds to an OpenAI moderation result.
 *
 * @param {{flagged?: boolean, categories?: Object, categoryScores?: Object}} result
 * @param {{isImage?: boolean}} [options] isImage keeps OpenAI's own verdict.
 * @returns {{flagged: boolean, categories: Object, suppressed: string[]}}
 */
export function applyModerationPolicy(result, options) {
    const opts = options || {};
    const rawCategories = (result && result.categories) || {};
    const scores = (result && result.categoryScores) || {};
    const categories = {};
    const suppressed = [];

    for (const key of Object.keys(rawCategories)) {
        const raw = rawCategories[key] === true;
        if (!raw) {
            categories[key] = false;
            continue;
        }
        if (opts.isImage) {
            categories[key] = true;
            continue;
        }
        const limit = Object.prototype.hasOwnProperty.call(TEXT_THRESHOLDS, key)
            ? TEXT_THRESHOLDS[key]
            : 0;
        const score = typeof scores[key] === "number" ? scores[key] : null;
        if (score === null || score >= limit) {
            categories[key] = true;
        } else {
            categories[key] = false;
            suppressed.push(key);
        }
    }

    return {
        flagged: Object.keys(categories).some(function (key) { return categories[key] === true; }),
        categories: categories,
        suppressed: suppressed
    };
}
