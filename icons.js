// ReKindle App Definitions & Icons
// Registry of all applications and their SVG icons.

const APPS = [
    // --- ESSENTIALS ---
    {
        id: 'browser',
        name: 'Browser',
        cat: 'essentials',
        icon: '<circle cx="16" cy="16" r="14"/><path d="M2 16 H30"/><path d="M16 2 C22 10 22 22 16 30"/><path d="M16 2 C10 10 10 22 16 30"/>'
    },
    {
        id: 'calendar',
        name: 'Calendar',
        cat: 'essentials',
        icon: '<rect x="4" y="8" width="24" height="22"/><rect x="4" y="8" width="24" height="6" fill="black" stroke="none"/><text x="16" y="26" font-size="14" text-anchor="middle" fill="black" stroke="none">25</text>'
    },
    {
        id: 'contacts',
        name: 'Contacts',
        cat: 'essentials',
        icon: '<rect x="4" y="6" width="24" height="20"/><line x1="8" y1="6" x2="8" y2="26"/><rect x="12" y="10" width="12" height="10" fill="none" stroke="black"/><circle cx="18" cy="14" r="2.5" fill="black"/><path d="M14 20 Q18 24 22 20" fill="black"/>'
    },
    {
        id: 'newspaper',
        name: 'News',
        cat: 'essentials',
        icon: '<rect x="4" y="4" width="24" height="24"/><line x1="8" y1="10" x2="24" y2="10"/><rect x="19" y="14" width="6" height="6" fill="black" stroke="none"/>'
    },
    {
        id: 'stocks',
        name: 'Stocks',
        cat: 'essentials',
        icon: '<rect x="4" y="4" width="24" height="24"/><polyline points="6 22 12 16 18 20 26 10"/>'
    },
    {
        id: 'weather',
        name: 'Weather',
        cat: 'essentials',
        icon: '<circle cx="16" cy="16" r="7" stroke-width="2"/><path d="M16 4v2M16 26v2M4 16h2M26 16h2M7.5 7.5l1.4 1.4M23 23l1.4 1.4M23 9l1.4-1.4M9 23l-1.4 1.4" stroke-width="2"/>'
    },

    // --- TOOLS ---
    {
        id: 'chat',
        name: 'AI Assistant',
        cat: 'tools',
        icon: '<path d="M16 3 L19 11 L27 14 L19 17 L16 25 L13 17 L5 14 L13 11 Z M10 6 L12 10 L16 11 L12 12 L10 16 L8 12 L4 11 L8 10 Z" fill="black" stroke="none"/>'
    },
    {
        id: 'maps',
        name: 'Maps',
        cat: 'tools',
        icon: '<path d="M4 8 L10 4 L22 8 L28 4 V24 L22 28 L10 24 L4 28 Z"/><line x1="10" y1="4" x2="10" y2="24"/><line x1="22" y1="8" x2="22" y2="28"/>'
    },
    {
        id: 'calculator',
        name: 'Calculator',
        cat: 'tools',
        icon: '<rect x="6" y="4" width="20" height="24"/><rect x="10" y="8" width="12" height="6" fill="black" stroke="none"/>'
    },
    {
        id: 'converter',
        name: 'Converter',
        cat: 'tools',
        icon: '<path d="M6 12 H26 L22 8 M26 20 H6 L10 24" stroke-width="2" />'
    },
    {
        id: 'countdown',
        name: 'Countdown',
        cat: 'tools',
        icon: '<rect x="4" y="6" width="24" height="20"/><text x="16" y="24" font-size="10" text-anchor="middle" stroke="none" fill="black">00</text>'
    },
    /*     {
            id: 'einksites',
            name: 'E-ink Sites',
            cat: 'tools',
            icon: '<rect x="5" y="5" width="22" height="22" rx="2" stroke="black" stroke-width="2" fill="none"/><line x1="9" y1="10" x2="23" y2="10" stroke="black" stroke-width="2"/><line x1="9" y1="16" x2="23" y2="16" stroke="black" stroke-width="2"/><line x1="9" y1="22" x2="17" y2="22" stroke="black" stroke-width="2"/>'
        }, */
    {
        id: 'flashcards',
        name: 'Flashcards',
        cat: 'tools',
        icon: '<rect x="6" y="8" width="20" height="14" fill="white" stroke="black" stroke-width="2"/><rect x="8" y="10" width="20" height="14" fill="white" stroke="black" stroke-width="2"/><text x="18" y="21" font-size="10" text-anchor="middle" stroke="none" fill="black">A</text>'
    },
    {
        id: 'pomodoro',
        name: 'Focus Timer',
        cat: 'tools',
        icon: '<circle cx="16" cy="18" r="10" stroke-width="2" /> <path d="M16 18 V8 M16 8 L20 4 M16 8 L12 4" stroke-width="2"/>'
    },
    {
        id: 'notes',
        name: 'Notes',
        cat: 'tools',
        icon: '<path d="M6 4h16l6 6v18h-22z"/><polyline points="22 4 22 10 28 10"/>'
    },
    {
        id: 'tasks',
        name: 'Tasks',
        cat: 'tools',
        icon: '<rect x="6" y="4" width="20" height="24"/><polyline points="9 10 11 12 15 8" fill="none" stroke="black"/><line x1="18" y1="10" x2="22" y2="10"/><polyline points="9 18 11 20 15 16" fill="none" stroke="black"/><line x1="18" y1="18" x2="22" y2="18"/>'
    },
    {
        id: 'teleprompter',
        name: 'Teleprompter',
        icon: '<path d="M16 18 L 12 28 H 20 Z M10 12 H 22 V 18 H 10 Z M8 4 H 24 V 12 H 8 Z M10 6 H 22 M10 9 H 22" />',
        cat: 'tools',
        desc: 'Display notes line-by-line for speeches or practice.'
    },
    {
        id: 'quicktodo',
        name: 'Quick ToDo',
        es6: true,
        cat: 'tools',
        desc: 'Handwritten, sync-able todos!',
        icon: '<rect x="6" y="4" width="20" height="24" fill="white" stroke="black" stroke-width="2"/><path d="M9 10l3 3 7-7" fill="none" stroke="black" stroke-width="2"/><line x1="9" y1="18" x2="23" y2="18" stroke="black" stroke-width="2"/><line x1="9" y1="24" x2="18" y2="24" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'translate',
        name: 'Translator',
        cat: 'tools',
        icon: '<rect x="4" y="6" width="14" height="12" fill="white"/><text x="11" y="15" font-size="10" text-anchor="middle" stroke="none" fill="black">A</text><rect x="14" y="14" width="14" height="12" fill="black"/><text x="21" y="23" font-size="10" text-anchor="middle" stroke="none" fill="white">文</text>'
    },
    {
        id: 'clocks',
        name: 'Clock',
        cat: 'tools',
        icon: '<circle cx="16" cy="16" r="14" stroke="black" stroke-width="2" fill="none"/><line x1="16" y1="16" x2="16" y2="6" stroke-width="2"/><line x1="16" y1="16" x2="23" y2="16" stroke-width="2"/>'
    },
    {
        id: 'breathing',
        name: 'Breathing',
        cat: 'tools',
        icon: '<circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="5" fill="black"/>'
    },
    {
        id: 'dictionary',
        name: 'Dictionary',
        cat: 'tools',
        icon: '<rect x="6" y="4" width="20" height="24"/><text x="16" y="22" font-size="14" text-anchor="middle" stroke="none" fill="black" font-family="serif" font-weight="bold">Az</text>'
    },
    {
        id: 'airtype',
        name: 'AirType',
        cat: 'tools',
        featured: true,
        featuredOrder: 5,
        desc: 'Phone-based typewriter',
        icon: '<path d="M4 24 L 28 12 L 4 4 L 10 14 L 4 24 Z M 10 14 L 28 12" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/>'
    },

    // --- LIFESTYLE ---
    {
        id: 'libby',
        name: 'Libby',
        cat: 'lifestyle',
        beta: true,
        desc: 'Library books',
        icon: '<path d="M6 6 C6 6, 12 4, 16 6 C 20 4, 26 6, 26 6 V 26 C 26 26, 20 24, 16 26 C 12 24, 6 26, 6 26 Z M16 6 V 26" fill="none" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'kindlechat',
        name: 'KindleChat',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 4,
        desc: 'Now with more pixels!',
        icon: '<rect x="4" y="6" width="24" height="16"/><path d="M8 22 L8 28 L14 22"/>'
    },
    {
        id: 'reader',
        name: 'Reader',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 1,
        desc: 'Free reading!',
        icon: '<path d="M6 4 h18 v24 h-18 z M6 4 l-2 2 v24 l2 -2 M24 4 l2 2 v24 l-2 -2" fill="none" stroke="black" stroke-width="2"/><line x1="10" y1="10" x2="20" y2="10"/><line x1="10" y1="14" x2="20" y2="14"/><line x1="10" y1="18" x2="20" y2="18"/>'
    },
    {
        id: 'interactive',
        name: 'Interactive Reader',
        cat: 'lifestyle',
        beta: true,
        featured: true,
        featuredOrder: 2,
        desc: 'Choose Your Own Adventure',
        icon: '<path d="M6 4 h18 v24 h-18 z" fill="none" stroke="black" stroke-width="2"/><line x1="6" y1="4" x2="4" y2="6"/><line x1="4" y1="6" x2="4" y2="28"/><line x1="4" y1="28" x2="6" y2="26"/><path d="M10 16 L21 16 M18 13 L21 16 L18 19" stroke="black" stroke-width="1.5" fill="none"/><path d="M10 16 Q13 16 18 8 M14 9 L18 8 L17 11" stroke="black" stroke-width="1.5" fill="none"/><path d="M10 16 Q13 16 18 24 M14 23 L18 24 L17 21" stroke="black" stroke-width="1.5" fill="none"/>'
    },
    {
        id: 'epub',
        name: 'ePub',
        cat: 'lifestyle',
        desc: 'Add books from a URL',
        icon: '<path d="M6 4 h18 v24 h-18 z M6 4 l-2 2 v24 l2 -2 M24 4 l2 2 v24 l-2 -2" fill="none" stroke="black" stroke-width="2"/><path d="M15 12 v8 M11 16 h8" stroke="black" stroke-width="2" fill="none"/>'
    },
    {
        id: 'standardebooks',
        name: 'Standard eBooks',
        cat: 'lifestyle',
        beta: true,
        desc: 'Free, high quality ebooks',
        icon: '<rect x="8" y="4" width="18" height="24" rx="1" stroke="black" stroke-width="2" fill="none"/><line x1="12" y1="4" x2="12" y2="28" stroke="black" stroke-width="2"/><rect x="14" y="8" width="10" height="4" fill="black"/>'
    },
    {
        id: 'cookbook',
        name: 'Cookbook',
        cat: 'lifestyle',
        icon: '<path d="M9 14 C 4 14, 4 6, 10 6 C 10 2, 16 2, 18 4 C 24 4, 24 10, 22 14 L 22 20 L 9 20 Z"/>'
    },
    {
        id: 'streak',
        name: 'Habit Tracker',
        cat: 'lifestyle',
        icon: '<rect x="4" y="12" width="10" height="8"/><rect x="18" y="12" width="10" height="8"/><line x1="14" y1="16" x2="18" y2="16"/>'
    },
    {
        id: 'history',
        name: 'On This Day',
        cat: 'lifestyle',
        icon: '<path d="M6 6 Q16 2 26 6 V26 Q16 22 6 26 Z"/>'
    },
    {
        id: 'books',
        name: 'Reading List',
        cat: 'lifestyle',
        icon: '<rect x="6" y="4" width="20" height="24"/><line x1="6" y1="8" x2="26" y2="8"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="10" y1="16" x2="22" y2="16"/><line x1="10" y1="20" x2="22" y2="20"/>'
    },
    {
        id: 'reading',
        name: 'Reading Log',
        cat: 'lifestyle',
        icon: '<rect x="6" y="4" width="20" height="24"/><line x1="10" y1="8" x2="22" y2="8"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="10" y1="16" x2="18" y2="16"/><polyline points="17 23 21 25 23 19" fill="none" stroke="black" stroke-width="2" transform="rotate(10, 16, 20)"/>'
    },
    {
        id: 'reddit',
        name: 'Reddit',
        cat: 'lifestyle',
        icon: '<circle cx="16" cy="16" r="14"/><ellipse cx="16" cy="18" rx="10" ry="7"/><circle cx="12" cy="17" r="2" fill="black"/><circle cx="20" cy="17" r="2" fill="black"/><path d="M16 11 L20 6"/>'
    },
    {
        id: 'rssreader',
        name: 'RSS Reader',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 3,
        desc: 'Stay in the know',
        icon: '<circle cx="6" cy="26" r="3" fill="black"/><path d="M6 18 A 8 8 0 0 1 14 26 M6 10 A 16 16 0 0 1 22 26" fill="none" stroke="black" stroke-width="3" stroke-linecap="round"/>'
    },
    {
        id: 'mindmap',
        name: 'Mindmap',
        icon: '<path d="M16 4a4 4 0 100 8a4 4 0 100-8zM8 20a4 4 0 100 8a4 4 0 100-8zM24 20a4 4 0 100 8a4 4 0 100-8zM16 8v12M16 20L8 24M16 20L24 24"/>',
        cat: 'tools',
        featured: true,
        featuredOrder: 6,
        desc: 'Visually organize your ideas.'
    },
    {
        id: 'napkin',
        name: 'Sketchpad',
        cat: 'lifestyle',
        icon: '<path d="M22 6 L26 10 L14 22 L10 22 L10 18 Z"/><line x1="19" y1="9" x2="23" y2="13"/><path d="M10 22 L6 26"/>'
    },
    {
        id: 'pixel',
        name: 'Pixel',
        cat: 'tools',
        desc: 'A 1-bit pixel art canvas.',
        icon: '<rect x="4" y="4" width="24" height="24" fill="none" stroke="black" stroke-width="2"/><rect x="8" y="8" width="4" height="4" fill="black"/><rect x="20" y="12" width="4" height="4" fill="black"/><rect x="12" y="20" width="4" height="4" fill="black"/>'
    },
    {
        id: 'wikipedia',
        name: 'Wikipedia',
        cat: 'lifestyle',
        icon: '<circle cx="16" cy="16" r="14"/><text x="16" y="23" font-size="22" text-anchor="middle" stroke="none" fill="black" font-weight="bold">W</text>'
    },
    {
        id: 'sheetmusic',
        name: 'Sheet Music',
        cat: 'lifestyle',
        desc: 'Browse a library of public domain scores.',
        icon: '<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h8V3h-8z"/>'
    },
    {
        id: 'chords',
        name: 'Chords',
        cat: 'lifestyle',
        beta: true,
        desc: 'Search and save guitar tabs.',
        icon: '<path d="M10 22 V 6 L 26 2 V 18 M 10 6 L 26 2" fill="none" stroke="black" stroke-width="2"/><ellipse cx="7" cy="22" rx="3.5" ry="2.5" fill="black" transform="rotate(-30, 7, 22)"/><ellipse cx="23" cy="18" rx="3.5" ry="2.5" fill="black" transform="rotate(-30, 23, 18)"/>'
    },

    {
        id: 'discord',
        name: 'Discord',
        cat: 'lifestyle',
        desc: 'Join our community!',
        icon: '<g transform="translate(3, 6) scale(0.1)"><path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z" fill="black" stroke="none"/></g>'
    },

    // --- GAMES ---
    {
        id: 'trivia',
        name: 'Trivia',
        cat: 'games',
        icon: '<path d="M16 26c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0-24C11.5 2 8 5.5 8 10h4c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.9-1.2 3.6-2.9 4.3L15 15.6V18h2v-1.7l2.8-1.5C21.7 13.7 24 11.2 24 10c0-4.5-3.5-8-8-8z"/>'
    },
    {
        id: 'pool',
        name: '8 Ball',
        cat: 'games',
        beta: true,
        icon: '<circle cx="16" cy="16" r="14" fill="none" stroke="black" stroke-width="2"/><text x="16" y="21" font-size="14" font-weight="bold" text-anchor="middle" fill="black">8</text>'
    },
    {
        id: '2048',
        name: '2048',
        es6: true,
        cat: 'games',
        icon: '<rect x="2" y="2" width="28" height="28" fill="white" stroke="black" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="30" stroke="black" stroke-width="2"/><line x1="2" y1="16" x2="30" y2="16" stroke="black" stroke-width="2"/><text x="9" y="13" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black">2</text><text x="23" y="13" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black">0</text><text x="9" y="27" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black">4</text><text x="23" y="27" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black">8</text>'
    },
    {
        id: 'anagrams',
        name: 'Anagrams',
        cat: 'games',
        icon: '<rect x="4" y="10" width="10" height="10"/><rect x="18" y="10" width="10" height="10"/><path d="M8 24 q8 6 16 0"/>'
    },
    {
        id: 'blackjack',
        name: 'Blackjack',
        cat: 'games',
        icon: '<rect x="6" y="6" width="14" height="18" rx="2" fill="white" stroke="black" stroke-width="2" transform="rotate(-10 13 15)"/><text x="11" y="18" font-size="10" font-weight="bold" transform="rotate(-10 13 15)">A♠</text><rect x="14" y="8" width="14" height="18" rx="2" fill="black" stroke="white" stroke-width="1" transform="rotate(10 21 17)"/><text x="19" y="20" font-size="10" font-weight="bold" fill="white" transform="rotate(10 21 17)">J</text>'
    },
    {
        id: 'checkers',
        name: 'Checkers',
        cat: 'games',
        icon: '<circle cx="16" cy="16" r="10" fill="white" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'chess', // <-- THIS IS THE SINGLE PLAYER CHESS ID
        name: 'Chess',
        cat: 'games',
        icon: '<path d="M22 26 H10 V23 H22 V26 M12 23 L13 15 C12 13 11 11 12 9 C13 5 17 4 20 5 C22 6 23 8 23 8 L21 12 L21 23 H12" fill="black" stroke="black" stroke-width="1" stroke-linejoin="round"/>' // <-- This icon is now a King/Queen (Black Piece)
    },
    {
        id: 'codebreaker',
        name: 'Codebreaker',
        cat: 'games',
        icon: '<rect x="6" y="6" width="20" height="20" fill="none" stroke="black" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="black"/><circle cx="20" cy="12" r="3" fill="none" stroke="black" stroke-width="1.5"/><circle cx="12" cy="20" r="3" fill="none" stroke="black" stroke-width="1.5"/><circle cx="20" cy="20" r="3" fill="black"/>'
    },
    {
        id: 'crossword',
        name: 'Crossword',
        cat: 'games',
        icon: '<rect x="2" y="2" width="28" height="28" fill="white" stroke="black" stroke-width="2"/><rect x="2" y="2" width="10" height="10" fill="black"/><rect x="20" y="20" width="10" height="10" fill="black"/><rect x="11" y="11" width="10" height="10" fill="black"/>'
    },
    {
        id: 'hangman',
        name: 'Hangman',
        cat: 'games',
        icon: '<line x1="8" y1="28" x2="8" y2="4"/><line x1="8" y1="4" x2="20" y2="4"/><line x1="20" y1="4" x2="20" y2="8"/>'
    },
    {
        id: 'hanoi',
        name: 'Tower of Hanoi',
        cat: 'games',
        icon: '<rect x="6" y="24" width="20" height="2" fill="black"/><rect x="8" y="20" width="16" height="4" fill="white" stroke="black" stroke-width="2"/><rect x="10" y="16" width="12" height="4" fill="white" stroke="black" stroke-width="2"/><rect x="12" y="12" width="8" height="4" fill="white" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'lightsout',
        name: 'Lights Out',
        cat: 'games',
        icon: '<rect x="4" y="4" width="24" height="24" fill="none" stroke="black" stroke-width="2"/><rect x="14" y="14" width="4" height="4" fill="black"/><rect x="14" y="6" width="4" height="4" fill="black"/><rect x="14" y="22" width="4" height="4" fill="black"/><rect x="6" y="14" width="4" height="4" fill="black"/><rect x="22" y="14" width="4" height="4" fill="black"/>'
    },
    {
        id: 'jigsaw',
        name: 'Jigsaw',
        es6: true,
        cat: 'games',
        icon: '<path d="M10 4 h12 v8 h4 v12 h-12 v-4 h-8 v-12 h4 v-4 z"/><circle cx="16" cy="12" r="2"/>'
    },
    {
        id: 'memory',
        name: 'Memory',
        es6: true,
        cat: 'games',
        icon: '<rect x="4" y="4" width="10" height="10" fill="black" stroke="none"/><rect x="18" y="18" width="10" height="10" fill="black" stroke="none"/>'
    },
    {
        id: 'minesweeper',
        cat: 'games',
        name: 'Minesweeper',
        es6: true,
        icon: '<circle cx="16" cy="16" r="8" fill="black"/><line x1="16" y1="4" x2="16" y2="8"/><line x1="16" y1="24" x2="16" y2="28"/><line x1="4" y1="16" x2="8" y2="16"/><line x1="24" y1="16" x2="28" y2="16"/>'
    },
    {
        id: 'mini',
        name: 'Mini Crossword',
        cat: 'games',
        icon: '<rect x="6" y="6" width="20" height="20" fill="white" stroke="black" stroke-width="2"/><rect x="6" y="6" width="8" height="8" fill="black"/><rect x="18" y="18" width="8" height="8" fill="black"/>'
    },
    {
        id: 'nerdle',
        name: 'Nerdle',
        cat: 'games',
        icon: '<rect x="4" y="6" width="24" height="20" rx="2" stroke="black" stroke-width="2" fill="none"/><text x="16" y="20" font-size="9" font-family="monospace" text-anchor="middle">1+2=3</text>'
    },
    {
        id: 'nonograms',
        name: 'Nonograms',
        es6: true,
        cat: 'games',
        icon: '<rect x="6" y="6" width="20" height="20" fill="none" stroke="black" stroke-width="2"/><line x1="11" y1="6" x2="11" y2="26"/><line x1="21" y1="6" x2="21" y2="26"/><line x1="6" y1="11" x2="26" y2="11"/><line x1="6" y1="21" x2="26" y2="21"/>'
    },
    {
        id: 'words',
        name: 'Scrabble',
        es6: true,
        cat: 'games',
        icon: '<rect x="4" y="10" width="10" height="12" fill="white"/><text x="9" y="19" font-size="10" text-anchor="middle" stroke="none" fill="black" font-weight="bold">S</text><rect x="16" y="8" width="10" height="12" fill="black" stroke="none"/><text x="21" y="17" font-size="10" text-anchor="middle" stroke="none" fill="white" font-weight="bold">W</text>'
    },
    {
        id: 'snake',
        name: 'Snake',
        cat: 'games',
        icon: '<path d="M6 26 l 6 0 l 0 -10 l 12 0 l 0 6 l 4 0" fill="none" stroke="black" stroke-width="4" stroke-linecap="round"/><circle cx="28" cy="22" r="2.5" fill="black"/>'
    },
    {
        id: 'solitaire',
        name: 'Solitaire',
        cat: 'games',
        icon: '<rect x="8" y="4" width="16" height="24" rx="2"/><path d="M16 10 L13 16 H19 Z M16 16 L19 20 L16 24 L13 20 Z" fill="black" stroke="none"/>'
    },
    {
        id: 'spellbound',
        name: 'Spelling Bee',
        cat: 'games',
        icon: '<path d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z"/><circle cx="16" cy="16" r="4" fill="black"/>'
    },
    {
        id: 'sudoku',
        name: 'Sudoku',
        es6: true,
        cat: 'games',
        icon: '<rect x="2" y="2" width="28" height="28" fill="none" stroke="black" stroke-width="2"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="black" stroke-width="1"/><text x="16" y="19" font-size="10" font-family="monospace" text-anchor="middle">9</text>'
    },
    {
        id: 'tetris',
        name: 'Blocks',
        cat: 'games',
        icon: '<path d="M6 10 h10 v10 h-10 z" fill="none" stroke="black" stroke-width="2"/><path d="M16 20 h10 v10 h-10 z" fill="black" stroke="none"/><path d="M16 10 h10 v10 h-10 z" fill="none" stroke="black" stroke-width="2"/>'
    },
    /*     {
            id: 'life',
            name: 'Life',
            icon: '<path d="M16 8 h4 v4 h-4z M20 12 h4 v4 h-4z M12 16 h4 v4 h-4z M16 16 h4 v4 h-4z M20 16 h4 v4 h-4z" fill="currentColor"/>',
            cat: 'games',
            desc: "Conway's cellular automaton. A classic toy that creates fascinating patterns.",
        }, */
    {
        id: 'wordsearch',
        name: 'Word Search',
        cat: 'games',
        icon: '<text x="4" y="10" font-size="8" font-family="monospace">S E A</text><text x="4" y="19" font-size="8" font-family="monospace">R C H</text><text x="4" y="28" font-size="8" font-family="monospace">K E Y</text><rect x="2" y="4" width="28" height="7" rx="3" stroke="black" stroke-width="1.5" fill="none"/>'
    },
    {
        id: 'wordle',
        name: 'Wordle',
        cat: 'games',
        icon: '<rect x="2" y="2" width="12" height="12"/><rect x="18" y="18" width="12" height="12" fill="black" stroke="none"/>'
    },
    {
        id: 'bindings',
        name: 'Connections',
        es6: true,
        cat: 'games',
        icon: '<rect x="6" y="6" width="8" height="8"/><rect x="18" y="18" width="12" height="12" fill="black" stroke="none"/>' // Adjusted icon to be distinct
    },


    // --- TWO PLAYER GAMES ---
    {
        id: '2pbattleships',
        name: 'Battleship',
        cat: 'two_player',
        icon: '<circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="2" fill="black"/>'
    },
    {
        id: '2pcheckers',
        name: 'Checkers 2P',
        cat: 'two_player',
        icon: '<circle cx="14" cy="18" r="7" fill="white" stroke="black" stroke-width="2"/><circle cx="20" cy="14" r="7" fill="black" stroke="black" stroke-width="2"/>'
    },
    {
        id: '2pchess',
        name: 'Chess 2P',
        cat: 'two_player',
        icon: '<g transform="translate(-2, 2) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/></g><g transform="translate(8, 6) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/></g>'
    },
    {
        id: '2pconnect4',
        name: 'Connect 4',
        cat: 'two_player',
        icon: '<rect x="4" y="4" width="24" height="24" fill="none"/><circle cx="10" cy="10" r="3"/><circle cx="22" cy="22" r="3" fill="black"/>'
    },
    {
        id: '2ptictactoe',
        name: 'Tic-Tac-Toe',
        es6: true,
        cat: 'two_player',
        icon: '<line x1="12" y1="6" x2="12" y2="26"/><line x1="20" y1="6" x2="20" y2="26"/><line x1="6" y1="12" x2="26" y2="12"/><line x1="6" y1="20" x2="26" y2="20"/>'
    }
];

// Helper function to check if games are disabled (used by index.html for filtering)
function areGamesDisabled() {
    // Setting is stored as a string "true" or "false"
    return localStorage.getItem('rekindle_disable_games') === 'true';
}