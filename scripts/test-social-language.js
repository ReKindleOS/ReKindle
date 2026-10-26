/*
 * Social post-language wiring guard.
 *
 * Run: node scripts/test-social-language.js
 *
 * The moderation worker is the only writer for KindleChat, DMs, topics and
 * neighbourhood posts/comments. Every one of those paths must persist the
 * client-detected `lang`, and every viewing path must gate the Translate link
 * on that language instead of showing it to everyone. This is a source-level
 * test because the worker and the pages cannot be booted in CI.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const worker = read('workers/rekindle-moderate/worker.js');
const chat = read('kindlechat.html');
const neighbourhood = read('neighbourhood.html');
const topics = read('topics.html');
const postLanguage = read('js/post-language.js');
const translateClient = read('js/translate-client.js');
const langDetect = read('js/lang-detect.js');
const pkg = JSON.parse(read('package.json'));

// --- worker: validation + every content type ------------------------------
assert.ok(/DETECTED_LANGUAGE_CODES/.test(worker), 'worker must define the detected-language allowlist');
assert.ok(/function clientDetectedLang\s*\(/.test(worker), 'worker must normalise/validate client language codes');
assert.ok(/DETECTED_LANGUAGE_CODES\.has\(base\)/.test(worker), 'worker must reject unknown codes');
assert.ok(/function addDetectedLang\s*\(/.test(worker), 'worker must have one shared lang-adding helper');

// kindlechat message + both DM writes + topic + topic comment + neighbourhood post + comment
const addLangCalls = (worker.match(/addDetectedLang\s*\(/g) || []).length - 1; // minus the definition
assert.ok(addLangCalls >= 7, 'expected lang on kindlechat, dm_request, dm_message, topic, topic_comment, neighbourhood_post and neighbourhood_comment, got ' + addLangCalls);
assert.ok(/const msgData = \{[\s\S]*?addDetectedLang\(msgData, body\)/.test(worker), 'kindlechat message must store lang');
assert.ok(/DM_MESSAGES_PATH[\s\S]{0,200}addDetectedLang\(\{/.test(worker), 'DM messages must store lang');
assert.ok(/const topicData = \{[\s\S]*?addDetectedLang\(topicData, body\)/.test(worker), 'topics must store lang');
assert.ok(/topics\/\$\{topicId\}\/comments[\s\S]{0,200}addDetectedLang\(\{/.test(worker), 'topic comments must store lang');
assert.ok(/firestoreCreate\("neighbourhood_posts"[\s\S]{0,200}addDetectedLang\(\{/.test(worker), 'neighbourhood posts must store lang');
assert.ok(/neighbourhood_posts\/\$\{postId\}\/comments[\s\S]{0,200}addDetectedLang\(\{/.test(worker), 'neighbourhood comments must store lang');

// --- client: every send path sends lang -----------------------------------
assert.ok(/bodyObj\.lang = detectedLang/.test(chat), 'KindleChat general messages must send lang');
assert.ok(/dmPayload\.lang = dmLang/.test(chat), 'KindleChat DMs must send lang');
assert.ok(/requestPayload\.lang = requestLang/.test(chat), 'KindleChat DM requests must send lang');
assert.ok(/neighbourhood_post', text: text, lang:/.test(neighbourhood), 'neighbourhood posts must send lang');
assert.ok(/neighbourhood_comment', postId: postId, text: text, lang:/.test(neighbourhood), 'neighbourhood comments must send lang');
assert.ok(/type: 'topic_comment'[\s\S]{0,160}lang:/.test(topics), 'topic comments must send lang');
assert.ok(/type: 'topic'[\s\S]{0,600}lang:/.test(topics), 'topics must send lang');

// --- client: Translate links are gated on the stored language -------------
assert.ok(/langDiffers/.test(chat), 'KindleChat must compare stored lang with the reader language');
assert.ok(/&& langDiffers/.test(chat), 'KindleChat translate link must be gated by langDiffers');
assert.ok(/postLangDiffers\(postLang\)/.test(neighbourhood), 'neighbourhood posts must be gated by stored lang');
assert.ok(/commentLangDiffers/.test(neighbourhood), 'neighbourhood comments must be gated by stored lang');
assert.ok(/topicLangDiffers\(msgLang\)/.test(topics), 'topic comments must be gated by stored lang');

// --- client: auto translation is queued, not a synchronous fan-out --------
assert.ok(/queueMessageAutoTranslation/.test(chat), 'KindleChat must auto-translate viewed foreign messages');
assert.ok(/autoTranslateSource = msgLang \|\| 'auto'/.test(chat), 'KindleChat must auto-detect messages without a stored lang');
assert.ok(/queueDmAutoTranslation/.test(chat), 'KindleChat DMs must auto-translate viewed foreign messages');
assert.ok(/dmMsgLang \|\| 'auto'/.test(chat), 'KindleChat DMs must auto-detect messages without a stored lang');
assert.ok(/queuePostAutoTranslation/.test(neighbourhood), 'neighbourhood posts must auto-translate viewed foreign posts');
assert.ok(/postLang \|\| 'auto'/.test(neighbourhood), 'neighbourhood posts must auto-detect posts without a stored lang');
assert.ok(/id="post-trans-\$\{escapeHtml\(post.id\)\}"/.test(neighbourhood), 'neighbourhood posts must have a stable translation-control container');
assert.ok(/getElementById\('post-trans-' \+ postId\)/.test(neighbourhood), 'post translation must render Show Original into that container');
assert.ok(/queueCommentAutoTranslation/.test(neighbourhood), 'neighbourhood comments must auto-translate viewed foreign comments');
assert.ok(/commentLang \|\| 'auto'/.test(neighbourhood), 'neighbourhood comments must auto-detect comments without a stored lang');
assert.ok(/cmt-trans-/.test(neighbourhood), 'neighbourhood comments must have a stable translation-control container');
assert.ok(/queueTopicAutoTranslation/.test(topics), 'topic comments must auto-translate viewed foreign comments');
assert.ok(/msgLang \|\| 'auto'/.test(topics), 'topic comments must auto-detect comments without a stored lang');
assert.ok(/autoTranslate: autoTranslate/.test(translateClient), 'translate-client must expose the auto queue');

// The queue is what keeps a feed render from firing N requests in one paint.
assert.ok(/AUTO_MAX_JOBS/.test(translateClient), 'auto-translation must have a per-page ceiling');
assert.ok(/autoStopped/.test(translateClient), 'auto-translation must stop on a budget error');
assert.ok(/sameLanguage\(opts\.source, opts\.target\)/.test(translateClient), 'auto-translation must skip the reader language');
assert.ok(/detectInfo: detectInfo/.test(translateClient), 'translate-client must expose detection info');

// --- detection bundle is lazy, versioned and attributed -------------------
assert.ok(/DETECT_URL = 'js\/lang-detect\.js\?v=1'/.test(postLanguage), 'post-language must lazy-load the versioned bundle');
assert.ok(/script\.async = true/.test(postLanguage), 'the detection bundle must not block parsing');
assert.ok(/Efficient Language Detector/.test(langDetect), 'the detection bundle must carry ELD attribution');
assert.ok(/Apache License 2\.0/.test(langDetect), 'the detection bundle must carry the Apache-2.0 notice');
assert.ok(fs.existsSync(path.join(root, 'licenses', 'efficient-language-detector-LICENSE.txt')),
    'the vendored ELD licence must be present');

for (const [name, html] of [['kindlechat.html', chat], ['neighbourhood.html', neighbourhood], ['topics.html', topics]]) {
    assert.ok(/js\/translate-client\.js\?v=3/.test(html), name + ' must load translate-client v3');
    assert.ok(/js\/post-language\.js\?v=1/.test(html), name + ' must load post-language v1');
}

assert.ok(pkg.scripts['build:lang'], 'package.json must expose npm run build:lang');
assert.ok(pkg.scripts.test.indexOf('test-lang-detect.js') !== -1, 'npm test must run test-lang-detect.js');
assert.ok(pkg.scripts.test.indexOf('test-social-language.js') !== -1, 'npm test must run test-social-language.js');

console.log('PASS - social post language (worker persistence, gating, auto-translation, lazy detector)');
