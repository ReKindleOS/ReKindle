/*
 * Headless harness for oregontrail.html
 * -------------------------------------
 * Stubs the DOM / localStorage / timers, evals the page script, then autoplays
 * whole journeys as a "reasonable player" bot. Reports win rate, death causes,
 * average days/miles, and any thrown errors.
 *
 *   node scripts/test-oregontrail.js [runs] [seed]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.OT_FILE
    ? path.resolve(process.env.OT_FILE)
    : path.join(__dirname, '..', 'oregontrail.html');
const html = fs.readFileSync(HTML, 'utf8');
// Skip the JSON-LD block in the SEO head: it is data, not the game script.
const inline = /<script(?![^>]*src=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!inline) throw new Error('no inline script found');
const code = inline[1];

/* ---------------- seeded RNG ---------------- */
let seed = 1;
function srand(s) { seed = s >>> 0; }
function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}
Math.random = rnd;

/* ---------------- DOM stub ---------------- */
const ctxStub = new Proxy({}, {
    get(target, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        return function () {};
    },
    set(target, prop, value) { target[prop] = value; return true; }
});

function makeClassList() {
    const set = new Set();
    return {
        add(c) { set.add(c); },
        remove(c) { set.delete(c); },
        contains(c) { return set.has(c); },
        toggle(c, force) {
            if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); }
            else if (force) set.add(c); else set.delete(c);
        }
    };
}

const els = new Map();
/* ids that carry class="hidden" in the real markup */
const INIT_HIDDEN = new Set(['modal', 'hunt-overlay', 'scores-overlay']);
function makeEl(id, tag) {
    const el = {
        id, tagName: (tag || 'div').toUpperCase(),
        value: '', disabled: false, onclick: null, style: {}, className: '',
        children: [], parentNode: null, scrollTop: 0, scrollHeight: 0,
        clientWidth: 400, clientHeight: 260, offsetLeft: 0, offsetWidth: 0,
        appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
        removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
        insertBefore(c) { el.appendChild(c); return c; },
        getAttribute(name) { return el._attrs && el._attrs[name] !== undefined ? el._attrs[name] : null; },
        setAttribute(name, v) { el._attrs = el._attrs || {}; el._attrs[name] = String(v); },
        removeAttribute(name) { if (el._attrs) delete el._attrs[name]; },
        addEventListener() {},
        removeEventListener() {},
        getContext() { return ctxStub; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 260 }; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        focus() {}, blur() {},
        click() { if (el.onclick) el.onclick({ preventDefault() {} }); }
    };
    el.classList = makeClassList();
    let _text = '';
    let _html = '';
    Object.defineProperty(el, 'innerText', {
        get() { return _text; },
        set(v) { _text = String(v); el.children.length = 0; }
    });
    Object.defineProperty(el, 'textContent', {
        get() { return _text; },
        set(v) { _text = String(v); }
    });
    Object.defineProperty(el, 'innerHTML', {
        get() { return _html; },
        set(v) { _html = String(v); el.children.length = 0; }
    });
    return el;
}

const document = {
    getElementById(id) {
        if (!els.has(id)) {
            const el = makeEl(id);
            if (INIT_HIDDEN.has(id)) el.classList.add('hidden');
            els.set(id, el);
        }
        return els.get(id);
    },
    createElement(tag) { return makeEl('', tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text), parentNode: null }; },
    querySelectorAll(sel) {
        if (sel === '.month-btn') {
            if (!els.has('__months')) {
                els.set('__months', [3, 4, 5, 6].map(m => {
                    const e = makeEl('month' + m, 'button');
                    e.setAttribute('data-month', String(m));
                    return e;
                }));
            }
            return els.get('__months');
        }
        return [];
    },
    querySelector(sel) {
        if (sel === '.window' || sel === '.window-content') return makeEl(sel, 'div');
        return null;
    },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    body: makeEl('body', 'body'),
    head: makeEl('head', 'head'),
    documentElement: makeEl('html', 'html'),
    currentScript: null,
    readyState: 'complete'
};

const timers = [];
function flushTimers(limit) {
    let n = 0;
    while (timers.length && n++ < (limit || 500)) timers.shift()();
    if (n >= (limit || 500)) throw new Error('timer storm');
}

const store = new Map();
const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
};

const sandbox = {
    console, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Boolean, Array, Object, Error, Set, Map, Promise, RegExp,
    document, localStorage,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    alert() { throw new Error('alert() used'); },
    confirm() { throw new Error('confirm() used'); },
    prompt() { throw new Error('prompt() used'); },
    location: { pathname: '/oregontrail', href: 'http://x/oregontrail' },
    navigator: { userAgent: 'harness' },
    innerWidth: 600,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'oregontrail-inline.js' });

if (typeof sandbox.window.onload !== 'function') throw new Error('window.onload was not assigned');
sandbox.window.onload();

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const G = () => sandbox.G;
const aliveCount = () => G().party.filter(m => m.hp > 0).length;
const modalOpen = () => !$('modal').classList.contains('hidden');
const titleText = () => $('modal-title').innerText || '';
const modalButtons = () => $('modal-buttons').children.filter(b => !b.disabled);
function worstHp() {
    let w = 100;
    for (const m of G().party) if (m.hp > 0 && m.hp < w) w = m.hp;
    return w;
}

function clickModal(index) {
    const btns = modalButtons();
    if (!btns.length) throw new Error('modal open with no buttons: ' + titleText());
    btns[Math.min(index, btns.length - 1)].onclick();
    flushTimers();
}

/* ---------------- player bot ---------------- */
const isHidden = id => $(id).classList.contains('hidden');

function fortShop() {
    const days = aliveCount() * 40;
    if (G().food < days && G().cash > 10) {
        sandbox.fortCart.food = Math.min(days - G().food, 250);
        while (sandbox.fortCost() > G().cash && sandbox.fortCart.food > 0) sandbox.fortCart.food -= 50;
        if (sandbox.fortCart.food > 0) sandbox.fortPurchase();
    }
    if (G().parts < 2 && G().cash >= 30) {
        sandbox.fortCart.parts = 1;
        if (sandbox.fortCost() <= G().cash) sandbox.fortPurchase();
    }
    if (G().clothing < aliveCount() * 2 && G().cash >= 40) {
        sandbox.fortCart.clothing = aliveCount() * 2 - G().clothing;
        if (sandbox.fortCost() <= G().cash) sandbox.fortPurchase();
    }
}
function huntBot() {
    let guard = 0;
    while (sandbox.hunt && !sandbox.hunt.over && guard++ < 60) {
        const beasts = sandbox.hunt.animals;
        if (!beasts.length) { sandbox.huntTick(); continue; }
        let best = beasts[0];
        for (const a of beasts) if (a.meat > best.meat) best = a;
        sandbox.huntFire(best.x + best.w / 2, best.y + 3);
        if (!sandbox.hunt) break;
        sandbox.huntTick();
    }
    if (sandbox.hunt) sandbox.endHunt();
    flushTimers();
}

/* pick the river button: 0 ford, 1 caulk, 2 ferry (if offered), last wait */
function riverButtonIndex() {
    const r = G().river;
    const hasFerry = r.ferry && G().cash >= 8;
    if (hasFerry && r.depth > 3.5) return 2;
    if (r.depth <= 2.5) return 0;
    if (r.depth <= 5) return 1;
    return hasFerry ? 3 : 2; // wait (or wait when ferry is absent)
}

function chooseModal() {
    const title = titleText();
    if (modalOpen() && G().river) { clickModal(riverButtonIndex()); return; }
    if (/dalles/i.test(title)) { clickModal(G().cash >= 10 ? 1 : 0); return; }
    const btns = modalButtons();
    if (!btns.length) throw new Error('empty modal: ' + title);
    const labels = btns.map(b => (b.innerText || '').toLowerCase());
    const refusal = labels.findIndex(l => /no thanks|keep your|stay on|decline/.test(l));
    if (labels.length > 1 && refusal !== -1) { clickModal(refusal === 0 ? 1 : 0); return; }
    clickModal(0);
}

const STATS = { travel: 0, rest: 0, hunt: 0, repair: 0, trade: 0, fort: 0, pace: 0, rations: 0 };
const RECKLESS = process.env.OT_RECKLESS === '1';
const CASUAL = process.env.OT_CASUAL === '1';

function playOne(opts) {
    sandbox.selectProfession(opts.prof);
    sandbox.selectMonth(opts.month);
    sandbox.gotoStore();
    sandbox.startTrail();
    if (!G()) throw new Error('startTrail produced no state');

    let guard = 0;
    let triedTrade = false;
    let minHp = 100;
    while (guard++ < 1200) {
        flushTimers();
        if (!G()) throw new Error('state vanished mid-game');
        if (G().over) break;

        if (modalOpen()) {
            if (/game over|you made it/i.test(titleText())) break;
            chooseModal();
            continue;
        }
        if (!isHidden('screen-fort')) {
            STATS.fort++;
            if (RECKLESS) { sandbox.fortPurchase(); } else { fortShop(); }
            sandbox.leaveFort();
            flushTimers();
            continue;
        }
        if (G().river) {
            // river modal failed to open through the queue
            sandbox.openRiverModal();
            continue;
        }
        if (G().dalles) { sandbox.resolveDalles(G().cash >= 10 ? 'road' : 'raft'); flushTimers(); continue; }

        const alive = aliveCount();
        const foodPerDay = alive * 1.5;
        if (worstHp() < minHp) minHp = worstHp();

        if (G().wagon === 'broken') { STATS.repair++; sandbox.takeAction('repair'); continue; }
        const huntBelow = CASUAL ? 6 : 14;
        const restHp = CASUAL ? 20 : 35;
        const restFatigue = CASUAL ? 85 : 60;
        if (!RECKLESS && G().food < foodPerDay * huntBelow && G().bullets >= 20) { STATS.hunt++; sandbox.openHunt(); huntBot(); continue; }
        if (G().oxen <= 0) {
            if (!triedTrade) {
                triedTrade = true;
                sandbox.takeAction('trade');
                flushTimers();
                if (modalOpen() && !/game over/i.test(titleText())) chooseModal();
            } else {
                STATS.travel++;
        sandbox.takeAction('travel');
            }
            continue;
        }
        triedTrade = false;
        if (!RECKLESS && (G().fatigue > restFatigue || (worstHp() < restHp && G().food > foodPerDay * 5))) { STATS.rest++; sandbox.takeAction('rest'); continue; }
        if (!RECKLESS && G().rations === 0 && G().food < foodPerDay * 30) { STATS.rations++; sandbox.cycleRations(); continue; }
        if (!RECKLESS && G().pace === 0 && G().food > foodPerDay * 35 && G().month <= 4 && G().fatigue < 40) { STATS.pace++; sandbox.cyclePace(); continue; }
        STATS.travel++;
        sandbox.takeAction('travel');
    }

    let score = null;
    const extra = $('modal-extra').innerHTML || '';
    const sm = /stotal[\s\S]*?<\/span><span>(\d+)</.exec(extra);
    if (sm) score = parseInt(sm[1], 10);

    if (guard >= 1200) {
        throw new Error('loop stuck: ' + JSON.stringify({
            day: G().day, miles: Math.floor(G().miles), over: G().over,
            river: !!G().river, dalles: G().dalles, stage: G().stage,
            modal: modalOpen(), title: titleText(), btns: modalButtons().length,
            oxen: G().oxen, food: Math.floor(G().food), wagon: G().wagon,
            parts: G().parts, hp: worstHp(), traded: G().traded
        }));
    }
    return {
        won: G().miles >= sandbox.TARGET,
        days: G().day,
        miles: Math.floor(G().miles),
        alive: aliveCount(),
        minHp: minHp,
        food: Math.floor(G().food),
        oxen: G().oxen,
        lastCause: G().lastCause,
        title: titleText(),
        score: score
    };
}

/* ---------------- edge cases ---------------- */
function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

function freshGame(prof) {
    els.clear();
    store.clear();
    timers.length = 0;
    sandbox.G = null;
    sandbox.hunt = null;
    sandbox.Q = [];
    sandbox.DQ = [];
    sandbox.modalOpen = false;
    sandbox.hideAllOverlays();
    sandbox.initSetup();
    sandbox.selectProfession(prof);
    sandbox.selectMonth(3);
    sandbox.gotoStore();
    sandbox.startTrail();
    assert(sandbox.G && sandbox.G.party.length === 5, 'fresh game started');
}

function edgeCases() {
    // 1. stranded recovery: buying an ox from a trader
    freshGame('carpenter');
    sandbox.G.oxen = 0;
    sandbox.G.cash = 100;
    sandbox.G.food = 10;
    sandbox.G.traded = false;
    sandbox.openTrade();
    assert(modalOpen(), 'trade modal opened');
    assert(/trade/i.test(titleText()), 'trade title');
    const offerText = $('modal-text').innerText;
    assert(/ox/i.test(offerText), 'stranded trade offers an ox: ' + offerText);
    clickModal(0); // Accept
    assert(sandbox.G.oxen === 1, 'ox acquired, oxen=' + sandbox.G.oxen);
    assert(sandbox.G.cash === 60, 'cash spent, cash=' + sandbox.G.cash);
    console.log('ok  stranded trade recovery');

    // 1b. the store cart cannot spend money the profession does not have
    els.clear();
    store.clear();
    sandbox.G = null;
    sandbox.hideAllOverlays();
    sandbox.initSetup();
    sandbox.selectProfession('farmer');
    sandbox.gotoStore();
    for (let i = 0; i < 25; i++) sandbox.cartBump('oxen', 1);
    for (let i = 0; i < 40; i++) sandbox.cartBump('food', 50);
    assert(sandbox.cartTotal() <= 400, 'cart stays inside the farmer budget: ' + sandbox.cartTotal());
    assert(sandbox.cart.oxen <= 10, 'cart respects the oxen cap');
    assert($('store-left').innerText === String(400 - sandbox.cartTotal()) ||
        parseFloat($('store-left').innerText) >= 0, 'store shows money left');
    sandbox.cart.oxen = 0;
    sandbox.renderCart();
    assert($('btn-start-trail').disabled === true, 'cannot start with no oxen');
    sandbox.startTrail();
    assert(sandbox.G === null, 'startTrail refuses an invalid cart');
    console.log('ok  store budget guard');

    // 1c. fort purchase cannot overdraw the purse
    freshGame('banker');
    sandbox.G.cash = 50;
    sandbox.openFort(sandbox.LANDMARKS[3]);
    for (let i = 0; i < 10; i++) sandbox.fortBump('oxen', 1);
    assert(sandbox.fortCost() <= 50, 'fort cart stays inside cash: ' + sandbox.fortCost());
    const cashBefore = sandbox.G.cash;
    const oxBefore = sandbox.G.oxen;
    sandbox.fortPurchase();
    assert(sandbox.G.cash < cashBefore && sandbox.G.oxen > oxBefore, 'fort purchase applied');
    assert(sandbox.G.cash >= 0, 'cash never goes negative');
    console.log('ok  fort budget guard');

    // 2. river: wait lowers the water, ferry costs $8 and crosses
    freshGame('banker');
    sandbox.G.miles = 900;
    sandbox.G.nextLm = 7;      // Green River is next; nothing else can fire
    sandbox.G.cash = 50;
    sandbox.G.river = { name: 'Test River', key: 'green_river', depth: 6, width: 300, ferry: 1 };
    const d0 = sandbox.G.river.depth;
    sandbox.openRiverModal();
    assert(modalOpen(), 'river modal opened');
    clickModal(3); // Wait a Day
    assert(sandbox.G.river && sandbox.G.river.depth < d0, 'wait lowered the river');
    assert(modalOpen() && /test river/i.test(titleText()), 'river modal came back after waiting');
    const cash0 = sandbox.G.cash;
    clickModal(2); // ferry
    assert(sandbox.G.river === null, 'crossed by ferry');
    assert(sandbox.G.cash === cash0 - 8, 'ferry cost $8');
    assert(sandbox.G.nextLm === 8, 'landmark advanced past the river, nextLm=' + sandbox.G.nextLm);
    console.log('ok  river wait + ferry');

    // 3. save / resume
    freshGame('farmer');
    sandbox.G.miles = 640; // stand at Fort Laramie
    sandbox.G.food = 123;
    sandbox.save();
    const raw = localStorage.getItem(sandbox.SAVE_KEY);
    assert(!!raw, 'save written');
    sandbox.G = null;
    sandbox.resume(JSON.parse(raw));
    assert(sandbox.G && sandbox.G.food === 123, 'resume restored the state');
    assert(sandbox.G.party.length === 5, 'resume kept the party');
    console.log('ok  save / resume');

    // 3b. resuming while stopped at a fort re-opens the fort store
    freshGame('carpenter');
    sandbox.G.miles = 640;
    sandbox.G.nextLm = 4;      // Fort Laramie
    sandbox.save();
    const fortRaw = localStorage.getItem(sandbox.SAVE_KEY);
    sandbox.G = null;
    sandbox.resume(JSON.parse(fortRaw));
    assert(!isHidden('screen-fort'), 'resume re-opened the fort');
    assert($('fort-name').innerText === 'Fort Laramie', 'fort name restored, got ' + $('fort-name').innerText);
    sandbox.leaveFort();
    assert(isHidden('screen-fort'), 'leaving the fort returns to the trail');
    console.log('ok  resume at fort');

    // 4. restart confirmation
    sandbox.askRestart();
    assert(modalOpen() && /restart/i.test(titleText()), 'restart modal');
    clickModal(0); // Yes
    assert(sandbox.G === null, 'restart cleared the game');
    assert(modalOpen() === false, 'restart closed the modal');
    console.log('ok  restart');

    // 5. win scoring + play again
    freshGame('banker');
    sandbox.G.miles = 2000;
    sandbox.G.month = 8;
    sandbox.G.dom = 10;
    sandbox.G.food = 400;
    sandbox.checkEnd();
    sandbox.processQ();
    assert(modalOpen(), 'win modal opened');
    assert(/made it/i.test(titleText()), 'win title: ' + titleText());
    const html = $('modal-extra').innerHTML;
    assert(/stotal/.test(html), 'score table rendered');
    assert(parseInt(localStorage.getItem(sandbox.HS_KEY) || '0', 10) > 0, 'personal best saved');
    clickModal(0); // Play Again
    assert(sandbox.G === null, 'play again reset the game');
    console.log('ok  win + score + play again');

    // 6. stranded for four days ends the game
    freshGame('carpenter');
    sandbox.G.oxen = 0;
    sandbox.G.cash = 0;
    let n = 0;
    while (sandbox.G && !sandbox.G.over && n++ < 10) {
        sandbox.takeAction('travel');
        flushTimers();
        if (modalOpen()) {
            if (/game over/i.test(titleText())) break;
            clickModal(0);
        }
    }
    assert(sandbox.G && sandbox.G.over === true, 'no-oxen party eventually gives up');
    console.log('ok  stranded game over');
}

/* ---------------- run ---------------- */
const RUNS = parseInt(process.argv[2] || '200', 10);
const SEED = parseInt(process.argv[3] || '12345', 10);
srand(SEED);

if (process.env.OT_EDGE === '1') {
    try {
        edgeCases();
        console.log('EDGE CASES: all passed');
    } catch (e) {
        console.error('EDGE CASES FAILED:', e.message);
        process.exitCode = 1;
    }
    process.exit();
}

const results = [];
const causes = {};
const errors = [];
const profs = process.env.OT_PROF ? [process.env.OT_PROF] : ['banker', 'carpenter', 'farmer'];
const months = process.env.OT_MONTH ? [parseInt(process.env.OT_MONTH, 10)] : [3, 4, 5, 6];

for (let i = 0; i < RUNS; i++) {
    els.clear();
    store.clear();
    timers.length = 0;
    sandbox.G = null;
    sandbox.hunt = null;
    sandbox.Q = [];
    sandbox.DQ = [];
    sandbox.modalOpen = false;
    srand(SEED + i * 7919);

    const opts = { prof: profs[i % 3], month: months[i % 4] };
    try {
        const r = playOne(opts);
        r.prof = opts.prof;
        r.month = opts.month;
        results.push(r);
        if (!r.won) {
            const key = r.title + ' | ' + (r.lastCause || '?');
            causes[key] = (causes[key] || 0) + 1;
        }
    } catch (e) {
        errors.push({ i, opts, msg: e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e) });
        if (errors.length > 5) break;
    }
}

const wins = results.filter(r => r.won).length;
const total = results.length;
const avg = list => list.length ? (list.reduce((a, b) => a + b, 0) / list.length) : 0;
const pct = n => total ? (100 * n / total).toFixed(1) + '%' : 'n/a';

console.log('runs:', total, 'errors:', errors.length);
console.log('wins:', wins, '/', total, '=', pct(wins));
console.log('avg days (all):', avg(results.map(r => r.days)).toFixed(1),
    ' (win):', avg(results.filter(r => r.won).map(r => r.days)).toFixed(1));
console.log('avg survivors (all):', avg(results.map(r => r.alive)).toFixed(2),
    ' (win):', avg(results.filter(r => r.won).map(r => r.alive)).toFixed(2));
console.log('avg food left (win):', avg(results.filter(r => r.won).map(r => r.food)).toFixed(0));
console.log('avg lowest hp:', avg(results.map(r => r.minHp)).toFixed(1));
console.log('score avg/max:', avg(results.filter(r => r.score !== null).map(r => r.score)).toFixed(0),
    Math.max(...results.filter(r => r.score !== null).map(r => r.score), 0));
console.log('by profession:', profs.map(p => {
    const list = results.filter(r => r.prof === p);
    return p + ' ' + list.filter(r => r.won).length + '/' + list.length;
}).join('  '));
console.log('by month:', months.map(m => {
    const list = results.filter(r => r.month === m);
    return m + ' ' + list.filter(r => r.won).length + '/' + list.length;
}).join('  '));
console.log('month days:', months.map(m => {
    const list = results.filter(r => r.month === m);
    return m + ':' + avg(list.map(r => r.days)).toFixed(0) + 'd/' + list.filter(r => r.won).length + '-' + list.length;
}).join('  '));
console.log('loss causes:', causes);
console.log('action mix:', STATS);
if (errors.length) {
    console.log('ERRORS:');
    for (const e of errors) console.log(' -', JSON.stringify(e.opts), e.msg);
    process.exitCode = 1;
}
