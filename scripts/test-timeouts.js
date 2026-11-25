/*
 * Guard the timeout-enforcement wiring.
 * Run: node scripts/test-timeouts.js
 *
 * 2026-11-26 bug: the moderation Worker runs in the ReKindle Social project
 * with social credentials, but `checkTimeout()` read the PRIMARY project's
 * `timeouts/{uid}` with the user's social token and then with the social
 * service account. Both return 401, the error was swallowed, and every timeout
 * was silently a no-op server-side (the client banner still showed because the
 * clients read primary). Discord-issued timeouts wrote the social copy that
 * nothing read. The worker now enforces the SOCIAL copy; the moderation UIs
 * and admin script write/clear both copies.
 *
 * If this fails, check workers/rekindle-moderate/worker.js `checkTimeout()`,
 * rtdb-social-rules.json `timeouts`, and the three `timeoutUser()` UIs.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'workers', 'rekindle-moderate', 'worker.js'), 'utf8');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'rtdb-social-rules.json'), 'utf8'));
const admin = fs.readFileSync(path.join(root, 'admin', 'timeout_user.js'), 'utf8');

// --- Worker enforcement reads the social RTDB ---
assert.ok(/async function checkTimeout\(uid, env, userToken, accessToken\)/.test(worker), 'checkTimeout exists');
assert.ok(/rtdbSocialGet\(`timeouts\/\$\{uid\}`, accessToken\)/.test(worker),
    'checkTimeout must read the social timeouts node with the social access token');
assert.ok(!/rtdbGetWithUserToken\(`timeouts\//.test(worker),
    'checkTimeout must not read primary timeouts with the user token (401: social token vs primary project)');
assert.ok(!/rtdbGetWithAccessToken\(`timeouts\//.test(worker),
    'checkTimeout must not read primary timeouts with the social service account (401)');
assert.ok(/if \(data && typeof data\.until === "number"\)/.test(worker), 'timeout shape check');
assert.ok(/const TIMEOUT_CACHE_TTL_MS = 30 \* 1000;/.test(worker), '30s timeout cache');

// --- Social rules allow the owner/moderators to write the mirrored copy ---
const timeoutRules = rules.rules && rules.rules.timeouts && rules.rules.timeouts.$uid;
assert.ok(timeoutRules, 'rtdb-social-rules.json must define timeouts/$uid');
assert.ok(/auth\.token\.moderator === true/.test(timeoutRules['.write']),
    'moderators must be able to write the social timeout');
assert.ok(/auth\.token\.email === 'ukiyo@rekindle\.ink'/.test(timeoutRules['.write']),
    'owner must be able to write the social timeout');
assert.ok(/hasChildren\(\['until', 'reason'\]\)/.test(timeoutRules['.validate']),
    'timeout validation must require until/reason');

// --- Every moderation UI mirrors to social; primary stays for the banner ---
const pages = {
    'kindlechat.html': /socialRtdb\.ref\('timeouts\/' \+ targetUid\)\.set\(timeoutPayload\)/,
    'topics.html': /socialApp\.database\(\)\.ref\('timeouts\/' \+ targetUid\)\.set\(timeoutPayload\)/,
    'neighbourhood.html': /socialRtdb\.ref\('timeouts\/' \+ targetUid\)\.set\(timeoutPayload\)/
};
for (const [file, socialWrite] of Object.entries(pages)) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(/updates\['timeouts\/' \+ targetUid\] = timeoutPayload/.test(html),
        file + ' must still write the primary timeout (client banner)');
    assert.ok(socialWrite.test(html),
        file + ' must mirror the timeout into the social RTDB (worker enforcement)');
    assert.ok(/ref\('timeouts\/' \+ user\.uid\)/.test(html),
        file + ' must keep reading the primary timeout for the banner');
}

// --- Admin CLI writes/clears both copies ---
assert.ok(/SOCIAL_DATABASE_URL/.test(admin), 'admin script must know the social database URL');
assert.ok(/socialRtdb\.ref\('timeouts\/' \+ user\.uid\)\.set\(payload\)/.test(admin),
    'admin timeout must write the social copy');
assert.ok(/socialRtdb\.ref\('timeouts\/' \+ user\.uid\)\.remove\(\)/.test(admin),
    'admin clear must remove the social copy');

console.log('PASS - timeout enforcement wiring');
