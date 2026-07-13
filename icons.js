// ReKindle App Definitions & Icons
// Registry of all applications and their SVG icons.

const APPS = [
    // --- ESSENTIALS ---
    {
        id: 'browser',
        name: 'Browser',
        cat: 'essentials',
        icon: '<circle cx="16" cy="16" r="14"/><path d="M2 16 H30"/><path d="M16 3 C22 10 22 22 16 29"/><path d="M16 3 C10 10 10 22 16 29"/>'
    },
    {
        id: 'calendar',
        name: 'Calendar',
        cat: 'essentials',
        get icon() {
            const date = typeof window.rekindleGetZonedDate === 'function' ? window.rekindleGetZonedDate().getDate() : new Date().getDate();
            return '<rect x="4" y="8" width="24" height="22"/><rect x="4" y="8" width="24" height="6" fill="black" stroke="none"/><text x="16" y="26" font-size="14" text-anchor="middle" fill="black" stroke="none">' + date + '</text>';
        }
    },
    {
        id: 'contacts',
        name: 'Contacts',
        cat: 'essentials',
        icon: '<rect x="4" y="6" width="24" height="20"/><line x1="8" y1="6" x2="8" y2="26"/><rect x="12" y="10" width="12" height="10" fill="none" stroke="black"/><circle cx="18" cy="14" r="2.5" fill="black"/><path d="M14 20 Q18 24 22 20" fill="black"/>'
    },
    {
        id: 'mail',
        name: 'Mail',
        cat: 'essentials',
        featured: true,
        featuredOrder: 3,

        plus: true,
        desc: 'Now supporting all mail!',
        icon: '<rect x="4" y="8" width="24" height="16" rx="2" stroke="black" stroke-width="2" fill="none"/><path d="M4 10 L16 18 L28 10" fill="none" stroke="black" stroke-width="2"/>'
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
    {
        id: 'scores',
        name: 'Scores',
        cat: 'essentials',
        icon: '<path d="M8 8 H24 L21 18 H11 Z" fill="none" stroke="black" stroke-width="2"/><path d="M16 18 V24 M12 24 H20" stroke="black" stroke-width="2"/><path d="M8 10 C4 10 4 15 8 15" fill="none" stroke="black" stroke-width="2"/><path d="M24 10 C28 10 28 15 24 15" fill="none" stroke="black" stroke-width="2"/>'
    },

    // --- TOOLS ---
    {
        id: 'readlater',
        name: 'Read Later',
        cat: 'tools',
        desc: 'Save links for later.',
        icon: '<path d="M8 4 h16 v24 l-8 -6 l-8 6 z" fill="none" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'decide',
        name: 'Decider',
        cat: 'tools',
        icon: '<circle cx="16" cy="18" r="12" fill="white" stroke="black" stroke-width="2"/><path d="M16 6 L16 30 M4 18 L28 18 M7.5 9.5 L24.5 26.5 M24.5 9.5 L7.5 26.5" stroke="black" stroke-width="1"/><path d="M16 2 L13 6 H19 Z" fill="black"/><circle cx="16" cy="18" r="3" fill="black"/>'
    },
    {
        id: 'dropbox',
        name: 'Dropbox',
        cat: 'tools',
        beta: true,
        plus: true,
        icon: '<g transform="translate(4, 4)"><path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 20.371l6.001 3.822 6-3.822-6-3.822L6 20.371z" fill="black"/></g>'
    },
    {
        id: 'chat',
        name: 'AI Assistant',
        cat: 'tools',
        plus: true,
        icon: '<path d="M16 3 L19 11 L27 14 L19 17 L16 25 L13 17 L5 14 L13 11 Z M6 3 L8 7 L12 8 L8 9 L6 13 L4 9 L0 8 L4 7 Z" fill="black" stroke="none"/>'
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
        id: 'files',
        name: 'Files',
        plus: true,
        cat: 'tools',
        // Folder Icon
        icon: '<path d="M4 6 h8 l2 2 h14 v16 h-24 z" fill="white" stroke="black" stroke-width="2"/><line x1="4" y1="11" x2="28" y2="11" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'docs',
        name: 'Docs',
        plus: true,
        cat: 'tools',
        icon: '<path d="M6 4 h14 l6 6 v18 h-20 z" fill="white" stroke="black" stroke-width="2"/><polyline points="20 4 20 10 26 10" fill="none" stroke="black" stroke-width="2"/><line x1="10" y1="14" x2="22" y2="14" stroke="black" stroke-width="2"/><line x1="10" y1="18" x2="22" y2="18" stroke="black" stroke-width="2"/><line x1="10" y1="22" x2="18" y2="22" stroke="black" stroke-width="2"/>'
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
        id: 'timer',
        name: 'Timers',
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
        id: 'journal',
        name: 'Journal',
        cat: 'lifestyle',
        desc: 'Write or draw your thoughts.',
        icon: '<rect x="8" y="4" width="16" height="24" rx="1" stroke="black" stroke-width="2" fill="none"/><line x1="13" y1="4" x2="13" y2="28" stroke="black" stroke-width="2"/><path d="M18 4 v8 l3 -2 l3 2 v-8" fill="black"/>'
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
        icon: '<path d="M16 20 L 12 30 H 20 Z M10 12 H 22 V 18 H 10 Z M8 4 H 24 V 12 H 8 Z M10 6 H 22 M10 9 H 22" />',
        cat: 'tools',
        desc: 'Display notes line-by-line for speeches or practice.'
    },
    {
        id: 'quicktodo',
        name: 'Quick ToDo',
        es6: true,
        cat: 'tools',
        plus: true,
        desc: 'Handwritten, sync-able todos!',
        icon: '<rect x="6" y="4" width="20" height="24" fill="white" stroke="black" stroke-width="2"/><path d="M9 10l3 3 7-7" fill="none" stroke="black" stroke-width="2"/><line x1="9" y1="18" x2="23" y2="18" stroke="black" stroke-width="2"/><line x1="9" y1="24" x2="18" y2="24" stroke="black" stroke-width="2"/><path d="M28 8h2 M28 16h3 M27 24h3" stroke="black" stroke-width="2" stroke-linecap="round"/>'
    },
    /*{
        id: 'quicknotes',
        name: 'Quick Notes',
        cat: 'tools',
        plus: true,
        desc: 'Handwritten notes',
        icon: '<rect x="6" y="4" width="20" height="24" fill="white" stroke="black" stroke-width="2"/><path d="M10 10 H22 M10 16 H22 M10 22 H18" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M28 8h2 M28 16h3 M27 24h3" stroke="black" stroke-width="2" stroke-linecap="round"/>'
    },*/
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
        plus: true,
        desc: 'Phone-based typewriter',
        icon: '<path d="M4 24 L 28 12 L 4 4 L 10 14 L 4 24 Z M 10 14 L 28 12" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/>',
    },

    // --- LIFESTYLE ---
    {
        id: 'bluesky',
        name: 'Bluesky',
        cat: 'lifestyle',
        plus: true,
        desc: 'Social social.',
        icon: '<path d="M16 8 C16 8 20 4 26 6 C28 8 26 14 24 16 C28 18 30 24 26 28 C20 30 16 26 16 26 C16 26 12 30 6 28 C2 24 4 18 8 16 C6 14 4 8 6 6 C12 4 16 8 16 8 Z" fill="white" stroke="black" stroke-width="2"/><path d="M16 8 L16 26" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'language',
        name: 'Languages',
        cat: 'lifestyle',
        beta: true,
        desc: 'Learn a language for free',
        icon: '<path d="M4 6 h14 v12 h-4 l-4 4 v-4 h-6 z" fill="white" stroke="black" stroke-width="2"/><path d="M14 14 h14 v12 h-6 l-4 4 v-4 h-4 z" fill="black" stroke="white" stroke-width="2"/>'
    },
    {
        id: 'neighbourhood',
        name: 'Neighbourhood',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 6,
        desc: 'Post & make connections',
        icon: '<g transform="translate(0, 3)"><rect x="16" y="3" width="2" height="9" fill="black"/><path d="M12 3 L2 12 H5 V22 H19 V12 H22 L12 3 Z" fill="white" stroke="black" stroke-width="2"/><path d="M2 22 H22" stroke="black" stroke-width="2"/></g>'
    },
    {
        id: 'topics',
        name: 'Topics',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 5,
        desc: 'Discuss anything!',
        icon: '<g transform="translate(0, 3)"><path d="M3 3 h18 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 h-6 l-3 3 l-3 -3 h-6 a2 2 0 0 1 -2 -2 v-6 a2 2 0 0 1 2 -2 z" fill="white" stroke="black" stroke-width="2"/><circle cx="5" cy="19" r="3" fill="none" stroke="black" stroke-width="2"/><path d="M2 24 q3 -4 6 0" fill="none" stroke="black" stroke-width="2"/><circle cx="19" cy="19" r="3" fill="none" stroke="black" stroke-width="2"/><path d="M16 24 q3 -4 6 0" fill="none" stroke="black" stroke-width="2"/><circle cx="12" cy="20" r="3" fill="white" stroke="black" stroke-width="2"/><path d="M9 25 q3 -4 6 0" fill="white" stroke="black" stroke-width="2"/></g>'
    },
    {
        id: 'mastodon',
        name: 'Mastodon',
        cat: 'lifestyle',
        plus: true,
        filled: true,
        desc: 'Decentralized social.',
        icon: '<path d="M21.3,4.5c-2.2-1.1-4.7-1.1-6.9-0.2c-0.6-0.3-1.3-0.4-1.9-0.4c-0.7,0-1.4,0.1-2,0.4C8.2,3.4,5.7,3.5,3.5,4.5C1.3,5.6,0,8.5,0,8.5v11c0,3,2.2,5.5,5,5.5h3v-7c0-1.1,0.9-2,2-2s2,0.9,2,2v6h1v-6c0-1.1,0.9-2,2-2s2,0.9,2,2v7h3c2.8,0,5-2.5,5-5.5v-11C25,8.5,23.6,5.6,21.3,4.5z" fill="black"/>'
    },
    /*     {
            id: 'beeper',
            name: 'Beeper',
            cat: 'tools',
            desc: 'Unified Chat Inbox',
            icon: '<rect x="4" y="4" width="24" height="24" rx="4" fill="black"/><path d="M12 8 V24 M12 16 A 4 4 0 0 1 20 16 A 4 4 0 0 1 12 20" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>'
        }, */
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
        icon: '<rect x="4" y="6" width="24" height="16" stroke="black" stroke-width="2" fill="none"/><path d="M8 22 L8 28 L14 22" stroke="black" stroke-width="2" fill="none"/>'
    },
    {
        id: 'reader',
        name: 'Reader',
        cat: 'lifestyle',
        desc: 'Free reading!',
        icon: '<g transform="translate(0, 2)"><path d="M6 4 h18 v24 h-18 z M6 4 l-2 2 v24 l2 -2 M24 4 l2 2 v24 l-2 -2" fill="none" stroke="black" stroke-width="2"/><line x1="10" y1="10" x2="20" y2="10" stroke="black" stroke-width="2"/><line x1="10" y1="14" x2="20" y2="14" stroke="black" stroke-width="2"/><line x1="10" y1="18" x2="20" y2="18" stroke="black" stroke-width="2"/></g>'
    },
    {
        id: 'interactive',
        name: 'Interactive Reader',
        cat: 'lifestyle',
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
    /*     {
            id: 'manga',
            name: 'Manga',
            cat: 'lifestyle',
            desc: 'Read manga and webtoons.',
            icon: '<path d="M6 4 h12 v24 h-12 z M18 4 l8 4 v20 l-8 -4 M18 4 v24" fill="none" stroke="black" stroke-width="2"/><line x1="8" y1="8" x2="16" y2="8" stroke="black" stroke-width="1.5"/><line x1="8" y1="12" x2="16" y2="12" stroke="black" stroke-width="1.5"/><line x1="8" y1="16" x2="14" y2="16" stroke="black" stroke-width="1.5"/>'
        }, */
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
        id: 'life',
        name: 'Life Calendar',
        cat: 'lifestyle',
        icon: '<g><circle cx="6" cy="6" r="3" fill="black"/><circle cx="16" cy="6" r="3" fill="black"/><circle cx="26" cy="6" r="3" fill="black"/><circle cx="6" cy="16" r="3" fill="black"/><circle cx="16" cy="16" r="3" fill="black"/><circle cx="26" cy="16" r="3" fill="none" stroke="black" stroke-width="2"/><circle cx="6" cy="26" r="3" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="26" r="3" fill="none" stroke="black" stroke-width="2"/><circle cx="26" cy="26" r="3" fill="none" stroke="black" stroke-width="2"/></g>',
        desc: 'Memento Mori.'
    },
    {
        id: 'history',
        name: 'On This Day',
        cat: 'lifestyle',
        icon: '<path d="M6 6 Q16 2 26 6 V26 Q16 22 6 26 Z"/>'
    },
    {
        id: 'bible',
        name: 'Scriptures',
        cat: 'lifestyle',
        desc: 'Bible, Quran, Dhammapada & Tao Te Ching.',
        icon: '<rect x="6" y="4" width="20" height="24" rx="2" stroke="black" stroke-width="2" fill="none"/><path d="M16 8 v10 M12 12 h8" stroke="black" stroke-width="2" fill="none"/>'
    },
    {
        id: 'books',
        name: 'Books',
        cat: 'lifestyle',
        icon: '<rect x="6" y="4" width="20" height="24"/><line x1="6" y1="8" x2="26" y2="8"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="10" y1="16" x2="22" y2="16"/><line x1="10" y1="20" x2="22" y2="20"/>'
    },
    {
        id: 'watchlist',
        name: 'Watchlist',
        cat: 'lifestyle',
        icon: '<path d="M22 18 L28 14 V26 L22 22 Z" fill="black"/><rect x="4" y="12" width="18" height="14" rx="2" stroke="black" stroke-width="2" fill="none"/><circle cx="9" cy="8" r="4" stroke="black" stroke-width="2" fill="none"/><circle cx="17" cy="8" r="4" stroke="black" stroke-width="2" fill="none"/><circle cx="9" cy="8" r="1.5" fill="black"/><circle cx="17" cy="8" r="1.5" fill="black"/>'
    },

    {
        id: 'reddit',
        name: 'Reddit',
        cat: 'lifestyle',
        icon: '<circle cx="16" cy="16" r="14"/><ellipse cx="16" cy="18" rx="10" ry="7"/><circle cx="12" cy="17" r="2" fill="black"/><circle cx="20" cy="17" r="2" fill="black"/><path d="M16 11 L20 6"/>'
    },
    {
        id: 'pinterest',
        name: 'Pinterest',
        cat: 'lifestyle',
        plus: true,
        beta: true,
        filled: true,
        desc: 'Browse and save ideas.',
        icon: '<g transform="scale(0.2222)"><path d="M71.9,5.4C35.1,5.4,5.3,35.2,5.3,72c0,28.2,17.5,52.3,42.3,62c-0.6-5.3-1.1-13.3,0.2-19.1c1.2-5.2,7.8-33.1,7.8-33.1s-2-4-2-9.9c0-9.3,5.4-16.2,12-16.2c5.7,0,8.4,4.3,8.4,9.4c0,5.7-3.6,14.3-5.5,22.2c-1.6,6.6,3.3,12,9.9,12c11.8,0,20.9-12.5,20.9-30.5c0-15.9-11.5-27.1-27.8-27.1c-18.9,0-30.1,14.2-30.1,28.9c0,5.7,2.2,11.9,5,15.2c0.5,0.7,0.6,1.2,0.5,1.9c-0.5,2.1-1.6,6.6-1.8,7.5c-0.3,1.2-1,1.5-2.2,0.9c-8.3-3.9-13.5-16-13.5-25.8c0-21,15.3-40.3,44-40.3c23.1,0,41,16.5,41,38.4c0,22.9-14.5,41.4-34.5,41.4c-6.7,0-13.1-3.5-15.3-7.6c0,0-3.3,12.7-4.1,15.8c-1.5,5.8-5.6,13-8.3,17.5c6.2,1.9,12.8,3,19.7,3c36.8,0,66.6-29.8,66.6-66.6C138.5,35.2,108.7,5.4,71.9,5.4z" fill="black"/></g>'
    },
    {
        id: 'rssreader',
        name: 'RSS Reader',
        cat: 'lifestyle',
        featured: true,
        featuredOrder: 1,
        desc: 'Stay in the know',
        icon: '<circle cx="6" cy="26" r="3" fill="black"/><path d="M6 18 A 8 8 0 0 1 14 26 M6 10 A 16 16 0 0 1 22 26" fill="none" stroke="black" stroke-width="3" stroke-linecap="round"/>'
    },
    {
        id: 'substack',
        name: 'Substack',
        cat: 'lifestyle',
        plus: true,
        featured: true,
        filled: true,
        featuredOrder: 2,
        desc: 'Stacks on, Stacks off',
        icon: '<rect x="6" y="5" width="20" height="4" fill="black"/><rect x="6" y="11" width="20" height="4" fill="black"/><path d="M6 17 h20 v11 l-10 -6 l-10 6 z" fill="black"/>'
    },
    {
        id: 'mindmap',
        name: 'Mindmap',
        icon: '<path d="M16 4a4 4 0 100 8a4 4 0 100-8zM8 20a4 4 0 100 8a4 4 0 100-8zM24 20a4 4 0 100 8a4 4 0 100-8zM16 8v12M16 20L8 24M16 20L24 24"/>',
        cat: 'tools',
        desc: 'Visually organize your ideas.'
    },
    {
        id: 'flipbook',
        name: 'Flipbook',
        cat: 'lifestyle',
        plus: true,
        icon: '<rect x="8" y="5" width="20" height="18" fill="white" stroke="black" stroke-width="2"/><rect x="4" y="9" width="20" height="18" fill="white" stroke="black" stroke-width="2"/><circle cx="14" cy="15" r="2" fill="black"/><line x1="14" y1="17" x2="14" y2="21" stroke="black" stroke-width="1.5"/><path d="M11 19 l6 -1" stroke="black" stroke-width="1.5"/><path d="M11 25 l3 -4 l3 4" stroke="black" stroke-width="1.5" fill="none"/>',
        desc: 'Create pixel animations.'
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
        filled: true,
        desc: 'Browse a library of public domain scores.',
        icon: '<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h8V3h-8z" fill="black"/>'
    },
    {
        id: 'chords',
        name: 'Chords',
        cat: 'lifestyle',
        desc: 'Search and save guitar tabs.',
        icon: '<path d="M10 22 V 6 L 26 2 V 18 M 10 6 L 26 2" fill="none" stroke="black" stroke-width="2"/><ellipse cx="7" cy="22" rx="3.5" ry="2.5" fill="black" transform="rotate(-30, 7, 22)"/><ellipse cx="23" cy="18" rx="3.5" ry="2.5" fill="black" transform="rotate(-30, 23, 18)"/>'
    },

    {
        id: 'suggestions',
        name: 'Suggestions',
        cat: 'lifestyle',
        desc: 'Vote on new features!',
        icon: '<circle cx="16" cy="14" r="9" stroke="black" stroke-width="2" fill="none"/><path d="M12 21 h8 l-2 6 h-4 z" fill="black"/><path d="M16 14 v-5 M16 14 l-3 3 M16 14 l3 3" stroke="black" stroke-width="1.5"/><path d="M11 21 L 12 18 L 13 20 L 14 18 L 15 20 L 16 18 L 17 20 L 18 18 L 19 20 L 20 18 L 21 21" stroke="black" stroke-width="1" fill="none"/><path d="M16 2 v-2 M16 2 v0 M7 5 l-1.5 -1.5 M25 5 l1.5 -1.5 M2 14 h2 M28 14 h2 M7 23 l-2 2 M25 23 l2 2" stroke="black" stroke-width="2" stroke-linecap="round"/>' // Globe style with huge rays
    },
    {
        id: 'discord',
        name: 'Discord',
        cat: 'lifestyle',
        desc: 'Join our community!',
        icon: '<g transform="translate(3, 6) scale(0.1)"><path d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z" fill="black" stroke="none"/></g>'
    },

    {
        id: 'photoframe',
        name: 'Photo Frame',
        cat: 'lifestyle',
        plus: true,
        desc: 'Digital photo slideshow.',
        icon: '<rect x="4" y="6" width="24" height="20" fill="none" stroke="black" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="black"/><path d="M4 26 l8 -8 l4 4 l6 -6 l6 6" fill="none" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'food',
        name: 'Food Log',
        cat: 'lifestyle',
        desc: 'Log and track food.',
        icon: '<path d="M 6 20 C 6 6 26 6 26 20 M 2 20 H 30 M 6 20 V 23 H 26 V 20 M 13 7 C 13 3 19 3 19 7" fill="none" stroke="black" stroke-width="2"/>'
    },

    // --- GAMES ---
    /*     {
            id: 'oregontrail',
            name: 'Oregon Trail',
            cat: 'games',
            beta: true,
            desc: 'Travel the trail to Oregon.',
            icon: '<path d="M4 32 C 32 20 0 12 14 2 L 18 2 C 4 12 36 20 28 32 Z" fill="black"/>'
        }, */
    {
        id: 'trivia',
        name: 'Trivia',
        cat: 'games',
        filled: true,
        icon: '<path d="M16 26c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0-24C11.5 2 8 5.5 8 10h4c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.9-1.2 3.6-2.9 4.3L15 15.6V18h2v-1.7l2.8-1.5C21.7 13.7 24 11.2 24 10c0-4.5-3.5-8-8-8z" fill="black"/>'
    },
    {
        id: 'pool',
        name: '8 Ball',
        cat: 'games',
        single: true,
        icon: '<circle cx="16" cy="16" r="14" fill="none" stroke="black" stroke-width="2"/><text x="16" y="21" font-size="14" font-weight="bold" text-anchor="middle" fill="black">8</text>'
    },
    {
        id: '2048',
        name: '2048',
        es6: true,
        cat: 'games',
        icon: '<rect x="2" y="2" width="28" height="28" fill="white" stroke="black" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="30" stroke="black" stroke-width="2"/><line x1="2" y1="16" x2="30" y2="16" stroke="black" stroke-width="2"/><text x="9" y="13" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black" stroke="none" font-weight="bold">2</text><text x="23" y="13" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black" stroke="none" font-weight="bold">0</text><text x="9" y="27" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black" stroke="none" font-weight="bold">4</text><text x="23" y="27" font-size="10" text-anchor="middle" font-family="sans-serif" fill="black" stroke="none" font-weight="bold">8</text>'
    },
    /*     {
            id: 'akinator',
            name: 'Akinator',
            cat: 'games',
            desc: 'The genie guesses your character.',
            new: true,
            icon: '<g transform="scale(0.64)"><path d="M 38.5 5 C 34.921875 5 32 7.921875 32 11.5 C 32 13.394531 32.730469 14.890625 33.675781 15.925781 C 34.621094 16.964844 35.746094 17.582031 36.632813 17.929688 C 38.683594 18.738281 40.15625 19.371094 41.015625 19.90625 C 41.070313 19.941406 41.097656 19.96875 41.144531 20 L 40.171875 20 C 39.949219 20 39.734375 20.074219 39.5625 20.207031 C 37.570313 21.734375 33.492188 22.941406 28.78125 22.988281 C 27.578125 21.097656 25.996094 19.511719 24.21875 18.667969 C 24.699219 18.070313 25 17.320313 25 16.5 C 25 14.578125 23.421875 13 21.5 13 C 19.578125 13 18 14.578125 18 16.5 C 18 17.320313 18.300781 18.066406 18.78125 18.667969 C 16.882813 19.5625 15.214844 21.300781 13.984375 23.359375 C 13.128906 23.664063 12.359375 24.15625 11.734375 24.792969 C 11.714844 24.703125 11.714844 24.621094 11.691406 24.535156 C 11.457031 23.5 11.066406 22.417969 10.324219 21.53125 C 9.582031 20.644531 8.417969 20 7 20 C 5.230469 20 4.0625 21.066406 3.554688 22.03125 C 3.042969 23 3 23.945313 3 23.945313 L 3 24 C 3 25.707031 3.570313 27.097656 4.414063 28.179688 C 5.261719 29.261719 6.347656 30.054688 7.421875 30.816406 C 8.742188 31.746094 9.390625 32.605469 9.554688 32.921875 C 9.433594 32.957031 9.390625 33 9 33 C 8.640625 32.996094 8.304688 33.183594 8.121094 33.496094 C 7.941406 33.808594 7.941406 34.191406 8.121094 34.503906 C 8.304688 34.816406 8.640625 35.003906 9 35 C 9.816406 35 10.488281 34.910156 11.0625 34.46875 C 11.445313 34.175781 11.640625 33.683594 11.683594 33.203125 C 12.214844 33.839844 12.816406 34.390625 13.421875 34.816406 C 13.425781 34.820313 13.425781 34.820313 13.425781 34.816406 C 15.105469 36 17.132813 36.65625 19.621094 36.875 C 19.296875 37.246094 19.089844 37.707031 19.03125 38.21875 C 18.089844 38.378906 17.222656 38.628906 16.484375 38.96875 C 15.808594 39.28125 15.226563 39.664063 14.773438 40.15625 C 14.320313 40.648438 14 41.292969 14 42 L 14 43 L 29 43 L 29 42 C 29 41.292969 28.679688 40.648438 28.226563 40.15625 C 27.773438 39.664063 27.191406 39.28125 26.515625 38.96875 C 25.777344 38.628906 24.910156 38.378906 23.96875 38.21875 C 23.910156 37.714844 23.707031 37.257813 23.390625 36.890625 C 28.492188 36.371094 32.082031 33.824219 36.664063 29.746094 C 39.992188 26.785156 43.59375 23.019531 46.363281 21.933594 C 46.8125 21.757813 47.074219 21.285156 46.984375 20.8125 C 46.894531 20.339844 46.480469 20 46 20 L 45.90625 20 C 45.625 18.269531 44.589844 16.257813 42.136719 15.070313 C 41.980469 14.992188 41.84375 14.921875 41.6875 14.84375 C 42.609375 14.675781 43.457031 14.28125 44.035156 13.59375 L 44.070313 13.550781 L 44.101563 13.503906 C 44.574219 12.796875 44.863281 11.976563 44.960938 11.121094 C 45 10.824219 45 10.726563 45 10.5 C 45 7.472656 42.527344 5 39.5 5 Z M 38.5 7 L 39.5 7 C 41.453125 7 43 8.546875 43 10.5 C 43 10.464844 42.953125 11.039063 42.980469 10.859375 L 42.980469 10.875 L 42.976563 10.890625 C 42.917969 11.421875 42.726563 11.90625 42.464844 12.324219 C 42.109375 12.722656 41.59375 13 41 13 C 40.339844 13 39.773438 12.6875 39.402344 12.203125 C 39.152344 11.859375 39 11.453125 39 11 L 39 10 L 38 10 C 36.90625 10 36 10.90625 36 12 C 36 12.136719 36.015625 12.226563 36.027344 12.300781 C 36.113281 13.179688 36.601563 13.898438 37.191406 14.453125 C 37.785156 15.007813 38.503906 15.449219 39.269531 15.871094 L 39.273438 15.871094 C 39.914063 16.214844 40.59375 16.539063 41.257813 16.867188 L 41.261719 16.871094 L 41.265625 16.871094 C 42.992188 17.707031 43.53125 18.890625 43.753906 20 L 43.65625 20 C 43.566406 19.796875 43.574219 19.554688 43.4375 19.378906 C 43.089844 18.917969 42.628906 18.554688 42.078125 18.207031 C 40.96875 17.519531 39.441406 16.886719 37.367188 16.070313 C 36.699219 15.808594 35.824219 15.316406 35.15625 14.582031 C 34.488281 13.847656 34 12.898438 34 11.5 C 34 9 36 7 38.5 7 Z M 21.5 15 C 22.339844 15 23 15.660156 23 16.5 C 23 17.339844 22.339844 18 21.5 18 C 20.660156 18 20 17.339844 20 16.5 C 20 15.660156 20.660156 15 21.5 15 Z M 21.5 20 C 22.9375 20 24.621094 21.289063 26.074219 23 L 16.9375 23 C 18.390625 21.296875 20.0625 20 21.5 20 Z M 7 22 C 7.871094 22 8.355469 22.296875 8.789063 22.816406 C 9.226563 23.335938 9.550781 24.132813 9.742188 24.980469 C 10.128906 26.667969 10.003906 28.4375 10.003906 28.4375 C 9.992188 28.535156 9.996094 28.640625 10.015625 28.738281 C 10.011719 28.828125 10 28.914063 10 29 C 10 29.515625 10.089844 30.015625 10.226563 30.5 C 9.757813 30.066406 9.21875 29.636719 8.578125 29.183594 C 7.527344 28.445313 6.613281 27.738281 5.992188 26.945313 C 5.375 26.160156 5.011719 25.300781 5.007813 24.03125 C 5.007813 24.007813 5.046875 23.488281 5.320313 22.96875 C 5.601563 22.433594 5.9375 22 7 22 Z M 40.425781 22 L 42.378906 22 C 39.933594 23.8125 37.566406 26.269531 35.335938 28.253906 C 30.464844 32.589844 27.296875 34.796875 22.066406 34.984375 C 22.066406 34.980469 22.066406 34.980469 22.0625 34.984375 C 21.851563 34.992188 21.667969 35 21.5 35 C 21.546875 35 21.527344 35 21.441406 35 C 21.441406 34.996094 21.441406 34.996094 21.4375 35 C 21.417969 34.996094 21.398438 34.996094 21.375 34.996094 C 18.320313 34.96875 16.257813 34.363281 14.578125 33.183594 C 13.347656 32.316406 12 30.386719 12 29 C 12 27.28125 13.074219 25.832031 14.589844 25.265625 L 14.902344 25.175781 C 15.078125 25.125 15.246094 25.089844 15.410156 25.058594 C 15.605469 25.03125 15.796875 25 16 25 L 29.984375 25 L 29.964844 24.957031 C 34.296875 24.761719 38.023438 23.695313 40.425781 22 Z M 21.5 40 C 21.925781 40 22.339844 40.023438 22.742188 40.0625 C 23.90625 40.175781 24.933594 40.445313 25.675781 40.785156 C 25.824219 40.855469 25.871094 40.929688 25.996094 41 L 17.003906 41 C 17.128906 40.929688 17.175781 40.855469 17.324219 40.785156 C 18.066406 40.445313 19.09375 40.175781 20.257813 40.0625 C 20.660156 40.023438 21.074219 40 21.5 40 Z"/></g>'
        }, */
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
        single: true,
        icon: '<circle cx="14" cy="18" r="7" fill="white" stroke="black" stroke-width="2"/><circle cx="20" cy="14" r="7" fill="black" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'chess', // <-- THIS IS THE SINGLE PLAYER CHESS ID
        name: 'Chess',
        cat: 'games',
        single: true,
        icon: '<g transform="translate(-2, 2) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/></g><g transform="translate(8, 6) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/></g>'
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
        icon: '<path d="M4 10 V6 H28 V10 M4 22 V26 H28 V22" stroke="black" stroke-width="2" fill="none"/><text x="16" y="19" font-size="9" font-family="monospace" text-anchor="middle" fill="black" stroke="none" font-weight="bold">1+2=3</text>'
    },
    {
        id: 'nonograms',
        name: 'Nonograms',
        es6: true,
        cat: 'games',
        icon: '<rect x="6" y="6" width="20" height="20" fill="none" stroke="black" stroke-width="2"/><line x1="11" y1="6" x2="11" y2="26"/><line x1="21" y1="6" x2="21" y2="26"/><line x1="6" y1="11" x2="26" y2="11"/><line x1="6" y1="21" x2="26" y2="21"/>'
    },
    /*     {
            id: 'words',
            name: 'Scrabble',
            es6: true,
            cat: 'games',
            icon: '<rect x="4" y="10" width="10" height="12" fill="white"/><text x="9" y="19" font-size="10" text-anchor="middle" stroke="none" fill="black" font-weight="bold">S</text><rect x="16" y="8" width="10" height="12" fill="black" stroke="none"/><text x="21" y="17" font-size="10" text-anchor="middle" stroke="none" fill="white" font-weight="bold">W</text>'
        }, */
    {
        id: 'maze',
        name: 'Maze',
        cat: 'games',
        icon: '<path d="M4 4 h24 v24 h-24 z" fill="none" stroke="black" stroke-width="2"/><line x1="12" y1="4" x2="12" y2="20" stroke="black" stroke-width="2"/><line x1="20" y1="12" x2="20" y2="28" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'snake',
        name: 'Snake',
        cat: 'games',
        icon: '<path d="M6 26 l 6 0 l 0 -10 l 12 0 l 0 6 l 4 0" fill="none" stroke="black" stroke-width="4" stroke-linecap="round"/><circle cx="28" cy="22" r="2.5" fill="black"/>'
    },
    {
        id: 'dino',
        name: 'Dino',
        cat: 'games',
        filled: true,
        icon: '<path d="M24 2h16v1h-16zM24 3h16v1h-16zM22 4h20v1h-20zM22 5h4v1h-4zM28 5h14v1h-14zM22 6h4v1h-4zM28 6h14v1h-14zM22 7h20v1h-20zM22 8h20v1h-20zM22 9h20v1h-20zM22 10h20v1h-20zM22 11h20v1h-20zM22 12h20v1h-20zM22 13h10v1h-10zM22 14h10v1h-10zM22 15h16v1h-16zM22 16h16v1h-16zM2 17h2v1h-2zM20 17h10v1h-10zM2 18h2v1h-2zM20 18h10v1h-10zM2 19h2v1h-2zM17 19h13v1h-13zM2 20h2v1h-2zM17 20h13v1h-13zM2 21h4v1h-4zM14 21h20v1h-20zM2 22h4v1h-4zM14 22h20v1h-20zM2 23h6v1h-6zM12 23h18v1h-18zM32 23h2v1h-2zM2 24h6v1h-6zM12 24h18v1h-18zM32 24h2v1h-2zM2 25h28v1h-28zM2 26h28v1h-28zM2 27h28v1h-28zM2 28h28v1h-28zM4 29h26v1h-26zM4 30h24v1h-24zM6 31h22v1h-22zM6 32h22v1h-22zM8 33h18v1h-18zM8 34h18v1h-18zM10 35h14v1h-14zM10 36h14v1h-14zM12 37h6v1h-6zM20 37h4v1h-4zM12 38h6v1h-6zM20 38h4v1h-4zM12 39h4v1h-4zM22 39h2v1h-2zM12 40h4v1h-4zM22 40h2v1h-2zM12 41h2v1h-2zM22 41h2v1h-2zM12 42h2v1h-2zM22 42h2v1h-2zM12 43h4v1h-4zM22 43h4v1h-4zM12 44h4v1h-4zM22 44h4v1h-4z" fill="black" shape-rendering="crispEdges"/>',
        viewBox: '0 0 44 47'
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
        id: 'strands',
        name: 'Strands',
        cat: 'games',
        icon: '<rect x="4" y="4" width="24" height="24" fill="none" stroke="black" stroke-width="2"/><path d="M8 8 H12 V12 H16 V16 H20 V20 H24" fill="none" stroke="black" stroke-width="2"/><circle cx="8" cy="8" r="1.5" fill="black"/><circle cx="24" cy="20" r="1.5" fill="black"/>'
    },
    {
        id: 'sudoku',
        name: 'Sudoku',
        es6: true,
        cat: 'games',
        icon: '<rect x="2" y="2" width="28" height="28" fill="none" stroke="black" stroke-width="2"/><path d="M11 2v28M21 2v28M2 11h28M2 21h28" stroke="black" stroke-width="1"/><text x="16" y="19" font-size="10" font-family="monospace" text-anchor="middle" fill="black" stroke="none" font-weight="bold">9</text>'
    },
    {
        id: 'tetris',
        name: 'Tetris',
        cat: 'games',
        icon: '<path d="M6 10 h10 v10 h-10 z" fill="none" stroke="black" stroke-width="2"/><path d="M16 20 h10 v10 h-10 z" fill="black" stroke="none"/><path d="M16 10 h10 v10 h-10 z" fill="none" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'blockblast',
        name: 'Block Blast',
        cat: 'games',
        icon: '<rect x="12" y="4" width="8" height="8" stroke="black" fill="none" stroke-width="2"/><rect x="4" y="12" width="8" height="8" stroke="black" fill="none" stroke-width="2"/><rect x="20" y="12" width="8" height="8" fill="black"/><rect x="12" y="20" width="8" height="8" fill="black"/>'
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
        icon: '<text x="4" y="10" font-size="8" font-family="monospace" fill="black" stroke="none" font-weight="bold">S E A</text><text x="4" y="19" font-size="8" font-family="monospace" fill="black" stroke="none" font-weight="bold">R C H</text><text x="4" y="28" font-size="8" font-family="monospace" fill="black" stroke="none" font-weight="bold">K E Y</text><rect x="1" y="3" width="30" height="9" rx="4" stroke="black" stroke-width="1.5" fill="none"/>'
    },
    {
        id: 'wordle',
        name: 'Wordle',
        cat: 'games',
        icon: '<rect x="2" y="2" width="12" height="12"/><rect x="18" y="18" width="12" height="12" fill="black" stroke="none"/>'
    },
    {
        id: 'pet',
        name: 'Pet',
        cat: 'games',
        filled: true,
        icon: '<g transform="translate(2.27, 2.27) scale(2)" shape-rendering="crispEdges"><g fill="black"><rect x="12.75" y="11.76" width="0.98" height="0.98"/><rect x="12.75" y="10.78" width="0.98" height="0.98"/><rect x="11.77" y="12.74" width="0.98" height="0.98"/><rect x="10.79" y="12.74" width="0.98" height="0.98"/><rect x="8.83" y="11.76" width="0.98" height="0.98"/><rect x="9.81" y="11.76" width="0.98" height="0.98"/><rect x="7.85" y="12.74" width="0.98" height="0.98"/><rect x="5.88" y="12.74" width="0.98" height="0.98"/><rect x="6.86" y="12.74" width="0.99" height="0.98"/><rect x="4.9" y="11.76" width="0.98" height="0.98"/><rect x="5.88" y="11.76" width="0.98" height="0.98"/><rect x="5.88" y="10.78" width="0.98" height="0.98"/><rect x="6.86" y="10.78" width="0.99" height="0.98"/><rect x="7.85" y="9.8" width="0.98" height="0.98"/><rect x="6.86" y="9.8" width="0.99" height="0.98"/><rect x="8.83" y="8.82" width="0.98" height="0.98"/><rect x="9.81" y="8.82" width="0.98" height="0.98"/><rect x="10.79" y="7.84" width="0.98" height="0.98"/><rect x="11.77" y="6.86" width="0.98" height="0.98"/><rect x="11.77" y="5.88" width="0.98" height="0.98"/><rect x="11.77" y="4.9" width="0.98" height="0.98"/><rect x="11.77" y="3.92" width="0.98" height="0.98"/><rect x="11.77" y="2.94" width="0.98" height="0.98"/><rect x="10.79" y="1.96" width="0.98" height="0.98"/><rect x="9.81" y="0.98" width="0.98" height="0.98"/><rect x="8.83" y="1.96" width="0.98" height="0.98"/><rect x="4.9" y="1.96" width="0.98" height="0.98"/><rect x="7.85" width="0.98" height="0.98"/><rect x="8.83" width="0.98" height="0.98"/><rect x="5.88" width="0.98" height="0.98"/><rect x="4.9" width="0.98" height="0.98"/><rect x="6.86" width="0.99" height="0.98"/><rect x="3.92" y="0.98" width="0.98" height="0.98"/><rect x="7.85" y="8.82" width="0.98" height="0.98"/><rect x="5.88" y="8.82" width="0.98" height="0.98"/><rect x="4.9" y="8.82" width="0.98" height="0.98"/><rect x="6.86" y="8.82" width="0.99" height="0.98"/><rect x="3.92" y="7.84" width="0.98" height="0.98"/><rect x="2.94" y="6.86" width="0.98" height="0.98"/><rect x="2.94" y="5.88" width="0.98" height="0.98"/><rect x="1.96" y="5.88" width="0.98" height="0.98"/><rect x="0.98" y="5.88" width="0.98" height="0.98"/><rect x="1.96" y="1.96" width="0.98" height="0.98"/><rect x="2.94" y="1.96" width="0.98" height="0.98"/><rect x="0.98" y="1.96" width="0.98" height="0.98"/><rect y="2.94" width="0.98" height="0.98"/><rect x="1.96" y="3.92" width="0.98" height="0.98"/><rect x="2.94" y="3.92" width="0.98" height="0.98"/><rect x="0.98" y="3.92" width="0.98" height="0.98"/><rect y="4.9" width="0.98" height="0.98"/></g><polygon points="2.94 5.88 3.92 5.88 3.92 7.84 4.9 7.84 4.9 8.82 10.79 8.82 10.79 7.84 11.77 7.84 11.77 2.94 10.79 2.94 10.79 1.96 9.81 1.96 9.81 2.94 8.83 2.94 8.83 1.96 9.81 1.96 9.81 0.98 8.83 0.98 7.85 0.98 6.86 0.98 5.88 0.98 4.9 0.98 4.9 1.96 5.88 1.96 5.88 2.94 4.9 2.94 4.9 1.96 3.92 1.96 3.92 2.94 2.94 2.94 1.96 2.94 0.98 2.94 0.98 3.92 1.96 3.92 2.94 3.92 3.92 3.92 3.92 4.9 2.94 4.9 1.96 4.9 0.98 4.9 0.98 5.88 1.96 5.88 2.94 5.88" fill="white"/></g>',
        viewBox: '0 0 32 32'
    },
    {
        id: 'mario',
        name: 'Mario',
        cat: 'games',
        filled: false,
        icon: '<svg viewBox="0 200 600 550"><path d="M263 207v16h-36v65h-36v32H12v65h35v33h36v32h36v65h-18l-18 1v64H65l-18 1v64H30c-17 0-17 0-18 2v62h107v-31h72v-33h72v-32h72v32h72v-32h-18l-17-1-1-16v-16h-72l-72 1v32h-36v32h-36l-35 1-1 16v16H47v-33h36v-65h36v-65h36v-65h-36v-32H83v-16l-1-17H48v-32h180v-65h36v-65h72v64l18 1h18v65h181v32h-36v33h-36v32h-36v65h36v65h36v65h36v16l-1 16-35 1h-36v-16l-1-17h-35l-36 1v31l36 1h36v31h54l53-1 1-29-1-32c0-2 0-2-17-2h-18v-32l-1-32-17-1h-18v-32l-1-32-17-1h-18v-65h36v-32h35l1-17v-16h35l1-32v-32l-91-1h-90v-32h-36v-65h-36v-32h-72v16z" fill="black"/><path d="m228 386-1 49v47l18 1h18v-98h-17l-18 1zm108 0-1 49v47l18 1h18v-98h-17l-18 1z" fill="black"/></svg>'
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
        name: 'Checkers',
        cat: 'two_player',
        icon: '<circle cx="14" cy="18" r="7" fill="white" stroke="black" stroke-width="2"/><circle cx="20" cy="14" r="7" fill="black" stroke="black" stroke-width="2"/>'
    },
    {
        id: '2pchess',
        name: 'Chess',
        cat: 'two_player',
        icon: '<g transform="translate(-2, 2) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/></g><g transform="translate(8, 6) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/></g>'
    },
    {
        id: 'livechess',
        name: 'Chess',
        cat: 'live_game',
        live: true,
        icon: '<g transform="translate(-2, 2) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="white" stroke="black" stroke-width="2" stroke-linejoin="round"/></g><g transform="translate(8, 6) scale(0.8)"><path d="M20 26 H8 V23 H20 V26 M10 23 L11 15 C10 13 9 11 10 9 C11 5 15 4 18 5 C20 6 21 8 21 8 L19 12 L19 23 H10" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/></g>'
    },
    {
        id: '2pconnect4',
        name: 'Connect 4',
        cat: 'two_player',
        icon: '<rect x="4" y="4" width="24" height="24" fill="none"/><circle cx="10" cy="10" r="3"/><circle cx="22" cy="22" r="3" fill="black"/>'
    },
    {
        id: '2pdotsandboxes',
        name: 'Dots & Boxes',
        cat: 'two_player',
        icon: '<circle cx="10" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="22" r="1.5" fill="black" stroke="none"/><line x1="10" y1="10" x2="16" y2="10" stroke="black" stroke-width="2"/><line x1="16" y1="10" x2="16" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="10" x2="10" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="16" x2="16" y2="16" stroke="black" stroke-width="2"/>'
    },
    {
        id: '2ptictactoe',
        name: 'Tic-Tac-Toe',
        es6: true,
        cat: 'two_player',
        icon: '<line x1="12" y1="6" x2="12" y2="26"/><line x1="20" y1="6" x2="20" y2="26"/><line x1="6" y1="12" x2="26" y2="12"/><line x1="6" y1="20" x2="26" y2="20"/>'
    },
    {
        id: 'liveuno',
        name: 'Uno',
        cat: 'live_game',
        live: true,
        filled: true,
        icon: '<rect x="6" y="4" width="20" height="24" rx="2" fill="none" stroke="black" stroke-width="2"/><ellipse cx="16" cy="16" rx="8" ry="5" fill="black" stroke="none" transform="rotate(-30 16 16)"/><text x="16" y="19" font-size="8" text-anchor="middle" font-weight="bold" fill="white" transform="rotate(-30 16 16)">UNO</text>'
    },
    {
        id: 'liveyahtzee',
        name: 'Yahtzee',
        cat: 'live_game',
        live: true,
        icon: '<rect x="3" y="3" width="16" height="16" rx="2" fill="white" stroke="black" stroke-width="2"/><circle cx="7" cy="7" r="1.5" fill="black"/><circle cx="15" cy="15" r="1.5" fill="black"/><circle cx="7" cy="15" r="1.5" fill="black"/><circle cx="15" cy="7" r="1.5" fill="black"/><circle cx="11" cy="11" r="1.5" fill="black"/><rect x="13" y="13" width="16" height="16" rx="2" fill="white" stroke="black" stroke-width="2"/><circle cx="17" cy="17" r="1.5" fill="black"/><circle cx="25" cy="17" r="1.5" fill="black"/><circle cx="17" cy="21" r="1.5" fill="black"/><circle cx="25" cy="21" r="1.5" fill="black"/><circle cx="17" cy="25" r="1.5" fill="black"/><circle cx="25" cy="25" r="1.5" fill="black"/>'
    },
    {
        id: 'livecheckers',
        name: 'Checkers',
        cat: 'live_game',
        live: true,
        icon: '<circle cx="14" cy="18" r="7" fill="white" stroke="black" stroke-width="2"/><circle cx="20" cy="14" r="7" fill="black" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'liveconnect4',
        name: 'Connect 4',
        cat: 'live_game',
        live: true,
        icon: '<rect x="4" y="4" width="24" height="24" fill="none"/><circle cx="10" cy="10" r="3"/><circle cx="22" cy="22" r="3" fill="black"/>'
    },
    {
        id: 'livedotsandboxes',
        name: 'Dots & Boxes',
        cat: 'live_game',
        live: true,
        icon: '<circle cx="10" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="22" r="1.5" fill="black" stroke="none"/><line x1="10" y1="10" x2="16" y2="10" stroke="black" stroke-width="2"/><line x1="16" y1="10" x2="16" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="10" x2="10" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="16" x2="16" y2="16" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'livepictionary',
        name: 'Pictionary',
        cat: 'live_game',
        live: true,
        icon: '<rect x="4" y="5" width="22" height="18" fill="none" stroke="black" stroke-width="2"/><path d="M8 18 Q11 12 14 16 T20 14" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M22 22 L28 28" stroke="black" stroke-width="2" stroke-linecap="round"/><path d="M21 21 L24 24 L22 26 L19 23 Z" fill="white" stroke="black" stroke-width="2"/><path d="M19 23 L22 26" stroke="black" stroke-width="1.5"/>'
    },
    {
        id: 'livetictactoe',
        name: 'Tic-Tac-Toe',
        es6: true,
        cat: 'live_game',
        live: true,
        icon: '<line x1="12" y1="6" x2="12" y2="26"/><line x1="20" y1="6" x2="20" y2="26"/><line x1="6" y1="12" x2="26" y2="12"/><line x1="6" y1="20" x2="26" y2="20"/>'
    },
    {
        id: 'pool2p',
        name: '8 Ball',
        cat: 'two_player',
        icon: '<circle cx="16" cy="16" r="14" fill="none" stroke="black" stroke-width="2"/><text x="16" y="21" font-size="14" font-weight="bold" text-anchor="middle" fill="black">8</text>'
    },
    {
        id: 'doom',
        name: 'DOOM',
        cat: 'games',
        desc: 'Rip and Tear',
        // Official Doom logo vector from user provided file (Doom_–_Game’s_logo.svg)
        // Original viewBox: 0 0 1680 869. Scaled down to fit ~30px width.
        // Group transform adjusts for the file's internal offset (-7.13, -565.73) and scales it (0.020).
        // Outer translate (-1, 7) centers it in the 32x32 box (width ~33.6px).
        icon: `<g transform="translate(-1, 7) scale(0.020) translate(-7.13, -565.73)">
            <path d="m 1476.3012,1327.8121 -0.2917,-292.4969 -46.7662,163.4072 -46.7058,-162.6616 -0.2827,222.0343 -152.4945,-114.3724 11.559,-8.6664 -0.5292,-569.30683 144.9467,0.3774 43.4492,152.19623 43.5126,-152.40042 214.4342,0.69673 -70.3645,52.57665 -0.1246,814.42954 z M 78.328958,619.06163 7.1328025,565.73124 l 401.3006875,0.54398 45.93055,35.08717 0.0378,533.50351 12.16772,8.8133 -388.148567,291.252 z m 235.518822,416.21877 -0.15295,-307.89242 -10.75764,-8.78449 -83.44785,0.40375 -0.18291,387.17176 z m 152.39799,82.7814 -0.0717,-516.75483 47.07325,-35.27648 281.69722,-0.0156 46.98005,35.42167 0.17344,597.96244 -133.22444,100.1999 z m 223.12917,-399.76328 -71.04792,0.49268 -11.09868,8.52709 0.15885,308.10291 93.32018,69.9936 0.24947,-377.92826 z m 164.80854,481.66028 -0.34116,-598.79687 46.91876,-35.23879 282.06992,0.26967 47.2183,35.27898 -0.3246,515.55821 -241.33557,182.4526 z m 234.65122,-164.742 -0.03,-308.02638 -11.8726,-9.07298 -70.9365,0.23276 -11.40484,8.78228 0.70414,377.32652 z" fill="black" />
        </g>`
    },
    {
        id: 'yahtzee',
        name: 'Yahtzee',
        cat: 'games',
        single: true,
        icon: '<rect x="3" y="3" width="16" height="16" rx="2" fill="white" stroke="black" stroke-width="2"/><circle cx="7" cy="7" r="1.5" fill="black"/><circle cx="15" cy="15" r="1.5" fill="black"/><circle cx="7" cy="15" r="1.5" fill="black"/><circle cx="15" cy="7" r="1.5" fill="black"/><circle cx="11" cy="11" r="1.5" fill="black"/><rect x="13" y="13" width="16" height="16" rx="2" fill="white" stroke="black" stroke-width="2"/><circle cx="17" cy="17" r="1.5" fill="black"/><circle cx="25" cy="17" r="1.5" fill="black"/><circle cx="17" cy="21" r="1.5" fill="black"/><circle cx="25" cy="21" r="1.5" fill="black"/><circle cx="17" cy="25" r="1.5" fill="black"/><circle cx="25" cy="25" r="1.5" fill="black"/>'
    },
    {
        id: 'circle',
        name: 'Perfect Circle',
        cat: 'games',
        icon: '<circle cx="16" cy="16" r="12" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="2" fill="black"/><line x1="16" y1="2" x2="16" y2="6" stroke="black" stroke-width="2"/><line x1="16" y1="26" x2="16" y2="30" stroke="black" stroke-width="2"/><line x1="2" y1="16" x2="6" y2="16" stroke="black" stroke-width="2"/><line x1="26" y1="16" x2="30" y2="16" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'battleship',
        name: 'Battleship',
        cat: 'games',
        single: true,
        icon: '<circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="2" fill="black"/>'
    },
    {
        id: 'connect4',
        name: 'Connect 4',
        cat: 'games',
        single: true,
        icon: '<rect x="4" y="4" width="24" height="24" fill="none"/><circle cx="10" cy="10" r="3"/><circle cx="22" cy="22" r="3" fill="black"/>'
    },
    {
        id: 'dotsandboxes',
        name: 'Dots & Boxes',
        cat: 'games',
        single: true,
        icon: '<circle cx="10" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="10" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="16" r="1.5" fill="black" stroke="none"/><circle cx="10" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="16" cy="22" r="1.5" fill="black" stroke="none"/><circle cx="22" cy="22" r="1.5" fill="black" stroke="none"/><line x1="10" y1="10" x2="16" y2="10" stroke="black" stroke-width="2"/><line x1="16" y1="10" x2="16" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="10" x2="10" y2="16" stroke="black" stroke-width="2"/><line x1="10" y1="16" x2="16" y2="16" stroke="black" stroke-width="2"/>'
    },
    {
        id: 'tictactoe',
        name: 'Tic-Tac-Toe',
        es6: true,
        cat: 'games',
        single: true,
        icon: '<line x1="12" y1="6" x2="12" y2="26"/><line x1="20" y1="6" x2="20" y2="26"/><line x1="6" y1="12" x2="26" y2="12"/><line x1="6" y1="20" x2="26" y2="20"/>'
    },
    {
        id: 'uno',
        name: 'Uno',
        cat: 'games',
        single: true,
        filled: true,
        icon: '<rect x="6" y="4" width="20" height="24" rx="2" fill="none" stroke="black" stroke-width="2"/><ellipse cx="16" cy="16" rx="8" ry="5" fill="black" stroke="none" transform="rotate(-30 16 16)"/><text x="16" y="19" font-size="8" text-anchor="middle" font-weight="bold" fill="white" transform="rotate(-30 16 16)">UNO</text>'
    },
    {
        id: 'crossy',
        name: 'Crossy',
        cat: 'games',
        filled: true,
        new: true,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="9 6 13 20" preserveAspectRatio="xMidYMid meet"><rect x="15" y="6" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="6" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="7" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="7" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="15" y="7" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="7" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="7" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="8" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="8" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="15" y="8" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="8" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="8" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="9" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="15" y="9" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="9" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="9" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="18" y="9" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="10" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="10" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="10" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="10" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="10" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="10" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="10" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="19" y="10" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="11" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="11" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="11" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="12" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="12" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="12" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="12" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="12" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="12" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="12" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="12" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="20" y="12" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="13" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="13" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="13" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="20" y="13" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="21" y="13" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="14" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="14" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="14" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="20" y="14" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="9" y="15" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="15" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="15" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="15" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="15" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="9" y="16" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="11" y="16" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="16" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="16" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="16" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="9" y="17" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="11" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="12" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="13" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="17" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="17" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="9" y="18" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="11" y="18" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="18" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="18" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="18" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="18" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="9" y="19" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="11" y="19" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="13" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="19" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="19" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="19" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="10" y="20" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="11" y="20" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="12" y="20" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="20" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="20" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="15" y="20" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="20" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="20" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="20" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="19" y="20" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="11" y="21" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="13" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="14" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="15" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="16" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="17" y="21" width="1" height="1" shape-rendering="crispEdges" fill="white"></rect><rect x="18" y="21" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="12" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="15" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="22" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="23" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="23" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="24" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="24" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="13" y="25" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="14" y="25" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="16" y="25" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="17" y="25" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect><rect x="18" y="25" width="1" height="1" shape-rendering="crispEdges" fill="black"></rect></svg>'
    }
];

// Helper function to check if games are disabled (used by index.html for filtering)
function areGamesDisabled() {
    // Setting is stored as a string "true" or "false"
    return localStorage.getItem('rekindle_disable_games') === 'true';
}