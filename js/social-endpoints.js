/*
 * Social Worker endpoints (single switch).
 *
 * The moderation and translation Workers live in the separate Cloudflare
 * account "ReKindle Social" (8d69e380e0c4e0580c47f21d9757c71c) so social
 * traffic cannot exhaust the main account's 100k/day Workers Free quota and
 * take paying-customer pages down with it. See docs/agent/usage-limits.md.
 *
 * Every social page reads this object, with the same URL as a hard-coded
 * fallback in case this file fails to load. To move hosts again, change the
 * two URLs here (and the fallbacks) and redeploy.
 */
(function () {
    'use strict';
    window.rekindleSocialEndpoints = {
        moderation: 'https://rekindle-moderate.rekindle-social.workers.dev',
        translation: 'https://rekindle-translate.rekindle-social.workers.dev'
    };
})();
