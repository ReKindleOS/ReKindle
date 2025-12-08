// 1. Version Bump
const CACHE_NAME = 'rekindle-os-v7';

// 2. Clean URLs in Cache List (Removed .html from apps)
const ASSETS_TO_CACHE = [
    './',
    './index',  
    './donate.svg',
    './logo.svg',
/* 
    './privacy',
    './manifest.json',
    './icons.js',
    './logo.svg',
    './LICENSE.md',
    // Core System Apps
    './settings',
    './browser',
    // Productivity
    './tasks',
    './calendar',
    './contacts',
    './notes',
    './quicktodo',
    './pomodoro',
    './streak',
    './flashcards',
    // Tools
    './mindmap',
    './calculator',
    './converter',
    './clocks',
    './weather',
    './stocks',
    './countdown',
    './translate',
    './dictionary',
    './maps',
    './chat',
    // Lifestyle & Reading
    './reader',
    './epub',
    './books',
    './rssreader',
    './newspaper',
    './reading',
    './cookbook',
    './reddit',
    './wikipedia',
    './history',
    './einksites',
    './napkin',
    './kindlechat',
    './standardebooks',
    './libby',
    './sheetmusic',
    // Games
    './wordle',
    './crossword',
    './sudoku',
    './solitaire',
    './minesweeper',
    './2048',
    './tetris',
    './snake',
    './chess',
    './blackjack',
    './memory',
    './hangman',
    './anagrams',
    './wordsearch',
    './jigsaw',
    './bindings',
    './spellbound',
    './nerdle',
    './words',
    './breathing',
    './checkers',
    './codebreaker',
    './mini',
    './nonograms',
    // Multiplayer
    './2pchess',
    './2pbattleships',
    './2pconnect4',
    './2ptictactoe',
    './2pcheckers'
*/    
];

// Helper to clean redirected responses (Fixes Safari/Chrome errors)
function cleanResponse(response) {
    if (!response || !response.redirected) return response;

    const body = response.body;
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return cleanResponse(response);
                }
                return fetch(event.request).then(networkResponse => {
                    return cleanResponse(networkResponse);
                });
            })
    );
});