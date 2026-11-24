/**
 * Unit tests for the KindleChat repetition guard.
 *
 * Run:  node scripts/test-chat-spam.js
 *
 * The spam transcript is the real 2026-10-19 flood from KindleChat (one user
 * sending "hello hello hello" / "hi hi hi" / "aaaa" for ~30 minutes while the
 * chat was dead). The guard's state is the string that rides on the
 * server_rate_limits bucket, so the test replays the bucket exactly as the
 * worker would: attempts (including rejected ones) update the state, but
 * rejected messages are never posted.
 */

const assert = require('assert');

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-19T14:58:00Z');

(async () => {
    const {
        evaluateChatRepetition,
        evaluateChatSpam,
        activeChatMute
    } = await import('../workers/rekindle-moderate/worker.js');

    // state -> { rep, blocked, at }
    function send(state, text, at, isArt) {
        const result = evaluateChatRepetition(state.rep, text, at, isArt === true);
        return { rep: result.rep, blocked: result.blocked, text, at };
    }

    /* ---------------------------------------------------------------- */
    /* 1. The real flood                                                */
    /* ---------------------------------------------------------------- */
    const flood = [
        [1.2, 'yo hi guys any more Acton'],
        [1.4, 'action'],
        [3.3, 'im not gonna stop saying heelllloo until someone joins'],
        [3.5, 'hello'],
        [3.7, 'llo hello hello'],
        [4.0, 'hello hello hello hello hello hello'],
        [4.2, 'hello hello'],
        [4.3, 'hello'],
        [4.4, 'hello'],
        [4.6, 'hello hello hello'],
        [5.3, 'hello hello hello hello hello hello hello ello hello hello hello hello'],
        [6.7, 'hello hello'],
        [7.0, 'hello hello hello hello hello hello'],
        [7.5, 'hello hello hello hello hello.hellohllo hello hello hello hllo'],
        [8.0, 'hhhhhhhhhhhhhheeeeeeeeeeelllllllllllllllllloooooooooooooooo'],
        [8.7, 'hi hi hi hi bhi hi hi hi hibhi hi ho hi hibhi hi hi hi hi hi hi hi hi bhi hi hi hi hi h hi hi h hi hi hi hi'],
        [9.5, 'hhhhhhiiiiiiiuuiiii helllllooooooo hello helo hello helo hello hi hi hi hi hi hi hi hi hi'],
        [9.9, 'hellllooooo'],
        [10.1, 'hello hellohello'],
        [11.0, 'hello hello hello hello hello hello hello hello hello hello hello hello hello  hello hello helo hello helo hello'],
        [13.3, 'ima njot stop spamming random lettets till soimeone comes'],
        [15.0, 'ffgjufezcnjjtdvgjuhfsxfnkigdfhkijhfddvbbbfdwgupljhddfnfdfrgjgwyijtfesdyhjtwfjyrdxcnhyrdsdgnmhdagjfshjjdsghrhggdvjytdvbhhy'],
        [17.6, 'ima nott stop spammin a until someone comes online'],
        [18.0, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaasaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        [18.2, 'a'],
        [19.3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        [23.8, 'k by guy im too tired  be bck at 1145 perth auustralia time']
    ];

    let state = { rep: '' };
    const blocked = [];
    const allowed = [];
    for (const [offsetMin, text] of flood) {
        const at = T0 + offsetMin * MIN;
        const out = send(state, text, at);
        state = out;
        (out.blocked ? blocked : allowed).push({ text, blocked: out.blocked });
    }

    // The flood must be cut off early and stay cut off.
    assert(blocked.length >= 8, 'expected at least 8 of the flood messages to be blocked, got ' + blocked.length);
    assert(blocked[0].text.toLowerCase().indexOf('hello') !== -1, 'the first block should be a hello flood message, got: ' + blocked[0].text);

    // Genuine sentences must still get through.
    const allowedTexts = allowed.map(a => a.text.toLowerCase());
    assert(allowedTexts.some(t => t.indexOf('not gonna stop') !== -1), 'the first warning line must not be blocked');
    assert(allowedTexts.some(t => t.indexOf('k by guy') !== -1), 'the sign-off line must not be blocked');

    /* ---------------------------------------------------------------- */
    /* 2. Normal conversation is untouched                              */
    /* ---------------------------------------------------------------- */
    const normal = [
        'hi everyone',
        'how are you all doing tonight',
        'im from australia',
        'ooh thats cool',
        'anyone want to play chess',
        'i had to sort the laundry',
        'listening to a podcast about evo-devo right now',
        'the fun thing about evo-devo is that if u arrange them right you can make flies grow legs out of their face',
        'orbits are cool too',
        'what is evo devo',
        'science',
        'dead chat',
        'hello',
        'is anyone even here',
        'i think everyone went offline',
        'ok bye then',
        'cya tomorrow'
    ];
    state = { rep: '' };
    normal.forEach((text, i) => {
        const out = send(state, text, T0 + i * 40000);
        state = out;
        assert(!out.blocked, 'normal conversation line was blocked: "' + text + '"');
    });

    /* ---------------------------------------------------------------- */
    /* 3. Pixel art: same drawing twice is blocked, different art is not */
    /* ---------------------------------------------------------------- */
    state = { rep: '' };
    const gridA = 'rgbaaaaaaarggrrgbrrrrrrrrrrrrr...';
    const gridB = 'rbgbrbgbrbgbrbgbrbgbrbgbrbgbrbg...';
    const firstArt = send(state, gridA, T0, true);
    assert(!firstArt.blocked, 'first pixel art post must pass');
    const sameArt = send(firstArt, gridA, T0 + 30 * 1000, true);
    assert(sameArt.blocked && /pixel art/i.test(sameArt.blocked.message), 'repsting the same pixel art must be blocked');
    const otherArt = send(firstArt, gridB, T0 + 30 * 1000, true);
    assert(!otherArt.blocked, 'a different drawing must not be blocked');

    /* ---------------------------------------------------------------- */
    /* 4. State stays small and stores no message text                  */
    /* ---------------------------------------------------------------- */
    state = { rep: '' };
    state = send(state, 'hello hello hello hello hello ' + 'x'.repeat(400), T0);
    assert(state.rep.length < 400, 'repetition state must stay small, got ' + state.rep.length + ' chars');
    assert(state.rep.indexOf('hello') === -1, 'repetition state must not contain message text');

    /* ---------------------------------------------------------------- */
    /* 5. Interleaved long-paste flood (the real 2026-11-24 transcript)  */
    /* ---------------------------------------------------------------- */
    // The account posted this same 300+ character anthem five times, with
    // four different Soviet lines between each pair. The old four-slot guard
    // evicted the anthem before the next copy arrived, so every copy passed.
    const anthem = [
        'Союз нерушимый республик свободных',
        'Сплотила навеки Великая Русь',
        'Да здравствует созданный волей народов',
        'Единый, могучий Советский Союз!',
        'Славься, Отечество наше свободное',
        'Дружбы народов надёжный оплот!',
        'Партия Ленина - сила народная',
        'Нас к торжеству коммунизма ведёт!'
    ].join('\n');
    const interleaved = [
        [0, anthem],
        [1, 'SOVIET UNION'],
        [2, 'USSR'],
        [3, 'NUKES'],
        [4, 'COMMUNISM!!!!'],
        [5, anthem],
        [6, 'RUSSIA'],
        [7, 'CCCP'],
        [8, '1922-1991'],
        [9, 'RED ARMY'],
        [10, anthem],
        [11, 'BYE'],
        [12, 'COMRADE'],
        [13, 'VODKA'],
        [14, 'NYET'],
        [15, anthem]
    ];
    let bucket = { rep: '', dups: '', strikes: [], muteUntil: 0 };
    const longBlocks = [];
    for (const [sec, text] of interleaved) {
        const at = T0 + sec * 1000;
        const out = evaluateChatSpam(bucket, text, at, false);
        bucket = {
            rep: out.rep,
            dups: out.dups,
            strikes: out.strikes,
            muteUntil: out.muteUntil
        };
        if (out.blocked) longBlocks.push({ text, blocked: out.blocked, at });
    }

    // First copy passes; copies 2-4 are blocked, and the third block mutes.
    assert(!longBlocks.some(b => b.text === anthem && b.at === T0), 'the first long paste must pass');
    assert(longBlocks.some(b => b.text === anthem && b.at === T0 + 5000),
        'the second long paste must be blocked even with four different lines between copies');
    assert(longBlocks.length >= 3, 'expected at least 3 blocks in the interleaved flood, got ' + longBlocks.length);
    assert(/temporarily blocked|minute/i.test(longBlocks[longBlocks.length - 1].blocked.message),
        'the third rejected attempt should escalate to a temporary mute');
    const mute = activeChatMute(bucket, T0 + 16 * 1000);
    assert(mute && mute.retryAfter > 0, 'an active mute must reject the next attempt');

    // A genuinely different long message is untouched.
    const different = evaluateChatSpam(
        { rep: '', dups: '', strikes: [], muteUntil: 0 },
        'The quick brown fox jumps over the lazy dog while the kettle boils and the radio plays a song about rain.',
        T0 + 5000,
        false
    );
    assert(!different.blocked, 'a different long message must not be blocked');

    // Stretched variants share a token-set fingerprint: USSRRR... vs USSRRRRR...
    const stretchedA = evaluateChatSpam({ rep: '', dups: '', strikes: [], muteUntil: 0 }, 'USSR' + 'R'.repeat(120), T0, false);
    const stretchedB = evaluateChatSpam(
        { rep: stretchedA.rep, dups: stretchedA.dups, strikes: stretchedA.strikes, muteUntil: stretchedA.muteUntil },
        'USSR' + 'R'.repeat(200),
        T0 + 2000,
        false
    );
    assert(!stretchedA.blocked, 'first stretched variant must pass');
    assert(stretchedB.blocked, 'a stretched repeat of the same word must be blocked');

    // Hashes only: no message text, and the ring stays compact.
    assert(bucket.dups.indexOf('Союз') === -1 && bucket.dups.indexOf('USSR') === -1,
        'long-duplicate state must not contain message text');
    assert(bucket.dups.length < 1200, 'long-duplicate ring must stay compact, got ' + bucket.dups.length + ' chars');

    /* ---------------------------------------------------------------- */
    /* 6. Client mirror (js/spam-guard.js) agrees with the worker       */
    /* ---------------------------------------------------------------- */
    const vm = require('vm');
    const readFileSync = require('fs').readFileSync;
    let clock = T0;
    const store = {};
    const sandbox = {
        window: {
            localStorage: {
                getItem: k => (k in store ? store[k] : null),
                setItem: (k, v) => { store[k] = String(v); }
            }
        },
        // The guard only ever calls Date.now()
        Date: { now: () => clock },
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync('js/spam-guard.js', 'utf8'), sandbox);
    const client = sandbox.window;

    clock = T0;
    let clientBlocked = 0;
    let clientQueued = [];
    for (const [offsetMin, text] of flood) {
        clock = T0 + offsetMin * MIN;
        const out = client.rekindleChatSpamCheck(text);
        if (out.blocked) {
            assert(out.message && out.message.length > 10, 'client block must explain itself');
            clientBlocked++;
        } else {
            clientQueued.push(text);
            client.rekindleRecordChatMessage(text);
        }
    }
    assert(clientBlocked >= 8, 'client mirror should block most of the flood, blocked ' + clientBlocked);
    assert(clientQueued.length >= 3, 'client mirror must let normal messages through');

    // The client mirror must also catch the interleaved long paste.
    clock = T0;
    let clientLongBlocked = 0;
    for (const [sec, text] of interleaved) {
        clock = T0 + sec * 1000;
        const out = client.rekindleChatSpamCheck(text);
        if (out.blocked) {
            clientLongBlocked++;
        } else {
            client.rekindleRecordChatMessage(text);
        }
    }
    assert(clientLongBlocked >= 3, 'client mirror should block the repeated long paste, blocked ' + clientLongBlocked);
    assert(!client.rekindleChatSpamCheck(
        'A totally different long message about books, weather, trains and the price of tea in the shops today.'
    ).blocked, 'client mirror must not block a different long message');

    // The client mirror must not block a fresh device's first messages.
    const fresh = vm.createContext({
        window: { localStorage: { getItem: () => null, setItem: () => {} } },
        Date: { now: () => T0 },
        console
    });
    vm.runInContext(readFileSync('js/spam-guard.js', 'utf8'), fresh);
    assert(!fresh.window.rekindleChatSpamCheck('hello').blocked, 'first-ever message must never be blocked');

    console.log('PASS - chat repetition guard');
    console.log('  worker flood: ' + blocked.length + ' blocked / ' + allowed.length + ' allowed');
    console.log('  client flood: ' + clientBlocked + ' blocked / ' + clientQueued.length + ' allowed');
    blocked.slice(0, 6).forEach(b => console.log('    blocked: ' + JSON.stringify(b.text.slice(0, 60))));
})().catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
});
