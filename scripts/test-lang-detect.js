/*
 * Language detection accuracy + safety test.
 *
 * Run: node scripts/test-lang-detect.js
 *
 * This loads the generated js/lang-detect.js in a sandbox and pins the cases
 * that matter for social posting: short/accentless chat lines (where a
 * stopword-only detector fails), script languages, and normalisation.
 *
 * Regenerate the bundle with `npm run build:lang` after upgrading `eld`.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/lang-detect.js'), 'utf8');

assert.ok(/Efficient Language Detector/.test(source), 'the ELD attribution header must be present');
assert.ok(/Apache License 2\.0/.test(source), 'the Apache-2.0 notice must be present');
assert.ok(!/\bfetch\s*\(/.test(source), 'detection must never touch the network');
assert.ok(!/XMLHttpRequest/.test(source), 'detection must never use XMLHttpRequest');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'js/lang-detect.js' });
const detector = sandbox.window.rekindleLangDetect;

assert.ok(detector, 'js/lang-detect.js must register window.rekindleLangDetect');
assert.strictEqual(typeof detector.detect, 'function');
assert.strictEqual(typeof detector.detectLang, 'function');
assert.strictEqual(typeof detector.normalize, 'function');
assert.strictEqual(typeof detector.sameLanguage, 'function');

const cases = [
    // English
    ['hello everyone how are you doing today', 'en'],
    ['I will be there in ten minutes', 'en'],
    ['can you send me the link', 'en'],
    ['thanks a lot for the help', 'en'],
    ['what time does it start', 'en'],
    // Spanish
    ['hola como estas hoy', 'es'],
    ['¿dónde está la estación de tren?', 'es'],
    ['quiero aprender ingles', 'es'],
    ['a que hora empieza', 'es'],
    ['eso suena como una gran idea', 'es'],
    // French
    ['bonjour comment allez vous aujourd\'hui', 'fr'],
    ['je ne sais pas quoi faire', 'fr'],
    ['peux tu m\'envoyer le lien', 'fr'],
    ['a quelle heure ca commence', 'fr'],
    ['à bientôt ce soir', 'fr'],
    // German
    ['hallo wie geht es dir heute', 'de'],
    ['ich weiß nicht was ich tun soll', 'de'],
    ['kannst du mir den link schicken', 'de'],
    ['das essen war lecker', 'de'],
    ['wir sollten uns bald treffen', 'de'],
    // Italian
    ['ciao come stai oggi', 'it'],
    ['non so cosa fare', 'it'],
    ['dovremmo vederci presto', 'it'],
    ['il cibo era delizioso', 'it'],
    ['non ci posso credere', 'it'],
    // Portuguese
    ['olá como você está hoje', 'pt'],
    ['não sei o que fazer', 'pt'],
    ['a que horas comeca', 'pt'],
    ['podes enviar me o link', 'pt'],
    ['acabei de terminar de ler', 'pt'],
    // Polish
    ['cześć jak się masz dzisiaj', 'pl'],
    ['nie wiem co zrobić', 'pl'],
    ['mozesz mi wyslac link', 'pl'],
    ['powinnismy sie wkrotce spotkac', 'pl'],
    ['dzisiaj jest ladna pogoda', 'pl'],
    // Vietnamese
    ['chào bạn khỏe không hôm nay', 'vi'],
    ['tôi không biết phải làm gì', 'vi'],
    ['toi muon hoc tieng viet', 'vi'],
    ['đồ ăn rất ngon', 'vi'],
    ['hẹn gặp lại tối nay', 'vi'],
    // New 2026-11-10 languages (ELD ExtraSmall + lexicon rules).
    ['hallo hoe gaat het vandaag met je', 'nl'],
    ['ik weet niet wat ik moet doen', 'nl'],
    ['hej hur mår du idag', 'sv'],
    ['jag vet inte vad jag ska göra', 'sv'],
    ['hej hvordan har du det i dag', 'da'],
    ['jeg ved ikke hvad jeg skal gøre', 'da'],
    ['hei hvordan har du det i dag', 'no'],
    ['jeg vet ikke hva jeg skal gjøre', 'no'],
    ['merhaba bugün nasılsın', 'tr'],
    ['ne yapacağımı bilmiyorum', 'tr'],
    ['salut ce faci astăzi', 'ro'],
    ['nu știu ce să fac', 'ro'],
    ['szia hogy vagy ma', 'hu'],
    ['nem tudom mit tegyek', 'hu'],
    ['ahoj jak se máš dnes', 'cs'],
    ['nevím co mám dělat', 'cs'],
    ['ahoj ako sa máš dnes', 'sk'],
    ['neviem čo mám robiť', 'sk'],
    ['bok kako si danas', 'hr'],
    ['ne znam što da radim', 'hr'],
    ['živijo kako si danes', 'sl'],
    ['ne vem kaj naj naredim', 'sl'],
    ['halo apa kabar hari ini', 'id'],
    ['saya tidak tahu harus berbuat apa', 'id'],
    ['hai apa khabar hari ini', 'ms'],
    ['saya tidak tahu apa yang perlu dibuat', 'ms'],
    ['kamusta ka ngayon', 'tl'],
    ['hindi ko alam ang gagawin', 'tl'],
    ['habari yako leo', 'sw'],
    ['sijui nifanye nini', 'sw'],
    ['привіт як справи сьогодні', 'uk'],
    ['я не знаю що робити', 'uk'],
    ['здравей как си днес', 'bg'],
    ['не знам какво да правя', 'bg'],
    ['здраво како си данас', 'sr'],
    ['не знам шта да радим', 'sr'],
    ['হ্যালো আজ কেমন আছেন', 'bn'],
    ['আমি জানি না কী করব', 'bn'],
    ['வணக்கம் இன்று எப்படி இருக்கிறீர்கள்', 'ta'],
    ['எனக்கு என்ன செய்வது என்று தெரியவில்லை', 'ta'],
    ['नमस्ते आज कस्तो छ', 'ne'],
    ['मलाई के गर्ने थाहा छैन', 'ne'],
    ['ہیلو آج کیسے ہیں', 'ur'],
    ['مجھے نہیں معلوم کیا کروں', 'ur'],
    // Script languages
    ['Привет, как дела?', 'ru'],
    ['こんにちは元気ですか', 'ja'],
    ['你好吗我今天很好', 'zh'],
    ['안녕하세요 반갑습니다', 'ko'],
    ['مرحبا كيف حالك', 'ar'],
    ['שלום מה שלומך', 'he'],
    ['γεια σου τι κανεις', 'el'],
    ['สวัสดีครับสบายดีไหม', 'th'],
    ['नमस्ते आप कैसे हैं', 'hi']
];

const failures = [];
for (const [text, expected] of cases) {
    const result = detector.detect(text);
    if (result.lang !== expected) {
        failures.push(JSON.stringify(text) + ' -> ' + (result.lang || '(none)') +
            ' (expected ' + expected + ', source ' + result.source + ')');
    }
}
assert.deepStrictEqual(failures, [], 'detection mismatches:\n  ' + failures.join('\n  '));

// Short greetings are the cases ELD alone gets wrong ("merci" -> it,
// "hello" -> it). The chat lexicon is what pins these.
const greetings = [
    ['hello', 'en'], ['hi', 'en'], ['thanks', 'en'],
    ['hola', 'es'], ['gracias', 'es'],
    ['bonjour', 'fr'], ['merci', 'fr'],
    ['hallo', 'de'], ['danke', 'de'],
    ['ciao', 'it'], ['grazie', 'it'],
    ['obrigado', 'pt'], ['olá', 'pt'],
    ['dziekuje', 'pl'], ['cześć', 'pl'],
    ['cam on', 'vi'], ['xin chao', 'vi']
];
for (const [text, expected] of greetings) {
    const got = detector.detectLang(text);
    assert.strictEqual(got, expected, JSON.stringify(text) + ' -> ' + got + ' (expected ' + expected + ')');
}

// Unknown / content-free input must stay unknown so the UI does not invent a
// translation direction for it.
assert.strictEqual(detector.detectLang(''), '', 'empty text is unknown');
assert.strictEqual(detector.detectLang('   '), '', 'whitespace is unknown');
assert.strictEqual(detector.detectLang('1234 !!!'), '', 'digits/punctuation are unknown');
assert.strictEqual(detector.detectLang('https://example.com/a/b'), '', 'a bare URL is unknown');
assert.strictEqual(detector.detectLang('¯\\_(ツ)_/¯'), '', 'ASCII art must not be classified as Japanese');
assert.strictEqual(detector.detectLang('(╯°□°）╯︵ ┻━┻'), '', 'table-flip ASCII art is unknown');
assert.strictEqual(detector.detectLang('好'), 'zh', 'a single Han character is still Chinese');

// Normalisation must make stored codes and browser languages comparable.
assert.strictEqual(detector.normalize('pt-BR'), 'pt');
assert.strictEqual(detector.normalize('zh-Hans'), 'zh');
assert.strictEqual(detector.normalize('en_US'), 'en');
assert.strictEqual(detector.normalize('iw'), 'he');
assert.strictEqual(detector.sameLanguage('en-US', 'en'), true);
assert.strictEqual(detector.sameLanguage('pt-BR', 'pt'), true);
assert.strictEqual(detector.sameLanguage('es', 'pt'), false);
assert.strictEqual(detector.sameLanguage('', ''), false);

// Every result must be a 2-letter code or empty (the worker validates against
// its allowlist; a 3-letter/und code would be dropped silently).
for (const [text] of cases) {
    const lang = detector.detectLang(text);
    assert.ok(lang === '' || /^[a-z]{2}$/.test(lang), 'unexpected language code for ' + JSON.stringify(text) + ': ' + lang);
}

console.log('PASS - language detection (' + cases.length + ' sentences, ' + greetings.length + ' greetings, 11 script languages)');
