'use strict';

/*
 * Per-page SEO metadata — the single source of truth.
 *
 * Everything here feeds `scripts/seo-inject.js` (which writes the head block and
 * the screen-reader <h1>) and `scripts/generate-sitemap.js` (which skips the
 * noindex pages). `scripts/test-seo.js` enforces the rules, so adding a page
 * without an entry fails `npm test`.
 *
 * Fields
 *   name    - display name, also the default <h1> and the JSON-LD name
 *   tag     - short descriptor used in <title> ("Name – tag | ReKindle")
 *   type    - game | tool | reading | social | media | health | info | system
 *             (drives the description tail, the JSON-LD applicationCategory and
 *             whether the page may be indexed)
 *   summary - one-sentence description; the SEO description is summary + tail
 *   desc    - full description override (only for pages with no summary)
 *   title   - full <title> override (only where the suffix is wrong, e.g. home)
 *   h1      - <h1> override
 *   noindex - exclude from the index and from sitemap.xml
 *
 * Summaries are kept in step with the Help centre (help-data.js) so the app
 * description in search results matches the one on /help.
 *
 * Why every page needs this at all: the site serves one page per app, but
 * /x, /x.html, /X, /x/ and the lite./legacy. subdomains all render the same
 * markup. Before 2026-11-10 no page carried a canonical, a description or an
 * Open Graph tag, which is what produced 209 "Duplicate without user-selected
 * canonical" URLs in Search Console.
 */

const SITE = 'https://rekindle.ink';
const OG_IMAGE = SITE + '/preview.png';

const TAILS = {
    game: 'Play free on Kindle, Kobo and other e-ink readers.',
    tool: 'Free in the Kindle, Kobo or e-ink browser.',
    reading: 'Free on Kindle and other e-ink readers.',
    social: 'Free on Kindle and other e-ink readers.',
    media: 'Free on Kindle and other e-ink readers.',
    health: 'Free on Kindle and other e-ink readers.',
    info: 'Free on Kindle and other e-ink readers.',
    system: ''
};

const CATEGORY = {
    game: 'GameApplication',
    tool: 'UtilitiesApplication',
    reading: 'MultimediaApplication',
    social: 'SocialNetworkingApplication',
    media: 'LifestyleApplication',
    health: 'HealthApplication',
    info: 'UtilitiesApplication',
    system: 'UtilitiesApplication'
};

const PAGES = {
    '2048': { name: '2048', tag: 'Merge tiles to reach 2048', type: 'game', summary: 'Slide and merge numbered tiles to reach 2048.' },
    '2pbattleships': { name: '2-Player Battleship', tag: "Sink your friend's fleet", type: 'game', desc: "Pass the e-reader between two players and sink each other's fleet. No sign-in and no opponent needed." },
    '2pcheckers': { name: '2-Player Checkers', tag: 'Local two-player draughts', type: 'game', desc: 'Two players on one e-reader: jump and capture until one side is blocked. No sign-in needed.' },
    '2pchess': { name: '2-Player Chess', tag: 'Two players on one device', type: 'game', desc: 'Play a full game of chess against someone in the room, with legal-move checking and no account.' },
    '2pconnect4': { name: '2-Player Connect 4', tag: 'Drop discs, line up four', type: 'game', desc: 'Take turns dropping discs and be the first to line up four. Two players on one Kindle or Kobo.' },
    '2pdotsandboxes': { name: '2-Player Dots & Boxes', tag: 'Claim the most boxes', type: 'game', desc: 'Draw lines between dots and claim closed boxes. Two players share one screen.' },
    '2ptictactoe': { name: '2-Player Tic-Tac-Toe', tag: 'Three in a row for two', type: 'game', desc: 'The classic three-in-a-row game for two players sharing one Kindle or Kobo screen. No sign-in needed.' },
    airtype: { name: 'AirType', tag: 'Use your phone as a keyboard', type: 'tool', summary: 'Use your phone as a keyboard for the e-reader, with a live note panel.' },
    akinator: { name: 'Akinator', tag: '20-questions character guesser', type: 'game', summary: 'Think of a character, object or animal and let the genie guess it in twenty questions.' },
    anagrams: { name: 'Anagrams', tag: 'Unscramble words against the clock', type: 'game', summary: 'Unscramble a word using the on-screen keyboard; every solved word is worth 10 points.' },
    battleship: { name: 'Battleship', tag: 'Sink the fleet, solo', type: 'game', summary: 'Place your fleet, then hunt and sink the enemy ships before yours go down.' },
    bible: { name: 'Scriptures', tag: 'Bible, Quran and Tao Te Ching', type: 'reading', summary: 'Read the Bible, Quran, Dhammapada and Tao Te Ching with adjustable text.' },
    bindings: { name: 'Connections', tag: 'Group 16 words into 4 categories', type: 'game', summary: 'Group sixteen words into four hidden categories with four mistakes allowed.' },
    blackjack: { name: 'Blackjack', tag: 'Beat the dealer to 21', type: 'game', summary: 'Beat the dealer to 21 without going bust, with a persistent bankroll.' },
    blockblast: { name: 'Block Blast', tag: 'Block puzzle with row clears', type: 'game', summary: 'Fit block shapes onto a grid and clear rows or columns for points.' },
    bluesky: { name: 'Bluesky', tag: 'Read and post from e-ink', type: 'social', summary: 'Read your Bluesky feed, notifications and discover timeline, and post from the e-reader.' },
    books: { name: 'Books', tag: 'Reading log and want-to-read list', type: 'reading', summary: 'Track minutes read each day and keep a want-to-read list powered by Open Library.' },
    breathing: { name: 'Breathing', tag: 'Guided breathing exercises', type: 'health', summary: 'Guided breathing patterns for relaxation, focus and balance.' },
    browser: { name: 'Browser', tag: 'Distraction-free web reader', type: 'tool', summary: 'A distraction-free reader for web pages and search results, with tabs and recent history.' },
    calculator: { name: 'Calculator', tag: 'Standard and scientific modes', type: 'tool', summary: 'A standard calculator with a scientific mode for trigonometry, logs and powers.' },
    calendar: { name: 'Calendar', tag: 'Agenda, day and month views', type: 'tool', summary: 'Agenda, day and month views with local events or Google Calendar sync.' },
    cargames: { name: 'Car Games', tag: 'Ten games for long car journeys', type: 'game', summary: 'Ten pass-the-Kindle games for a car journey, with a saved crew of players.' },
    changelog: { name: 'Changelog', tag: 'Every ReKindle change, newest first', type: 'info', desc: 'Every change to ReKindle, newest first: new apps, fixes and performance work for Kindle and other e-ink readers.' },
    chat: { name: 'AI Assistant', tag: 'AI chat that runs on e-ink', type: 'tool', summary: 'A text-first AI chat, with hosted Gemini or your own API key.' },
    checkers: { name: 'Checkers', tag: 'Kings, captures and jumps', type: 'game', summary: 'Capture or block every enemy piece; kings can move backwards.' },
    chess: { name: 'Chess', tag: 'Play the computer or a friend', type: 'game', summary: 'Play the computer at three difficulty levels, locally, or live online.' },
    chords: { name: 'Chords', tag: 'Guitar chords and tabs library', type: 'media', summary: 'Search guitar chords and tabs, then save songs to a personal library.' },
    circle: { name: 'Perfect Circle', tag: 'How round can you draw?', type: 'game', summary: 'Draw a circle as close to perfect as you can and see your accuracy score.' },
    clocks: { name: 'World Clock', tag: 'Times for cities worldwide', type: 'tool', summary: 'A world clock for several cities, with optional seconds.' },
    codebreaker: { name: 'Codebreaker', tag: 'Crack the hidden colour code', type: 'game', summary: 'Deduce a hidden number code from black and white peg feedback.' },
    comics: { name: 'Comics', tag: 'Free comics from the Internet Archive', type: 'reading', summary: 'Read public-domain and openly licensed comics from the Internet Archive.' },
    connect4: { name: 'Connect 4', tag: 'Line up four against the CPU', type: 'game', summary: 'Drop discs to line up four in a row against the computer or a friend.' },
    contacts: { name: 'Contacts', tag: 'Address book with Google import', type: 'tool', summary: 'A local address book with optional read-only Google Contacts or CardDAV import.' },
    converter: { name: 'Converter', tag: 'Units, temperature and currency', type: 'tool', summary: 'Convert length, mass, temperature, speed, volume and currency.' },
    cookbook: { name: 'Cookbook', tag: 'Recipes by name or ingredient', type: 'media', summary: 'Find recipes by name or by the ingredients you have, and save favourites.' },
    cookieclicker: { name: 'Cookie Clicker', tag: 'Idle cookie-baking empire', type: 'game', summary: 'Tap the big cookie, buy buildings and upgrades, and let the cookies pile up.' },
    countdown: { name: 'Countdown', tag: 'Days until any date or event', type: 'tool', summary: 'Count down to dates and recurring events, from a launch to a weekly reset.' },
    crossword: { name: 'Crossword', tag: 'Archive crosswords with helpers', type: 'game', summary: 'Solve a random crossword from the archive, with check and solve helpers.' },
    crossy: { name: 'Crossy', tag: 'Hop across roads and rivers', type: 'game', summary: 'Cross roads and rivers without getting hit or falling in.' },
    cubedash: { name: 'Cube Dash', tag: 'One-button platformer, ten levels', type: 'game', summary: 'A ten-level one-button platformer with cube and ship modes and collectible gears.' },
    decide: { name: 'Decider', tag: 'Spinning wheel picks for you', type: 'tool', summary: 'A spinning wheel for when you cannot choose between options.' },
    dictionary: { name: 'Dictionary', tag: 'Definitions in seven languages', type: 'tool', summary: 'Look up definitions in seven languages, including Ancient Greek.' },
    dino: { name: 'Dino', tag: 'Endless runner: jump the cacti', type: 'game', summary: 'Jump the cacti in a one-button endless runner.' },
    docs: { name: 'Docs', tag: 'Word document editor for e-ink', type: 'tool', summary: 'A ReKindle+ document editor that opens and saves Word files through Files.' },
    doom: { name: 'DOOM', tag: 'Play the classic shooter in a browser', type: 'game', summary: 'The classic shooter through a browser WebAssembly port, where the device supports it.' },
    dotsandboxes: { name: 'Dots & Boxes', tag: 'Claim more boxes than the CPU', type: 'game', summary: 'Draw lines between dots and claim more boxes than your opponent.' },
    dropbox: { name: 'Dropbox', tag: 'Browse Dropbox on your e-reader', type: 'tool', summary: 'Browse a Dropbox account and preview or download files on the e-reader.' },
    epub: { name: 'ePub', tag: 'Add DRM-free EPUBs to your library', type: 'reading', summary: 'Add a DRM-free EPUB to your library from a direct download URL.' },
    files: { name: 'Files', tag: 'ReKindle+ cloud storage', type: 'tool', summary: 'ReKindle+ cloud storage for documents, images, PDFs and ebooks, shared with Docs and Photo Frame.' },
    flashcards: { name: 'Flashcards', tag: 'Spaced repetition study decks', type: 'tool', summary: 'Create decks, import cards from CSV, and review with spaced repetition.' },
    flipbook: { name: 'Flipbook', tag: 'Frame-by-frame pixel animation', type: 'media', summary: 'Draw frame-by-frame pixel animations, preview them and post them to KindleChat.' },
    food: { name: 'Food Log', tag: 'Daily food diary', type: 'health', summary: 'A simple daily food diary for breakfast, lunch, dinner and snacks.' },
    hangman: { name: 'Hangman', tag: 'Guess the word, letter by letter', type: 'game', summary: 'Guess the hidden word one letter at a time before the drawing is complete.' },
    hanoi: { name: 'Tower of Hanoi', tag: 'Move the stack in fewest moves', type: 'game', summary: 'Move a stack of discs to another peg in the minimum number of moves.' },
    help: { name: 'Help & FAQ', tag: 'Guides, search and A-Z index', type: 'info', summary: 'How to search this help centre, browse the A-Z index and change the text size.' },
    history: { name: 'On This Day', tag: "What happened on today's date", type: 'info', summary: "Events, births and deaths that happened on today's date." },
    index: { name: 'ReKindle', tag: 'A dashboard OS for Kindle and e-ink', type: 'info', title: 'ReKindle – A dashboard OS for Kindle and e-ink', desc: 'Turn a Kindle, Kobo or other e-ink reader into a dashboard: 130+ games, reading, notes, weather and a distraction-free browser. Free, no install.' },
    'index_old': { name: 'ReKindle', tag: 'Classic dashboard layout', type: 'system', desc: 'The previous ReKindle dashboard layout.', noindex: true },
    interactive: { name: 'Interactive Reader', tag: 'Play interactive fiction', type: 'reading', summary: 'Play parser-based interactive fiction from the Interactive Fiction Database.' },
    jigsaw: { name: 'Jigsaw', tag: 'Tile-swapping picture puzzle', type: 'game', summary: 'Rebuild an image by swapping tiles, with a peek at the target.' },
    journal: { name: 'Journal', tag: 'Mood and reflection diary', type: 'health', summary: 'Daily mood and reflection entries with a calendar, trends and statistics.' },
    jumpy: { name: 'Jumpy', tag: 'Bounce up the platforms', type: 'game', summary: 'Bounce upward on platforms, dodging gaps and moving ledges.' },
    kindle: { name: 'ReKindle on Kindle', tag: 'Setup guide and launcher', type: 'info', desc: 'How to install ReKindle on a Kindle: the fullscreen launcher, KPM packages and the browser setup steps.' },
    kindlechat: { name: 'KindleChat', tag: 'Community chat for e-readers', type: 'social', summary: 'The ReKindle community chat: translations, emoji, pixel art, gallery and direct messages.' },
    language: { name: 'Languages', tag: 'Vocabulary practice, eight languages', type: 'tool', summary: 'Practise common words and sentences in eight languages with short quizzes.' },
    libby: { name: 'Libby', tag: 'Public library app on e-ink', type: 'reading', summary: 'An embedded window onto Libby, the public-library app, with an external fallback.' },
    life: { name: 'Life Calendar', tag: 'Your life in weeks', type: 'tool', summary: 'Visualise your life in weeks with a memento mori grid.' },
    lightsout: { name: 'Lights Out', tag: 'Switch every light off', type: 'game', summary: 'Switch every light off; each tap toggles a plus-shaped group.' },
    livecheckers: { name: 'Live Checkers', tag: 'Play Checkers online in real time', type: 'game', desc: 'Play Checkers against another ReKindle user in real time, with a lobby anyone can join.' },
    livechess: { name: 'Live Chess', tag: 'Play Chess online with a friend', type: 'game', desc: 'Play Chess online against another ReKindle user in real time, in a lobby that anyone can join from the dashboard.' },
    liveconnect4: { name: 'Live Connect 4', tag: 'Play Connect 4 online', type: 'game', desc: 'Play Connect 4 online against another ReKindle user in real time, with a lobby that anyone can join.' },
    livedotsandboxes: { name: 'Live Dots & Boxes', tag: 'Play Dots & Boxes online', type: 'game', desc: 'Play Dots & Boxes online against another ReKindle user in real time, with a lobby anyone can join.' },
    livepictionary: { name: 'Live Pictionary', tag: 'Draw and guess online', type: 'game', summary: 'Draw a secret word while other players race to guess it.' },
    livetictactoe: { name: 'Live Tic-Tac-Toe', tag: 'Play Tic-Tac-Toe online', type: 'game', desc: 'Play Tic-Tac-Toe online against another ReKindle user in real time, with a lobby anyone can join.' },
    liveuno: { name: 'Live Uno', tag: 'Play Uno online, 2-10 players', type: 'game', desc: 'Play Uno against bots or join an online match for two to ten players, with a 30-second turn timer.' },
    liveyahtzee: { name: 'Live Yahtzee', tag: 'Play Yahtzee online with friends', type: 'game', desc: 'Play Yahtzee online with other ReKindle readers, over thirteen rounds.' },
    login: { name: 'Log in', tag: 'Account and connection checks', type: 'system', desc: 'Sign in, check auth state and run connection diagnostics for ReKindle.', noindex: true },
    mail: { name: 'Mail', tag: 'IMAP email for the e-reader', type: 'tool', summary: 'A ReKindle+ IMAP/SMTP email client with folders, reading, archiving and composing.' },
    manga: { name: 'Manga Reader', tag: 'Manga from the Internet Archive', type: 'reading', desc: 'Read manga from the Internet Archive in the e-ink browser, page by page.' },
    maps: { name: 'Maps', tag: 'Places, OpenStreetMap and routes', type: 'tool', summary: 'Search places, view OpenStreetMap tiles and calculate a route.' },
    mario: { name: 'Mario', tag: 'Run, jump and stomp to the flag', type: 'game', summary: 'An auto-running platformer: jump, stomp enemies and collect coins to the flag.' },
    mastodon: { name: 'Mastodon', tag: 'Read and post from your instance', type: 'social', summary: 'Connect a Mastodon instance with an access token to read and post.' },
    maze: { name: 'Maze', tag: 'Find the way out', type: 'game', summary: 'Navigate a randomly generated maze to the exit.' },
    memory: { name: 'Memory', tag: 'Match the pairs', type: 'game', summary: 'Flip cards to find matching pairs in as few moves as possible.' },
    mindmap: { name: 'Mindmap', tag: 'Connected ideas, PNG and SVG export', type: 'tool', summary: 'Arrange ideas as connected nodes and export the result as PNG or SVG.' },
    minesweeper: { name: 'Minesweeper', tag: 'Clear the minefield', type: 'game', summary: 'Clear a minefield using the numbers on safe squares.' },
    mini: { name: 'Mini Crossword', tag: 'A quick 5x5 crossword', type: 'game', summary: 'A quick five-by-five crossword from a bundled puzzle set.' },
    moderation: { name: 'Moderation', tag: 'Owner-only console', type: 'system', desc: 'The owner-only ReKindle moderation console.', noindex: true },
    napkin: { name: 'Sketchpad', tag: 'Quick drawing canvas', type: 'media', summary: 'A quick blank canvas for drawing with a pen or finger.' },
    neighbourhood: { name: 'Neighbourhood', tag: 'Community posts and profiles', type: 'social', summary: 'A profile-based community for posts, comments, profiles and messaging.' },
    nerdle: { name: 'Nerdle', tag: 'Guess the hidden maths equation', type: 'game', summary: 'Guess a hidden maths equation in six tries.' },
    newspaper: { name: 'News', tag: 'Daily headlines by section', type: 'reading', summary: 'A daily digest of headlines by section, with a clean article reader.' },
    nonograms: { name: 'Nonograms', tag: 'Picture logic puzzles', type: 'game', summary: 'Reveal a hidden picture from row and column number clues.' },
    notes: { name: 'Notes', tag: 'Notes with formatting and sync', type: 'tool', summary: 'A clean note editor with bold, italic and underline, sorting and cloud sync.' },
    oregontrail: { name: 'Oregon Trail', tag: 'The 1848 journey west', type: 'game', summary: 'Lead five people 2,000 miles to Oregon in 1848, with limited supplies and a winter deadline.' },
    pacman: { name: 'Pac-Man', tag: 'Dodge ghosts, eat the dots', type: 'game', summary: 'Eat every dot, dodge four ghosts and use power pellets to turn the tables.' },
    pay: { name: 'ReKindle+', tag: 'Membership and pricing', type: 'info', desc: 'ReKindle+ membership: cloud storage, Docs, Mail, Photo Frame and Pro features, with pricing and billing details.' },
    pet: { name: 'Pet', tag: 'Raise a virtual pet', type: 'media', summary: 'Raise a virtual pet through egg, child, teen and adult stages.' },
    photoframe: { name: 'Photo Frame', tag: 'Photo slideshow for e-ink', type: 'media', summary: 'Turn the e-reader into a photo slideshow with adjustable timing and layout.' },
    pinterest: { name: 'Pinterest', tag: 'Browse pins and your boards', type: 'social', summary: 'Browse pins, search ideas and view or save to your boards.' },
    pixel: { name: 'Pixel', tag: '1-bit pixel art editor', type: 'media', summary: 'Draw 1-bit pixel art on 16x16, 32x32 or 64x64 grids, set it as wallpaper or post it.' },
    pool: { name: '8 Ball Pool', tag: 'Solo or two-player pool', type: 'game', summary: 'Aim, shoot and pocket your balls before the 8-ball, solo or local two-player.' },
    pool2p: { name: '2-Player 8 Ball', tag: 'Pool for two on one device', type: 'game', desc: '8-ball pool for two players on one device: aim, shoot and pocket the 8-ball last.' },
    privacy: { name: 'Privacy Policy', tag: 'What ReKindle stores and why', type: 'info', desc: 'What ReKindle collects, where it is stored and how to delete your account and data.' },
    probe: { name: 'Browser Probe', tag: 'E-ink browser diagnostics', type: 'system', desc: 'A browser capability probe used to diagnose the Kindle and Kobo browser.', noindex: true },
    quicknotes: { name: 'Quick Notes', tag: 'Scratchpad for quick ideas', type: 'tool', desc: 'A fast scratchpad that saves as you type - make a quick note and get back to reading.' },
    quicktodo: { name: 'Quick ToDo', tag: 'Handwriting to digital tasks', type: 'tool', summary: 'Write tasks by hand and let handwriting recognition turn them into digital todos.' },
    reader: { name: 'Reader', tag: 'EPUB library, Gutenberg and more', type: 'reading', summary: 'The main library: your own EPUBs, Project Gutenberg and Standard Ebooks in one place.' },
    readlater: { name: 'Read Later', tag: 'Save links to read on e-ink', type: 'reading', summary: "Save links for later and open them in Browser's reader view when you have time." },
    readwise: { name: 'Readwise', tag: 'Your highlights and daily review', type: 'reading', summary: 'Connect a Readwise account to read saved articles, highlights and the daily review.' },
    reddit: { name: 'Reddit', tag: 'Text-first Reddit reader', type: 'social', summary: 'A text-first Reddit browser for saved subreddits, with automatic retry when rate-limited.' },
    rssreader: { name: 'RSS Reader', tag: 'Follow feeds, track unread', type: 'reading', summary: 'Follow feeds in a clean reader, with preset sources and unread tracking.' },
    scores: { name: 'Scores', tag: 'Live sports results', type: 'info', summary: 'Live and recent scores for major leagues, with Favourites for your teams in one feed.' },
    settings: { name: 'Settings', tag: 'Display, language and account', type: 'system', desc: 'Display scale, language, integrations and account settings for ReKindle.', noindex: true },
    sheetmusic: { name: 'Sheet Music', tag: 'MusicXML and MIDI scores', type: 'media', summary: 'Browse and render MusicXML or MIDI scores, and build a personal library.' },
    snake: { name: 'Snake', tag: 'Eat, grow, avoid your tail', type: 'game', summary: 'Eat, grow longer and avoid your own tail in the arcade classic.' },
    solitaire: { name: 'Solitaire', tag: 'Klondike, scored by fewest moves', type: 'game', summary: 'Classic Klondike solitaire, scored by the fewest moves.' },
    spellbound: { name: 'Spelling Bee', tag: 'Make words from seven letters', type: 'game', summary: 'Make words from seven letters, always using the centre letter.' },
    stocks: { name: 'Stocks', tag: 'Shares and crypto watchlist', type: 'tool', summary: 'A watchlist with price charts for shares and crypto, plus a guest-mode fallback.' },
    strands: { name: 'Strands', tag: 'Trace the hidden theme words', type: 'game', summary: 'Trace hidden theme words through a letter grid, including the edge-to-edge spangram.' },
    streak: { name: 'Habit Tracker', tag: 'Weekly habits and streaks', type: 'tool', summary: 'Build weekly habits and keep a visual streak history.' },
    substack: { name: 'Substack', tag: 'Read your inbox and posts', type: 'reading', summary: 'Read your Substack inbox, subscriptions and paid posts with a session cookie.' },
    sudoku: { name: 'Sudoku', tag: 'Free Sudoku puzzles for e-ink', type: 'game', summary: 'Fill a 9x9 grid so every row, column and box contains 1-9.' },
    suggestions: { name: 'Suggestions', tag: 'Request features and report bugs', type: 'info', summary: 'Post feature ideas, bugs and translation fixes, vote on others and follow the status.' },
    surfer: { name: 'Surfer', tag: 'Three-lane endless runner', type: 'game', summary: 'A three-lane endless runner: dodge trains, jump barriers and roll under signs.' },
    tasks: { name: 'Tasks', tag: 'Task list with Google Tasks sync', type: 'tool', summary: 'A simple task list that syncs with Google Tasks or stays local.' },
    teleprompter: { name: 'Teleprompter', tag: 'Big-text script line by line', type: 'tool', summary: 'Show a note line by line in huge text for speeches, scripts and practice.' },
    tetris: { name: 'Blocks', tag: 'Tetris-style falling blocks', type: 'game', summary: 'Rotate and drop falling blocks to clear lines and score.' },
    texasholdem: { name: "Texas Hold'em", tag: 'Fixed-limit poker against bots', type: 'game', summary: 'A fixed-limit poker table against three bots, with a $1,000 bank.' },
    tictactoe: { name: 'Tic-Tac-Toe', tag: 'Beat the computer or a friend', type: 'game', summary: 'The classic three-in-a-row game, with an easy or unbeatable hard AI.' },
    timer: { name: 'Timer', tag: 'Pomodoro, stopwatch, countdown', type: 'tool', summary: 'Focus timer, Pomodoro sessions, stopwatch and custom countdowns.' },
    topics: { name: 'Topics', tag: 'Discussion threads and polls', type: 'social', summary: 'Start discussion threads with optional polls and reply to other readers.' },
    translate: { name: 'Translator', tag: 'Ten languages, auto-detect', type: 'tool', summary: 'Translate text between ten languages with automatic source detection.' },
    trivia: { name: 'Trivia', tag: 'Ten-question quizzes', type: 'game', summary: 'Ten-question quizzes with category, difficulty and type filters.' },
    uno: { name: 'Uno', tag: 'Bots or online, 2-10 players', type: 'game', summary: 'Play Uno against three bots solo, or join an online match for two to ten players.' },
    watchlist: { name: 'Watchlist', tag: 'Films and TV to watch', type: 'media', summary: 'Track films and TV shows, keep a watch list and see release dates on a calendar.' },
    weather: { name: 'Weather', tag: 'Forecast for your locations', type: 'info', summary: 'Current conditions, a 24-hour strip and a five-day forecast for saved locations.' },
    wikipedia: { name: 'Wikipedia', tag: 'Search or read a random article', type: 'info', summary: 'Search the free encyclopedia or open a random article.' },
    wordle: { name: 'Wordle', tag: 'Daily and unlimited five-letter words', type: 'game', summary: 'Guess the five-letter word in six tries, with daily and unlimited modes.' },
    words: { name: 'Words Online', tag: 'Scrabble-style matches, async', type: 'game', summary: 'An asynchronous Scrabble-style match against another ReKindle user.' },
    wordsearch: { name: 'Word Search', tag: 'Find words in every direction', type: 'game', summary: 'Find hidden words in a letter grid in any direction.' },
    yahtzee: { name: 'Yahtzee', tag: 'Thirteen rounds of dice', type: 'game', summary: 'Roll five dice over thirteen rounds and fill every scoring category.' }
};

/** Canonical path for a page slug: 'index' -> '/', 'sudoku' -> '/sudoku'. */
function pathFor(slug) {
    return slug === 'index' ? '/' : '/' + slug;
}

/**
 * Resolved metadata for one page slug (no .html). Returns null for a slug with
 * no entry, which is how the tests spot a page someone forgot to register.
 */
function seoFor(slug) {
    const p = PAGES[slug];
    if (!p) return null;

    const title = p.title || (p.name + ' \u2013 ' + p.tag + ' | ReKindle');
    const tail = TAILS[p.type] || '';
    const desc = p.desc || (p.summary + (tail ? ' ' + tail : ''));
    const canonical = SITE + pathFor(slug);

    return {
        slug: slug,
        name: p.name,
        type: p.type,
        title: title,
        desc: desc,
        h1: p.h1 || p.name,
        canonical: canonical,
        noindex: !!p.noindex,
        image: OG_IMAGE,
        category: CATEGORY[p.type] || 'UtilitiesApplication'
    };
}

/** Every registered slug, sorted. */
function slugs() {
    return Object.keys(PAGES).sort();
}

/** Slugs that must never appear in sitemap.xml. */
function noindexSlugs() {
    return slugs().filter(function (s) { return PAGES[s].noindex; });
}

module.exports = { SITE: SITE, OG_IMAGE: OG_IMAGE, PAGES: PAGES, pathFor: pathFor, seoFor: seoFor, slugs: slugs, noindexSlugs: noindexSlugs };
