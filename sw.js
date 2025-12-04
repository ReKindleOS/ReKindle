const CACHE_NAME = 'rekindle-os-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icons.js',
    './logo.svg',
    './LICENSE.md',
    // Core System Apps
    './settings.html',
    './browser.html',
    './privacy.html',
    // Productivity
    './tasks.html',
    './calendar.html',
    './contacts.html',
    './notes.html',
    './quicktodo.html',
    './pomodoro.html',
    './streak.html',
    // Tools
    './calculator.html',
    './converter.html',
    './clocks.html',
    './weather.html',
    './stocks.html',
    './countdown.html',
    './translate.html',
    './dictionary.html',
    './maps.html',
    './chat.html',
    // Lifestyle & Reading
    './reader.html',
    './books.html',
    './rssreader.html',
    './newspaper.html',
    './reading.html',
    './cookbook.html',
    './reddit.html',
    './wikipedia.html',
    './history.html',
    './einksites.html',
    './napkin.html',
    './kindlechat.html',
    './standardebooks.html',
    // Games
    './wordle.html',
    './crossword.html',
    './sudoku.html',
    './solitaire.html',
    './minesweeper.html',
    './2048.html',
    './tetris.html',
    './snake.html',
    './chess.html',
    './blackjack.html',
    './memory.html',
    './hangman.html',
    './anagrams.html',
    './wordsearch.html',
    './jigsaw.html',
    './bindings.html',
    './spellbound.html',
    './nerdle.html',
    './words.html',
    './breathing.html',
    // Multiplayer
    './2pchess.html',
    './2pbattleships.html',
    './2pconnect4.html',
    './2ptictactoe.html'
];

// Install Event: Cache all files
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Fetch Event: Serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
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