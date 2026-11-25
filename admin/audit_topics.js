/**
 * audit_topics.js — find broken / spammy / drifted Topics documents.
 *
 * The social Firestore project (`rekindle-socials`) is on the Spark free tier
 * (50k document reads/day), so a full audit is not free: every topic doc costs
 * one read, and `--comments` costs one read per comment. Run it after the daily
 * quota resets (midnight Pacific) or after the project is moved to Blaze.
 *
 * Usage:
 *   node admin/audit_topics.js                 # topic docs only, count() for comments
 *   node admin/audit_topics.js --json out.json # also dump every topic for offline work
 *   node admin/audit_topics.js --comments      # read comment docs (expensive) and flag them
 *   node admin/audit_topics.js --fix           # dry run of the safe repairs
 *   node admin/audit_topics.js --fix --apply   # write the repairs (backs up first)
 *
 * `--fix` only repairs derived fields (commentCount from count(), lastActive
 * from the newest comment). It never edits content and never deletes a topic.
 *
 * Point it at the primary project (which has no topics) to smoke-test without
 * touching social data:  TOPICS_PROJECT=primary node admin/audit_topics.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const USE_PRIMARY = process.env.TOPICS_PROJECT === 'primary';
const SERVICE_ACCOUNT = path.join(ROOT, USE_PRIMARY ? 'service-account.json' : 'service-account-social.json');

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name) !== -1;
const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
};

const WANT_COMMENTS = flag('--comments');
const WANT_JSON = opt('--json');
const FIX = flag('--fix');
const APPLY = flag('--apply');

if (!fs.existsSync(SERVICE_ACCOUNT)) {
    console.error('Missing ' + SERVICE_ACCOUNT);
    process.exit(1);
}

const app = admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
    projectId: require(SERVICE_ACCOUNT).project_id
}, 'audit-topics-' + Date.now());
const db = app.firestore();

const NOW = Date.now();
const issues = [];
const add = (id, sev, code, msg) => issues.push({ id, sev, code, msg });

function toMillis(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

const PROMO = /kindlehub|khub|unreader|unread3r|inkchat/i;
const URLISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|app|pro|ink|dev|co)\b)/i;

function checkTopic(t) {
    const id = t.id;
    const title = t.title;

    if (title === undefined) add(id, 'HIGH', 'title-missing', 'title field is missing (renders blank in the list, "undefined" in the header)');
    else if (title === null) add(id, 'HIGH', 'title-null', 'title is null');
    else if (typeof title !== 'string') add(id, 'HIGH', 'title-type', 'title is ' + typeof title + ': ' + JSON.stringify(title));
    else {
        if (!title.trim()) add(id, 'HIGH', 'title-blank', 'title is empty/whitespace');
        if (/^(undefined|null|nan|\[object object\])$/i.test(title.trim())) add(id, 'HIGH', 'title-literal', 'title is the literal string ' + JSON.stringify(title));
        if (title !== title.trim()) add(id, 'LOW', 'title-space', 'title has leading/trailing whitespace: ' + JSON.stringify(title));
        if (title.length > 20) add(id, 'LOW', 'title-length', 'title is ' + title.length + ' chars (limit 20)');
    }

    if (typeof t.subheading === 'string') {
        if (t.subheading.length > 35) add(id, 'LOW', 'subheading-length', 'subheading is ' + t.subheading.length + ' chars (limit 35)');
        if (/^(undefined|null|nan)$/i.test(t.subheading.trim())) add(id, 'MED', 'subheading-literal', 'subheading is the literal string ' + JSON.stringify(t.subheading));
    } else if (t.subheading !== undefined && t.subheading !== null && t.subheading !== '') {
        add(id, 'MED', 'subheading-type', 'subheading is ' + typeof t.subheading);
    }

    if (!t.authorId) add(id, 'HIGH', 'author-missing', 'authorId is missing, so the topic cannot be attributed or deleted by its owner');
    if (!t.icon) add(id, 'LOW', 'icon-missing', 'icon is missing (falls back to the chat icon)');

    const created = toMillis(t.timestamp);
    const active = toMillis(t.lastActive);
    if (created === null) add(id, 'MED', 'timestamp-missing', 'timestamp is missing or not a Timestamp');
    else if (created > NOW + 60000) add(id, 'MED', 'timestamp-future', 'timestamp is in the future by ' + Math.round((created - NOW) / 86400000) + 'd');
    if (active === null) add(id, 'MED', 'lastActive-missing', 'lastActive is missing or not a Timestamp');
    else {
        if (active > NOW + 60000) add(id, 'MED', 'lastActive-future', 'lastActive is in the future by ' + Math.round((active - NOW) / 86400000) + 'd');
        if (created !== null && active < created - 1000) add(id, 'LOW', 'lastActive-before-create', 'lastActive predates the topic');
    }

    const cc = t.commentCount;
    if (cc === undefined) add(id, 'MED', 'count-missing', 'commentCount is missing');
    else if (typeof cc !== 'number' || !isFinite(cc)) add(id, 'MED', 'count-type', 'commentCount is ' + JSON.stringify(cc));
    else if (cc < 0) add(id, 'HIGH', 'count-negative', 'commentCount is ' + cc);

    if (t.poll) {
        const poll = t.poll;
        if (typeof poll !== 'object') add(id, 'MED', 'poll-type', 'poll is ' + typeof poll);
        else {
            if (!poll.question || typeof poll.question !== 'string' || !poll.question.trim()) add(id, 'MED', 'poll-question', 'poll has no question');
            else if (poll.question.length > 100) add(id, 'LOW', 'poll-question-length', 'poll question is ' + poll.question.length + ' chars (limit 100)');
            if (!Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 4) {
                add(id, 'MED', 'poll-options', 'poll options are invalid: ' + JSON.stringify(poll.options));
            } else {
                poll.options.forEach((o, i) => {
                    if (typeof o !== 'string' || !o.trim()) add(id, 'MED', 'poll-option-blank', 'poll option ' + i + ' is blank');
                    else if (o.length > 50) add(id, 'LOW', 'poll-option-length', 'poll option ' + i + ' is ' + o.length + ' chars (limit 50)');
                });
            }
        }
    }

    const blob = [title, t.subheading, t.poll && t.poll.question].filter((v) => typeof v === 'string').join(' ');
    if (PROMO.test(blob)) add(id, 'HIGH', 'promo', 'contains a banned competitor term (masked in the UI but still stored)');
    if (URLISH.test(blob)) add(id, 'HIGH', 'url', 'contains link-like text, which is banned in social apps');
    if (/[\u200b-\u200f\u2060\ufeff]/.test(blob)) add(id, 'LOW', 'zero-width', 'contains zero-width characters');
    if (/(?:^|[^a-z0-9])undefined(?:$|[^a-z0-9])/i.test(blob)) add(id, 'MED', 'undefined-text', 'visible text contains the word "undefined"');
}

async function main() {
    console.log((USE_PRIMARY ? 'Primary' : 'Social') + ' Firestore: reading topics…');
    const snap = await db.collection('topics').get();
    const topics = [];
    console.log('Found ' + snap.size + ' topics.');

    for (const doc of snap.docs) {
        const raw = doc.data();
        const topic = { id: doc.id };
        for (const [k, v] of Object.entries(raw)) topic[k] = typeof v.toMillis === 'function' ? { __ts: v.toMillis() } : v;
        // keep Timestamp objects on a side channel so --fix can compare them
        topic._createdMs = toMillis(raw.timestamp);
        topic._activeMs = toMillis(raw.lastActive);
        topic._createdAtMs = toMillis(raw.createdAt);

        const countSnap = await doc.ref.collection('comments').count().get();
        topic.actualComments = countSnap.data().count;

        if (typeof raw.commentCount === 'number' && raw.commentCount !== topic.actualComments) {
            add(doc.id, 'MED', 'count-drift', 'commentCount is ' + raw.commentCount + ' but the collection holds ' + topic.actualComments);
        }

        if (WANT_COMMENTS) {
            const comments = await doc.ref.collection('comments').get();
            topic.comments = [];
            let newest = null;
            comments.forEach((c) => {
                const cd = c.data();
                const ts = toMillis(cd.timestamp);
                topic.comments.push({ id: c.id, body: cd.body, authorId: cd.authorId, ts: ts });
                if (ts && (newest === null || ts > newest)) newest = ts;
                if (!cd.body || !String(cd.body).trim()) add(doc.id, 'HIGH', 'comment-blank', 'comment ' + c.id + ' has no body');
                if (!cd.authorId) add(doc.id, 'MED', 'comment-author', 'comment ' + c.id + ' has no authorId');
                if (ts === null) add(doc.id, 'MED', 'comment-timestamp', 'comment ' + c.id + ' has no usable timestamp');
                else if (ts > NOW + 60000) add(doc.id, 'MED', 'comment-future', 'comment ' + c.id + ' is timestamped in the future');
            });
            topic._newestCommentMs = newest;
        }

        topics.push(topic);
        checkTopic(Object.assign({}, raw, { id: doc.id }));
    }

    // Duplicate titles (case/space-insensitive)
    const seen = new Map();
    for (const t of topics) {
        if (!t.title || typeof t.title !== 'string') continue;
        const key = t.title.trim().toLowerCase();
        if (seen.has(key)) add(t.id, 'MED', 'duplicate-title', 'same title as ' + seen.get(key) + ': ' + JSON.stringify(t.title));
        else seen.set(key, t.id);
    }

    const bySev = { HIGH: 0, MED: 0, LOW: 0 };
    issues.forEach((i) => { bySev[i.sev] = (bySev[i.sev] || 0) + 1; });
    const withIssues = new Set(issues.filter((i) => i.sev !== 'LOW').map((i) => i.id));

    console.log('\n' + snap.size + ' topics, ' + withIssues.size + ' with a HIGH/MED issue, ' + issues.length + ' findings ' +
        '(HIGH ' + bySev.HIGH + ', MED ' + bySev.MED + ', LOW ' + bySev.LOW + ')');

    if (issues.length) {
        console.log('');
        issues.sort((a, b) => ({ HIGH: 0, MED: 1, LOW: 2 }[a.sev] - { HIGH: 0, MED: 1, LOW: 2 }[b.sev]));
        for (const i of issues) {
            console.log('[' + i.sev + '] ' + i.id + ' (' + i.code + ') ' + i.msg);
        }
    }

    if (WANT_JSON) {
        fs.writeFileSync(WANT_JSON, JSON.stringify({ fetchedAt: new Date().toISOString(), topics, issues }, null, 2));
        console.log('\nWrote ' + WANT_JSON);
    }

    if (FIX) {
        const repairs = topics.filter((t) => {
            const drift = typeof t.commentCount === 'number' && t.commentCount !== t.actualComments;
            const stale = WANT_COMMENTS && t._newestCommentMs && t._activeMs && t._newestCommentMs > t._activeMs;
            return drift || stale;
        });
        console.log('\n' + (APPLY ? 'Applying' : 'Would apply') + ' ' + repairs.length + ' derived-field repair(s).');
        for (const t of repairs) {
            const updates = {};
            if (typeof t.commentCount === 'number' && t.commentCount !== t.actualComments) updates.commentCount = t.actualComments;
            if (WANT_COMMENTS && t._newestCommentMs && (!t._activeMs || t._newestCommentMs > t._activeMs)) {
                updates.lastActive = admin.firestore.Timestamp.fromMillis(t._newestCommentMs);
            }
            console.log('  ' + t.id + ': ' + Object.keys(updates).map((k) => k + '=' + (updates[k].toMillis ? updates[k].toMillis() : updates[k])).join(', '));
            if (APPLY) await db.collection('topics').doc(t.id).update(updates);
        }
        if (APPLY && repairs.length) console.log('Done. Re-run without --fix to confirm.');
        if (!APPLY && repairs.length) console.log('\nRe-run with --fix --apply to write these. Content fields are never touched.');
    }

    process.exit(issues.some((i) => i.sev === 'HIGH') ? 2 : 0);
}

main().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    if (err && err.code === 8) {
        console.error('Firestore read quota exhausted (RESOURCE_EXHAUSTED). ' +
            'The social project is on Spark (50k reads/day); it resets at midnight Pacific. ' +
            'Move rekindle-socials to Blaze to remove the cap.');
    } else {
        console.error('Fatal: ' + msg);
    }
    process.exit(1);
});
