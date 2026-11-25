/*
 * Sheet Music library render guard.
 *
 * Run: node scripts/test-sheetmusic.js
 *
 * 2026-11-25: opening the Library tab (or searching) threw
 * "fetchComposerImage(...).then is not a function" and fell back to
 * "Error loading library." `fetchComposerImage` returned a bare string/null on
 * a composer-image cache hit but a Promise on a miss, while `displayScores`
 * chained `.then()` unconditionally. The second render (memory hit) and any
 * localStorage hit crashed the whole list.
 *
 * This test pulls the real functions out of sheetmusic.html and runs them
 * against a minimal DOM/localStorage stub, so it fails if a future edit
 * reintroduces the mixed sync/Promise contract, an unguarded cache lookup or
 * `.toLowerCase()` on a missing title/composer.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sheetmusic.html'), 'utf8');

// Pull `function NAME(...) { ... }` out of the page, respecting strings,
// template literals and comments so a brace inside one cannot end it early.
// (Same approach as scripts/test-avatars.js.)
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert(start !== -1, 'sheetmusic.html: missing function ' + name);
    let depth = 0;
    let state = null;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        const c = src[i];
        const next = src[i + 1];
        if (state === '//') {
            if (c === '\n') state = null;
            continue;
        }
        if (state === '/*') {
            if (c === '*' && next === '/') { state = null; i++; }
            continue;
        }
        if (state) {
            if (c === '\\') { i++; continue; }
            if (c === state) state = null;
            continue;
        }
        if (c === '/' && next === '/') { state = '//'; i++; continue; }
        if (c === '/' && next === '*') { state = '/*'; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { state = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('sheetmusic.html: unterminated function ' + name);
}

const helperSource = [
    extractFunction(html, 'cacheComposerImage'),
    extractFunction(html, 'fetchComposerImage'),
    extractFunction(html, 'filterScores'),
    extractFunction(html, 'displayScores')
].join('\n');
assert.ok(/function fetchComposerImage\s*\(/.test(helperSource), 'fetchComposerImage not extracted');

// --- minimal DOM ---
class El {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.style = {};
        this.className = '';
        this.id = '';
        this.innerHTML = '';
        this._text = '';
        this.onclick = null;
        this.disabled = false;
    }
    appendChild(child) { this.children.push(child); return child; }
    set textContent(value) { this._text = String(value); }
    get textContent() { return this._text; }
}

const documentStub = {
    createElement: tag => new El(tag),
    createDocumentFragment: () => new El('#fragment'),
    getElementById: id => (id === 'store-search' ? { value: '' } : null)
};
const windowStub = { t: (key, fallback) => (fallback === undefined ? key : fallback) };

const store = {};
const localStorageStub = {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; }
};
let fetchCalls = 0;
const fetchStub = async () => {
    fetchCalls++;
    return {
        json: async () => ({ query: { pages: { 1: { thumbnail: { source: 'https://img.test/' + fetchCalls + '.jpg' } } } } })
    };
};

function noop() {}

const factory = new Function(
    'document', 'window', 'localStorage', 'fetch', 'scoreListContainer', 'state',
    'viewScore', 'promptRemoveFromLibrary', 'addToLibrary', 'getInstrumentLabel',
    'var currentUser = state.currentUser, currentTab = state.currentTab, libraryIDs = state.libraryIDs,' +
    '    allLoadedScores = state.allLoadedScores, currentFilterInstrument = state.currentFilterInstrument;' +
    'var composerImageCache = {}, pendingImageRequests = {}, IMG_CACHE_MAX = 100,' +
    '    IMG_CACHE_LRU_KEY = "rekindle_img_lru";' +
    helperSource +
    '; return { fetchComposerImage: fetchComposerImage, displayScores: displayScores,' +
    '  filterScores: filterScores, composerImageCache: composerImageCache,' +
    '  setScores: function (s) { allLoadedScores = s; state.allLoadedScores = s; } };'
);

function makeCtx(extra) {
    const state = Object.assign({
        currentUser: null,
        currentTab: 'library',
        libraryIDs: new Set(),
        allLoadedScores: [],
        currentFilterInstrument: 'All'
    }, extra);
    const container = new El('div');
    const api = factory(documentStub, windowStub, localStorageStub, fetchStub, container, state,
        noop, noop, noop, inst => inst || '');
    api.container = container;
    return api;
}

// A real DocumentFragment is replaced by its children when appended; the stub
// keeps it as one node, so unwrap it for card counting.
function cards(ctx) {
    const children = ctx.container.children;
    return (children.length === 1 && children[0].tagName === '#fragment') ? children[0].children : children;
}

const isPromise = value => value && typeof value.then === 'function';
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

(async function main() {
    const checks = [];
    const check = (name, ok) => checks.push([name, !!ok]);
    const run = (name, fn) => {
        try { fn(); check(name, true); } catch (e) { check(name + ' :: ' + e.message, false); }
    };

    // 1. Every fetchComposerImage path returns a Promise.
    let ctx = makeCtx();
    check('null composer returns a Promise', isPromise(ctx.fetchComposerImage(null)));
    check('falsy composer resolves null', (await ctx.fetchComposerImage(null)) === null);
    check('empty composer resolves null', (await ctx.fetchComposerImage('')) === null);
    check('uncached composer returns a Promise', isPromise(ctx.fetchComposerImage('Johann Sebastian Bach')));
    check('uncached composer resolves its URL', (await ctx.fetchComposerImage('Johann Sebastian Bach')) === 'https://img.test/1.jpg');

    ctx = makeCtx();
    ctx.composerImageCache['ludwig van beethoven'] = 'https://img.test/beethoven.jpg';
    const memoryHit = ctx.fetchComposerImage('Ludwig van Beethoven');
    check('memory cache hit returns a Promise', isPromise(memoryHit));
    check('memory cache hit resolves its URL', (await memoryHit) === 'https://img.test/beethoven.jpg');

    ctx = makeCtx();
    store['rekindle_img_johann sebastian bach'] = 'https://img.test/bach.jpg';
    const storageHit = ctx.fetchComposerImage('Johann Sebastian Bach');
    check('localStorage cache hit returns a Promise', isPromise(storageHit));
    check('localStorage cache hit resolves its URL', (await storageHit) === 'https://img.test/bach.jpg');

    // 2. displayScores must survive cached, null and partial composers.
    ctx = makeCtx();
    ctx.composerImageCache['ludwig van beethoven'] = 'https://img.test/beethoven.jpg';
    run('displayScores with a memory-cached composer', () => {
        ctx.displayScores([{ docId: 'd1', id: 'u1', title: 'Fur Elise', composer: 'Ludwig van Beethoven', instrument: 'Piano', url: 'x.mxl' }]);
    });
    await settle();
    check('memory-cached composer renders one card', cards(ctx).length === 1);

    ctx = makeCtx();
    store['rekindle_img_johann sebastian bach'] = 'https://img.test/bach.jpg';
    run('displayScores with a localStorage-cached composer', () => {
        ctx.displayScores([{ docId: 'd2', id: 'u2', title: 'Air', composer: 'Johann Sebastian Bach', instrument: 'Piano', url: 'y.mxl' }]);
    });

    ctx = makeCtx();
    run('displayScores with a null composer', () => {
        ctx.displayScores([{ docId: 'd3', id: 'u3', title: 'My Upload', composer: null, instrument: null, url: 'z.mxl' }]);
    });

    // 3. Search tolerates legacy docs with no title/composer.
    ctx = makeCtx();
    ctx.setScores([{ docId: 'd4', id: 'u4', title: undefined, composer: undefined, instrument: 'Piano' }]);
    run('filterScores with a missing title/composer', () => { ctx.filterScores(); });

    // 4. A mixed library renders every card and delete buttons keep their id.
    ctx = makeCtx({ currentTab: 'library', currentUser: { uid: 'u' } });
    run('displayScores with a mixed library', () => {
        ctx.displayScores([
            { docId: 'a', id: '1', title: 'Canon', composer: 'Johann Pachelbel', instrument: 'Piano' },
            { docId: 'b', id: '2', title: 'Untitled', composer: null, instrument: '' }
        ]);
    });
    await settle();
    const rendered = cards(ctx);
    check('mixed library renders both cards', rendered.length === 2);
    const removeBtn = rendered[1] && rendered[1].children[3] && rendered[1].children[3].children[1];
    check('remove button has a stable id', removeBtn && removeBtn.id === 'remove-b');

    let failed = 0;
    checks.forEach(([name, ok]) => {
        if (!ok) failed++;
        console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name);
    });
    if (failed > 0) {
        console.error(failed + ' of ' + checks.length + ' sheet music checks failed');
        process.exit(1);
    }
    console.log('PASS - sheet music (' + checks.length + ' checks)');
})().catch(err => {
    console.error('FAIL - sheet music harness crashed: ' + (err && err.stack || err));
    process.exit(1);
});
