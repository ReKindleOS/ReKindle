/*
 * ReKindle Help content.
 *
 * Every article is plain data so the Help app can search and render it
 * without any network requests. Keep body HTML simple: p, ul, ol, li, b,
 * code, table, and .note boxes are styled by help.html.
 *
 * Fields:
 *   id       - hash / deep link (must be unique)
 *   cat      - HELP_CATEGORIES id
 *   title    - article heading
 *   summary  - one-line description used in lists and search
 *   body     - trusted HTML string
 *   tags     - extra search words (not displayed)
 *   badges   - optional labels such as REKINDLE+, BETA, NEW, 1P, 2P, LIVE
 *   appHref  - optional page to launch (without .html)
 *   appName  - label for the launch button
 *   related  - optional array of article ids
 *   sub      - optional sub-heading used to group the Games category
 */

var HELP_CATEGORIES = [
    { id: 'start', title: 'Getting started', desc: 'Set up ReKindle, sign in, sync your data and find your way around.' },
    { id: 'essentials', title: 'Essentials', desc: 'The daily dashboard: browser, calendar, contacts, mail, news, weather and scores.' },
    { id: 'reading', title: 'Reading & news', desc: 'Books, comics, RSS, read-later lists and your reading log.' },
    { id: 'productivity', title: 'Productivity', desc: 'Tasks, notes, documents, focus timers and personal records.' },
    { id: 'tools', title: 'Tools & reference', desc: 'Calculators, maps, translation, AI, reference and everyday utilities.' },
    { id: 'lifestyle', title: 'Lifestyle & media', desc: 'Social feeds, music, cooking, photos and creative tools.' },
    { id: 'social', title: 'Community & safety', desc: 'KindleChat, Neighbourhood, Topics and how to stay safe.' },
    { id: 'games', title: 'Games', desc: 'Every game from Wordle to Oregon Trail, plus controls and leaderboards.' },
    { id: 'settings', title: 'Settings & help', desc: 'Control Panel options, display, accessibility, privacy and troubleshooting.' }
];

var HELP_ARTICLES = [];

HELP_ARTICLES = HELP_ARTICLES.concat([

    /* ------------------------------------------------------------------ */
    /* GETTING STARTED                                                     */
    /* ------------------------------------------------------------------ */

    {
        id: 'welcome',
        cat: 'start',
        title: 'Welcome to ReKindle',
        summary: 'What ReKindle is, the two ways to use it, and the fastest way to get started.',
        tags: 'intro about start new beginner overview dashboard eink kindle kobo boox',
        related: ['install', 'account', 'home', 'badges'],
        body: `
            <p>ReKindle is a web dashboard for E-ink devices. It turns a Kindle, Kobo or Boox e-reader into a set of useful apps: a task list, calendar, mail client, reader, RSS feed, games arcade and more. It also works in a normal phone or desktop browser.</p>
            <h2>The two ways to use it</h2>
            <ul>
                <li><b>Guest mode</b> - no account. Everything is stored in your browser's local storage on that device. Nothing is uploaded to ReKindle.</li>
                <li><b>Cloud mode</b> - a free ReKindle account. App data, favourites and supported settings sync through Google Firebase, so a second device can pick up where you left off.</li>
            </ul>
            <p>You can start in guest mode and register later. Games, notes, tasks and most tools work in both modes; social apps and a few integrations need an account.</p>
            <h2>Your first five minutes</h2>
            <ol>
                <li>Open <b>rekindle.ink</b> in the device browser and bookmark it. See <a href="#install">Installing and supported devices</a>.</li>
                <li>Use the tabs across the top of the home screen to browse Essentials, Tools, Lifestyle, Games and Multiplayer. The house tab shows every app; the grid tab opens the dashboard widgets.</li>
                <li>Open <b>Settings</b> (top menu) and set your location, units and display scale. Location fixes the clock, weather and language detection.</li>
                <li>If you want sync, tap <b>LOG IN / REGISTER</b> and create an account. See <a href="#account">Account and sign-in</a>.</li>
                <li>Star the apps you use most: tap <b>Edit</b> on the home screen, then the star on an app. See <a href="#home">The home screen</a>.</li>
            </ol>
            <div class="note"><b>Good to know:</b> ReKindle is a website, not an installed app. Normal use needs no jailbreak, app store install or USB step; a bookmark or home-screen shortcut is enough. The optional <a href="#kindle-fullscreen">ReKindle launcher</a> is <b>highly experimental</b> and only for jailbroken Kindles that want the browser chrome gone.</div>
            <p>This Help app covers every app and game. Use the search box on the left (or the category buttons) and the <a href="#all">A-Z index</a> when you know the name of something.</p>
        `
    },
    {
        id: 'install',
        cat: 'start',
        title: 'Installing and supported devices',
        summary: 'Bookmark ReKindle, add it to a home screen, and which device builds work best.',
        tags: 'pwa install bookmark home screen kindle kobo boox firmware 5.16.4 lite legacy offline',
        related: ['welcome', 'troubleshooting', 'input'],
        body: `
            <p>ReKindle is a Progressive Web App (PWA). It runs in the browser and needs no installation, but a home-screen shortcut makes it feel like an app.</p>
            <h2>Recommended setup</h2>
            <ol>
                <li>Open the browser on your e-reader and go to <b>rekindle.ink</b>.</li>
                <li>Bookmark the page. On Kindles the browser menu usually calls this "Add to Home" or "Bookmark this page".</li>
                <li>If your device offers "Add to Home Screen", use it. The ReKindle icon then opens the dashboard directly.</li>
                <li>Sign in, or stay in guest mode. See <a href="#account">Account and sign-in</a>.</li>
            </ol>
            <h2>Device builds</h2>
            <table>
                <tr><th>Device / browser</th><th>What you get</th></tr>
                <tr><td>Kindle firmware 5.16.4+ (Chromium-based browser)</td><td>The main ReKindle experience. This is the recommended baseline.</td></tr>
                <tr><td>Older Kindles (pre-Chromium / WebKit)</td><td>The Lite build: all app JavaScript is converted to older syntax and older-browser fixes are applied. Some modern apps may still be limited.</td></tr>
                <tr><td>Kobo and very old browsers</td><td>The Legacy build: heavier transpilation and polyfills. Expect slower rendering and fewer apps.</td></tr>
                <tr><td>Phone, tablet, desktop</td><td>Full site. Keyboard shortcuts and a mouse work in most apps and games.</td></tr>
            </table>
            <div class="note"><b>Why firmware matters:</b> ReKindle targets the Chromium 75 browser shipped on newer Kindles. Very old browsers cannot run modern JavaScript features, which is why the Lite and Legacy builds exist.</div>
            <div class="note"><b>Want no browser chrome?</b> On a jailbroken Kindle with firmware 5.16.4+, the optional <a href="#kindle-fullscreen">ReKindle launcher</a> hides the Kindle interface and browser chrome. Treat it as <b>highly experimental</b>: it changes how the Kindle starts its browser, has very little real-device testing, and is not a supported ReKindle feature. Normal bookmark use needs none of it.</div>
            <h2>Offline use</h2>
            <p>The dashboard shell and some assets are cached by a service worker, but most apps need a network connection for their data. Games that store state locally keep working offline. Cloud sync resumes when you reconnect.</p>
            <h2>Storage and clearing data</h2>
            <p>Guest data lives in <code>localStorage</code>. The Kindle browser can wipe its cache when storage is tight, so do not treat guest mode as a permanent backup. See <a href="#storage">Where your data lives</a>.</p>
        `
    },
    {
        id: 'kindle-fullscreen',
        cat: 'start',
        title: 'ReKindle on a jailbroken Kindle',
        summary: 'Highly experimental: run ReKindle fullscreen on a jailbroken Kindle, and recover if the launcher gets stuck.',
        tags: 'kindle fullscreen full screen jailbreak jailbroken scriptlet launcher appmgrd chromebar 5.16.4 usb documents kpm cover experimental unstable unsupported risky',
        badges: ['HIGHLY EXPERIMENTAL'],
        related: ['install', 'settings', 'troubleshooting'],
        body: `
            <div class="note warn"><b>Highly experimental - use at your own risk</b><br>This add-on is a community experiment, not a supported ReKindle feature. It has been tried on very few Kindle models and firmware versions, it changes how the device starts its browser, and a failed launch can leave the Kindle stuck until you reboot it. Do not install it on a Kindle you depend on, and do not expect support if it misbehaves. Nothing in ReKindle needs it: a bookmark works on every supported device.</div>
            <p>On a jailbroken Kindle with firmware 5.16.4 or newer, the optional <b>ReKindle</b> launcher mounts the stock Chromium image, stops the Kindle interface, and opens <code>rekindle.ink</code> as the <code>framework</code> user with Amazon's own flags. ReKindle keeps its normal framed layout.</p>
            <div class="note"><b>Requirements:</b> a jailbroken Kindle on firmware 5.16.4+ with scriptlet support from the Universal Hotfix. Older Kindles use the WebKit browser and cannot run this launcher. Normal ReKindle use needs no jailbreak, and this add-on is optional, unsupported and highly experimental.</div>
            <h2>Install</h2>
            <ol>
                <li>Jailbreak the Kindle with the <a href="https://kindlemodding.org/jailbreak-wizard.html" target="_blank" rel="noopener">KindleModding wizard</a>, then block automatic updates.</li>
                <li><b>Over USB (recommended):</b> download the ZIP from the <a href="kindle">ReKindle for Kindle guide</a>, unzip it, and copy the <code>documents</code> folder into the Kindle's root folder, merging with the existing one.</li>
                <li><b>No computer, with kterm:</b> install kterm with <code>;kpm install kterm</code>, open kterm, then run <code>kpm add-repo https://rekindle.ink/downloads/kpm/repo.json</code>, <code>kpm update</code> and <code>kpm install rekindle</code>. Do not run <code>;kpm add-repo</code> from the search bar: Amazon's scriptExecutor rejects <code>.</code> and <code>:</code> in <code>;</code> commands, so the URL never reaches KPM.</li>
                <li>Open the library and tap <b>ReKindle</b> (it may be under Docs or Recent).</li>
            </ol>
            <p>Do not use the direct <code>.sh</code> or <code>.txt</code> links on a stock Kindle browser: it reports <b>Invalid file type</b> because only book formats are allowed. The <code>.txt</code> alias cannot bypass that, because the browser checks the saved filename/type. KPM or USB is required.</p>
            <h2>Exit and recovery</h2>
            <p>Press the <b>power button once</b> to close ReKindle and restart the Kindle interface. If the Kindle is stuck, hold power until it reboots; the launcher changes no boot files.</p>
            <h2>Display behavior</h2>
            <p>The launcher does not stretch ReKindle. The dashboard keeps its desktop frame and apps open in their normal System 7 windows; only the Kindle interface and browser chrome are removed. The full guide covers uninstalling and troubleshooting.</p>
            <p><a href="kindle">Open the full ReKindle for Kindle guide &rarr;</a></p>
        `
    },
    {
        id: 'account',
        cat: 'start',
        title: 'Account and sign-in',
        summary: 'Create a ReKindle account, sign in, change your password and understand age checks.',
        tags: 'login register signup sign in logout password username account age verification social',
        related: ['sync', 'storage', 'safety', 'pro'],
        body: `
            <p>A ReKindle account is free. It is a username and password - no email address is required. The username is turned into an internal address like <code>yourname@rekindle.ink</code> for Firebase Authentication.</p>
            <h2>Create an account</h2>
            <ol>
                <li>On the home screen tap <b>LOG IN / REGISTER</b>.</li>
                <li>Choose <b>Register</b>, enter a username and password, and submit.</li>
                <li>Usernames must be 1-20 characters and use letters and numbers only. Names that impersonate staff, contain banned words, or promote a competing service are rejected.</li>
            </ol>
            <h2>Sign in and out</h2>
            <ul>
                <li>Sign in with your <b>username</b>, not an email address. Entering an email also works if it is the full account address, but the normal flow is username only.</li>
                <li>The top-right menu shows your username while signed in. Use <b>Log Out</b> there to return to guest mode.</li>
                <li>Signing out does not delete cloud data. Signing back in restores it.</li>
            </ul>
            <h2>Changing your password</h2>
            <p>Open <b>Settings</b> and use <b>Change Password</b> under Account. Enter the current password, then the new one twice. Passwords must be at least 6 characters here.</p>
            <p><b>Forgot the current password?</b> If you are still signed in on this device, choose <b>Forgot your current password?</b> in the same box, type your username to confirm, and set a new password (at least 8 characters). This works from the live session - there is no "forgot password" email because accounts do not require an email address. Only do this on a device you control: anyone who can use a device you are signed in on could reset the password too.</p>
            <p>If you are signed out and locked out, contact <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with your username. Staff can restore access but will never ask for your password.</p>
            <h2>Deleting your account</h2>
            <p>Sign in, open <b>Settings</b> and use <b>Delete Account</b> under Account. Re-enter your password and type your username to confirm. Deletion is permanent and removes your profile, files, posts, chat messages, direct messages, scores and suggestions from both Firebase projects. See the <a href="#faq">FAQ</a> for what to do about an active subscription.</p>
            <h2>Age verification for social apps</h2>
            <p>KindleChat, Neighbourhood and Topics require an age check before they load. You enter your date of birth and country; ReKindle checks the minimum social-media age for that country. The check is a self-declaration, not an ID upload, and the social apps stay locked until it is complete - browsing, posting and messaging all need it.</p>
            <div class="note"><b>Privacy:</b> Your password is handled by Firebase Authentication. Your date of birth and country are used for the age check and kept in your account's age-verification record for audit and support. See the <a href="privacy.html">Privacy Policy</a>.</div>
        `
    },
    {
        id: 'sync',
        cat: 'start',
        title: 'Cloud sync and guest mode',
        summary: 'What syncs between devices, what stays local, and how offline changes behave.',
        tags: 'sync cloud firebase guest local offline multi device favourites settings backup',
        related: ['account', 'storage', 'pro'],
        body: `
            <p>Guest mode and cloud mode use different storage. Understanding the difference prevents most "my data disappeared" reports.</p>
            <h2>What cloud sync covers</h2>
            <p>When signed in, supported apps write to your own Firestore documents under <code>users/{uid}</code>. Typical synced data includes:</p>
            <ul>
                <li>Favourites, hidden apps and home-screen layout.</li>
                <li>General settings: manual location, timezone, units, language, rotation, wallpaper and games toggle.</li>
                <li>App data for tasks, notes, journal, habits, flashcards, reading logs, bookmarks, library items and similar apps.</li>
                <li>Reading positions and books saved into your ReKindle library.</li>
                <li>Social identity (username, public profile, avatars) and social content.</li>
            </ul>
            <p>Not everything syncs. Games mostly keep high scores locally and separately post verified scores to leaderboards. Google OAuth tokens and Readwise tokens stay on the device. Mail saves an encrypted copy of app passwords to your account (and keeps its Outlook token on ReKindle's server), and several Pro integrations save their credentials to your private account records too: the AI Assistant's API key, Dropbox, Bluesky, Mastodon, Pinterest and Substack. Each app's guide says what it stores.</p>
            <h2>Guest mode</h2>
            <p>Guest mode never creates a server record. Data is in your browser's <code>localStorage</code> (and IndexedDB/localforage for larger files such as books). It is available only in that browser on that device. Clearing site data or the browser cache removes it permanently.</p>
            <h2>Offline and conflicts</h2>
            <p>Apps are expected to work from local state first and sync when a connection returns. The account settings listener usually treats the newest timestamp as authoritative. If two devices edit the same item offline, one version can overwrite the other - sync is a convenience, not a real-time collaborative editor.</p>
            <div class="note"><b>Moving devices:</b> sign in on the new device before creating lots of guest data. Guest data is not merged into an account automatically.</div>
            <h2>Google and third-party data</h2>
            <p>Google Tasks, Calendar and Contacts are fetched directly from Google APIs using a token kept in local storage. ReKindle does not copy that data to its own servers. Readwise tokens also stay on the device. AI API keys, Dropbox/Bluesky/Mastodon/Pinterest credentials and a Substack cookie are saved to your private account records (Pro data) so the connection follows you to another device.</p>
        `
    },
    {
        id: 'pro',
        cat: 'start',
        title: 'ReKindle+',
        summary: 'Plans, prices, what a membership unlocks, and how to manage or cancel it.',
        tags: 'pro plus subscription pay pricing stripe upgrade premium supporter monthly yearly lifetime manage cancel',
        related: ['account', 'mail', 'chat', 'files'],
        body: `
            <p>ReKindle+ is an optional supporter subscription. The core dashboard, reader, games and most tools stay free. A membership covers the server costs of cloud and AI features and unlocks the premium apps.</p>
            <h2>Plans</h2>
            <table>
                <tr><th>Plan</th><th>Price</th></tr>
                <tr><td>Monthly</td><td>$2 per month</td></tr>
                <tr><td>Yearly</td><td>$15 per year</td></tr>
                <tr><td>Lifetime</td><td>$30 once</td></tr>
            </table>
            <p>Payment is handled by Stripe from the <a href="pay.html">ReKindle+ page</a>. You must be signed in first, because the membership is attached to your account.</p>
            <h2>What it unlocks</h2>
            <ul>
                <li><b>Mail</b> - IMAP/SMTP email client.</li>
                <li><b>AI Assistant</b> - built-in AI chat (custom API keys also require Pro).</li>
                <li><b>Files</b> and <b>Docs</b> - cloud file storage and a document editor.</li>
                <li><b>Quick ToDo</b> - handwriting OCR task capture.</li>
                <li><b>AirType</b> - pair your phone as a keyboard for the e-reader.</li>
                <li><b>Dropbox</b>, <b>Bluesky</b>, <b>Mastodon</b>, <b>Pinterest</b> and <b>Substack</b> integrations.</li>
                <li><b>Flipbook</b> and <b>Photo Frame</b>.</li>
                <li>Unlimited RSS feeds (free accounts keep two).</li>
                <li>Starting KindleChat direct messages; receiving them is free.</li>
            </ul>
            <h2>Managing and cancelling</h2>
            <p>Open <a href="pay.html">ReKindle+</a> or <b>Settings</b> while signed in. An active membership shows its expiry date and a <b>Manage Subscription</b> button that opens the ReKindle+ page, where the Stripe billing portal link lives. Cancelling stops the renewal; access normally continues to the end of the paid period.</p>
            <div class="note"><b>If Pro does not unlock:</b> wait a minute and refresh, confirm you are signed in as the account that paid, then check the expiry date on the ReKindle+ page. Webhook delays and stale tokens are the usual causes. See <a href="#troubleshooting">Troubleshooting</a>.</div>
            <p>Some Pro features still have their own limits or keys: the hosted AI Assistant allows 10 messages a day (a custom API key removes that cap), Mail depends on your email provider's sign-in, and Dropbox/Bluesky/etc. need your own account.</p>
        `
    },
    {
        id: 'home',
        cat: 'start',
        title: 'The home screen',
        summary: 'How the app grid, dashboard widgets, favourites, hiding, folders and live games work.',
        tags: 'home dashboard app grid tabs favourites favorite hide edit featured folder badges live games layout classic modern sidebar',
        related: ['badges', 'settings', 'sync'],
        body: `
            <p>The home screen is the ReKindle launcher. It has two layouts, chosen in Settings: the modern tabbed layout and the classic sidebar layout. The modern one is the default and shows everything described here. Choosing Classic loads the older dashboard (<a href="#hidden-legacy">index_old</a>) on the next home load.</p>
            <h2>Tabs and views</h2>
            <ul>
                <li><b>All</b> - everything, with a separate All Games section at the bottom.</li>
                <li><b>Dashboard</b> (the grid icon) - clock, weather, calendar agenda and shortcuts.</li>
                <li><b>Essentials / Tools / Lifestyle / Games / Multiplayer Games</b> - category views.</li>
                <li><b>Favourites</b> - apps you star, shown above the grid on the All tab.</li>
                <li><b>Recent</b> - your last opened apps, shown above the grid. Toggle it with <b>Recent: ON/OFF</b> in Edit mode.</li>
                <li><b>Search</b> - the magnifier in the toolbar searches app names and descriptions.</li>
                <li><b>Live Games</b> - joinable online matches. It only appears when something is waiting.</li>
            </ul>
            <h2>Editing the grid</h2>
            <ol>
                <li>Tap <b>Edit</b> above the grid.</li>
                <li>Tap the <b>star</b> on an app to add it to Favourites. Tap again to remove it.</li>
                <li>Tap the <b>eye</b> to hide an app. Hidden apps stay hidden in normal views but remain visible while editing.</li>
                <li>Use <b>Featured: ON/OFF</b> to show or hide the featured row.</li>
                <li><b>Reset</b> clears favourites, hidden apps and the Featured/Recent display toggles.</li>
                <li>Tap <b>Done</b> when finished.</li>
            </ol>
            <p>Favourites and hidden apps sync to your account when signed in, and are cached locally for guest mode.</p>
            <h2>Folders</h2>
            <p>Games with several modes are grouped into one icon. For example, Chess opens a folder containing Single, Local and Live versions. Tap the folder, then choose a mode. The folder title uses the game name; the little badges explain each option (see <a href="#badges">Badges explained</a>).</p>
            <h2>Dashboard widgets</h2>
            <p>The dashboard uses the location saved in Settings. It shows local time, a weather summary with an hourly strip, and today's calendar agenda. If the clock is wrong, set your location in Settings; Kindle system timezones are unreliable and ReKindle applies its own offset.</p>
            <div class="note"><b>Games hidden?</b> If the Games and Multiplayer tabs are missing, open Settings and turn off <b>Disable Games</b>. Parents use this to keep the arcade out of reach.</div>
            <p>Tap the ReKindle logo at the top left for the About panel, which includes Help, Support, Discord, Donate, the Privacy Policy and the Changelog. On a narrow screen it also carries Settings and Log In.</p>
        `
    },
    {
        id: 'badges',
        cat: 'start',
        title: 'Badges explained',
        summary: 'What NEW, BETA, LIVE, 1P, 2P, + and CLOSED mean on an app icon.',
        tags: 'badges new beta live 1p 2p plus closed es6 unsupported folder labels legend',
        related: ['home', 'pro', 'games-overview'],
        body: `
            <p>Small labels on app icons tell you what to expect before you open something.</p>
            <table>
                <tr><th>Badge</th><th>Meaning</th></tr>
                <tr><td><b>NEW</b></td><td>Recently added or substantially rebuilt. Worth a look, but expect the odd rough edge.</td></tr>
                <tr><td><b>BETA</b></td><td>Working but still changing. Data formats or behaviour may change, and bugs are more likely.</td></tr>
                <tr><td><b>LIVE</b></td><td>Online multiplayer against other ReKindle users. Needs an account and a connection.</td></tr>
                <tr><td><b>1P</b></td><td>Single-player version, shown inside a game folder.</td></tr>
                <tr><td><b>2P</b></td><td>Local pass-and-play version for two people sharing one device.</td></tr>
                <tr><td><b>+</b></td><td>Requires an active ReKindle+ membership. Tapping opens the subscribe prompt. See <a href="#pro">ReKindle+</a>.</td></tr>
                <tr><td><b>CLOSED</b></td><td>Reserved for an app whose service is temporarily unavailable; tapping explains why. No app currently uses it.</td></tr>
            </table>
            <h2>Unsupported-app warning</h2>
            <p>Some apps require a modern browser. On older Kindles or the Legacy build they show an unsupported warning instead of launching. That is a device limitation, not a broken install. Apps affected include several canvas games and the handwriting tool. Newer firmware and the main build are the fix.</p>
            <h2>Folder badges</h2>
            <p>Inside a game folder, each entry is labelled with its mode: 1P for single-player, 2P for local two-player, LIVE for online. A game with only one mode has no folder - tap it directly.</p>
            <div class="note"><b>Tip:</b> If an app has a + but you have already subscribed, refresh the home page. The badge is recalculated when your membership status loads.</div>
        `
    },
    {
        id: 'storage',
        cat: 'start',
        title: 'Where your data lives',
        summary: 'Local storage limits, the Kindle cache trap, cloud records and how to avoid losing work.',
        tags: 'storage localstorage cache 64mb data loss backup firestore localforage clear cache privacy',
        related: ['sync', 'account', 'troubleshooting'],
        body: `
            <p>ReKindle uses three kinds of storage. Knowing which one holds your work tells you what a cache clear will destroy.</p>
            <h2>1. Browser local storage</h2>
            <p>Small settings and guest app data live in <code>localStorage</code>. Kindle browsers allow roughly 64 MB of global cache; when the device runs low, it can wipe the entire cache directory at launch. Treat local storage as convenient, not permanent.</p>
            <h2>2. IndexedDB / localforage</h2>
            <p>Larger local objects - saved EPUBs, files queued for upload, image libraries - use IndexedDB through localforage. It has more room but is still tied to the browser profile and can be cleared.</p>
            <h2>3. Firebase cloud records</h2>
            <p>When signed in, supported apps save to your own Firestore documents. This survives cache clears and follows you to another device. Social content lives in the separate social Firebase project. Critical data belongs here, not in local storage.</p>
            <h2>What clearing site data does</h2>
            <ul>
                <li>Signs you out.</li>
                <li>Deletes guest data permanently.</li>
                <li>Removes local caches and downloaded books.</li>
                <li>Cloud data stays safe and returns when you sign in again.</li>
            </ul>
            <div class="note"><b>Before clearing:</b> sign in and open the app once so unsynced changes get a chance to write. There is no general "export everything" button yet; for a specific app, use its download/export option (Docs, Mindmap, Pixel, Flipbook, Sheet Music) or contact support.</div>
            <h2>Privacy</h2>
            <p>Guest mode sends no personal data to ReKindle. Cloud mode sends only what the apps you use need. Google and Readwise tokens stay on the device. Mail app passwords, AI API keys and several Pro integration credentials (Dropbox, Bluesky, Mastodon, Pinterest, Substack) are stored in your private Firebase records, so clearing site data does not remove them. Read the full <a href="privacy.html">Privacy Policy</a>.</p>
        `
    },
    {
        id: 'input',
        cat: 'start',
        title: 'Touch, keyboard and e-ink tips',
        summary: 'Controls on an e-reader, keyboard support, ghosting, and how to avoid double taps.',
        tags: 'touch keyboard controls gestures eink ghosting refresh tap buttons arrows input accessibility',
        related: ['install', 'display', 'games-overview'],
        body: `
            <p>ReKindle is designed for slow e-ink screens and imprecise fingers. A few habits make everything feel better.</p>
            <h2>Touch</h2>
            <ul>
                <li>Tap once and wait for the screen to update. E-ink can take a moment; double-tapping often submits twice.</li>
                <li>Scroll by dragging inside the content area. Lists and long articles scroll independently of the title bar.</li>
                <li>On games, use the large on-screen arrow or action buttons rather than tiny icons.</li>
                <li>Text inputs open the device keyboard. Use landscape orientation for more room if your device supports it.</li>
            </ul>
            <h2>Keyboard</h2>
            <p>On a computer or a Kindle with a keyboard, normal typing works in every form. Arrow keys and Space are used by many games; Enter submits searches and chat messages according to each app's setting. Some apps also support shortcuts such as Ctrl+F for browser find (the device browser's own find, not an in-app search).</p>
            <h2>Ghosting and flashes</h2>
            <p>E-ink leaves faint traces of the previous screen. Open <b>Settings -> Display Mode</b>:</p>
            <ul>
                <li><b>LED (No Flashes)</b> - fewer full refreshes; some ghosting.</li>
                <li><b>eInk (Anti-Ghosting)</b> - more full refreshes; cleaner text, more flashing.</li>
            </ul>
            <p>Games and scrolling can look smeary on either setting. That is the panel, not a rendering bug.</p>
            <h2>Scaling</h2>
            <p>If text is too small or controls fall off the screen, use <b>Settings -> Auto Scaling</b> or pick a fixed zoom level. Games that need precise coordinates are exempted from page zoom so taps stay aligned; a few apps may still behave oddly at extreme zoom. See <a href="#display">Display and scaling</a>.</p>
            <div class="note"><b>No emojis in text fields?</b> The Kindle browser has no colour emoji font. ReKindle uses OpenMoji images in KindleChat and ASCII art everywhere else. Typing a Unicode emoji into a plain text field can render as an empty box.</div>
        `
    },
    {
        id: 'support',
        cat: 'start',
        title: 'Getting help and reporting problems',
        summary: 'Where to ask, what to include, and how to report content or a broken guide.',
        tags: 'support contact email discord suggestions report bug feedback help community moderation',
        related: ['troubleshooting', 'safety', 'suggestions'],
        body: `
            <p>There are several ways to get help, depending on what you need.</p>
            <h2>Email support</h2>
            <p>Write to <a href="mailto:support@rekindle.ink">support@rekindle.ink</a>. Include:</p>
            <ul>
                <li>Your ReKindle username (not your password).</li>
                <li>Device model and firmware version, if you know it (for example "Kindle Paperwhite 11th gen, 5.16.4").</li>
                <li>The app or game name and the exact steps that failed.</li>
                <li>What you expected and what happened instead.</li>
                <li>A screenshot or photo of the screen if possible.</li>
            </ul>
            <h2>Discord</h2>
            <p>Join the community Discord from the About panel (tap the ReKindle logo on the home screen) or the Discord app icon. It is the fastest place for "is this broken for everyone?" questions. See <a href="#discord">Discord community</a> for the invite and etiquette.</p>
            <h2>Suggestions</h2>
            <p>The <a href="#suggestions">Suggestions</a> app is the official feature-request and bug tracker. You can post an idea, a problem or a translation issue, vote on others, and follow status changes. Search before posting - duplicates are merged or closed.</p>
            <h2>Reporting content or a person</h2>
            <p>In KindleChat, Neighbourhood and Topics, use the <b>!</b> report control on a message, post or comment. A report adds a snapshot of the content and its author to ReKindle's report queue. Every report needs a reason and a short comment containing at least one real word. Chat messages, DMs and comments are removed on the first report; topics and posts need two independent reports. In KindleChat you can also block a user from inside a direct message thread, and unblock them again there. For urgent safety issues, email support and say "safety" in the subject.</p>
            <div class="note"><b>Help app feedback:</b> every guide has a "Report a problem" link at the bottom that opens an email with the guide title filled in. Typos, outdated steps and missing apps are all worth reporting.</div>
        `
    },
    {
        id: 'whats-new',
        cat: 'start',
        title: "What's new",
        summary: 'Recent additions to ReKindle, including this Help app and the newest games and integrations.',
        tags: 'new updates changelog recent added latest release 2026',
        related: ['welcome', 'games-overview', 'reader'],
        body: `
            <p>ReKindle is actively developed. This page lists the changes most likely to affect how you use it, current as of <b>October 2026</b>. For the complete commit log, open the <a href="changelog.html">Changelog</a>.</p>
            <h2>Recently added</h2>
            <ul>
                <li><b>Mail: Outlook and Hotmail</b> - Microsoft sign-in codes replace app passwords, so a Microsoft mailbox works without typing a password on the Kindle.</li>
                <li><b>Delete Account</b> - permanent self-service deletion in Settings, including cloud files, posts, chat messages and scores.</li>
                <li><b>Forgot current password</b> - reset the password from a signed-in device without an email address.</li>
                <li><b>Dark mode</b> - Light, Dark and Auto (Night) themes are available again, marked BETA.</li>
                <li><b>Changelog</b> - a searchable list of every commit, linked from the About panel.</li>
                <li><b>Help &amp; FAQ</b> - this app: every app, game, setting and account feature, with search and an A-Z index.</li>
                <li><b>Reader</b> - Gutenberg and Standard Ebooks live as tabs inside Reader, with a shared library and reading positions that sync.</li>
                <li><b>KindleChat direct messages</b> - moderated one-to-one chats, opt-in requests, blocking and unblocking.</li>
                <li><b>Car Games, Cube Dash, Surfer, Crossy</b> - new games tuned for e-ink, alongside the rebuilt <b>Oregon Trail</b>.</li>
                <li><b>AI Assistant</b> - bring-your-own-key support for many providers, plus a hosted Gemini option.</li>
                <li><b>AirType</b> - use your phone as a keyboard for the e-reader.</li>
                <li><b>Pinterest</b> and <b>Dropbox</b> integrations for ReKindle+ members.</li>
            </ul>
            <h2>Recently improved</h2>
            <ul>
                <li>Game leaderboards are server-validated, so impossible scores are rejected.</li>
                <li>Social moderation is automatic: reported chat, DMs and comments are removed on the first report, and the moderation console is owner-only.</li>
                <li>KindleChat translations are more reliable, and flood/link/promotion blocking is enforced on the server as well as in the browser.</li>
                <li>The Suggestions board loads faster, finds duplicates as you type, and pages older ideas with <b>Load older</b>.</li>
                <li>Pinterest authorises once and follows your account to other devices.</li>
                <li>Reader pagination, font sizes and resume positions were smoothed out for e-ink.</li>
            </ul>
            <div class="note"><b>Looking for an app?</b> If an icon moved, use the <a href="#all">A-Z index</a> or search this help app. New apps get a NEW badge on the home screen.</div>
        `
    },
    {
        id: 'faq',
        cat: 'start',
        title: 'Frequently asked questions',
        summary: 'Short answers to the questions people ask most often.',
        tags: 'faq questions free account kindle kobo desktop offline dark mode emoji cancel pro refund billing payment delete data games',
        related: ['welcome', 'account', 'pro', 'troubleshooting'],
        body: `
            <h2>Is ReKindle free?</h2>
            <p>Yes. The dashboard, reader, games and most tools are free. ReKindle+ ($2/month, $15/year or $30 lifetime) is optional and unlocks Mail, AI, Files, Docs and a few integrations. See <a href="#pro">ReKindle+</a>.</p>
            <h2>Do I need an account?</h2>
            <p>No. Guest mode stores data locally. An account is needed for cloud sync, social apps, live multiplayer and ReKindle+ purchases.</p>
            <h2>Does it work on my Kindle?</h2>
            <p>Kindle firmware 5.16.4 or newer is the recommended baseline. Older Kindles get the Lite build, and Kobo/very old browsers get the Legacy build with fewer features. See <a href="#install">Installing and supported devices</a>.</p>
            <h2>Can I use it on a phone or computer?</h2>
            <p>Yes. Open rekindle.ink in any modern browser. Everything works, and a physical keyboard is handy for the games and editors.</p>
            <h2>Is my data private?</h2>
            <p>Guest mode keeps everything on the device. Cloud mode stores only what your apps need in your own Firebase records. Google and Readwise tokens stay on the device; Mail, AI and several Pro integrations keep credentials in your private Firebase records. Details are in the <a href="privacy.html">Privacy Policy</a>.</p>
            <h2>How does dark mode work?</h2>
            <p>Open <b>Settings</b> and set Theme to <b>Light</b>, <b>Dark</b> or <b>Auto (Night)</b>. Auto switches to dark after 6pm and back at 6am, using your saved timezone, or follows the system preference. Dark mode is marked BETA: it inverts the whole interface, so photos and some accent colours look different. Bright themes usually ghost less on e-ink panels.</p>
            <h2>Why do typed emojis show as boxes?</h2>
            <p>The Kindle browser has no colour emoji font. Use ASCII emoticons like <code>:)</code> or the KindleChat emoji picker, which inserts OpenMoji images instead of Unicode characters. See <a href="#kindlechat">KindleChat</a>.</p>
            <h2>I forgot my password</h2>
            <p>If you are still signed in on a device, open <b>Settings</b>, choose <b>Change Password</b> and use <b>Forgot your current password?</b> to set a new one without email. If you are signed out, email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with your username. See <a href="#account">Account and sign-in</a>.</p>
            <h2>How do I cancel ReKindle+?</h2>
            <p>Open the ReKindle+ page while signed in and use <b>Manage Subscription</b>. It opens the Stripe billing portal. Access continues until the end of the paid period.</p>
            <h2>I paid but Pro is missing, or I need a refund</h2>
            <p>Email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> from the address used at checkout. Include your ReKindle username, the purchase date and the amount. Do not post card details or receipts on the Suggestions board or in chat.</p>
            <p>If Pro disappeared after a renewal, open the ReKindle+ page and confirm the subscription is active under <b>Manage Subscription</b> first; the membership webhook can take a minute to land. A refund is handled case by case - a cancelled subscription stops future renewals but does not automatically refund the current period.</p>
            <h2>How do I delete my account or data?</h2>
            <p>Sign in, open <b>Settings</b> and tap <b>Delete Account</b> under Account. Re-enter your password and type your username to confirm. Deletion is permanent and removes your account plus its content - notes, files, posts, chat messages, DMs, scores and suggestions - from both Firebase projects.</p>
            <p>If you subscribe to ReKindle+, check <b>Manage Subscription</b> on the ReKindle+ page afterwards and cancel there if the plan is still active. If you are locked out, email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with your username. Guest data can be removed by clearing the browser's site data.</p>
            <h2>Why is a game or app missing?</h2>
            <p>Check Settings for <b>Disable Games</b>, check whether the app is hidden in Edit mode, and check the A-Z index for a renamed app. Some unlisted pages are described in <a href="#hidden-legacy">Unlisted &amp; legacy pages</a>.</p>
            <h2>Why is the clock or date wrong?</h2>
            <p>Kindle timezones are unreliable. Open Settings and set your location; ReKindle applies the saved offset. See <a href="#troubleshooting">Troubleshooting</a>.</p>
        `
    },
    {
        id: 'troubleshooting',
        cat: 'start',
        title: 'Troubleshooting',
        summary: 'Fix blank pages, stale content, login problems, missing apps and sync issues.',
        tags: 'fix broken blank page refresh cache login loop timezone weather pro not working offline network stale slow blocked spain laliga liga isp vpn bloqueo cloudflare',
        related: ['faq', 'storage', 'display'],
        body: `
            <p>Most problems come from a stale cache, a missing login, or a network request that failed quietly. Work through this list in order.</p>
            <h2>Blank page, unstyled page or "Error response"</h2>
            <ol>
                <li>Reload once. E-ink browsers sometimes drop the first paint.</li>
                <li>Check that you are online and that rekindle.ink opens in another tab.</li>
                <li>Clear the browser's site data for rekindle.ink, then sign in again. This signs you out and removes guest data.</li>
                <li>If you are testing locally, make sure the server resolves extensionless URLs like <code>/help</code> to <code>/help.html</code>.</li>
            </ol>
            <h2>An app shows old content</h2>
            <p>Pages are cached aggressively. Use the app's own <b>Refresh</b> button, reopen it from the home screen, or clear site data. Updating to the latest deployment is automatic on reload, but a service worker can serve the previous copy once before updating.</p>
            <h2>Cannot sign in</h2>
            <ul>
                <li>Enter a username, not an email (unless you are deliberately using the full address).</li>
                <li>Passwords are case-sensitive. Check the device keyboard did not capitalise anything.</li>
                <li>If you see an IP ban message, that network has been blocked; try another network or contact support.</li>
                <li>"Offline / No Database Connection" means Firebase could not load. Check the network and reload.</li>
            </ul>
            <h2>Pro features still locked</h2>
            <p>Wait a minute and refresh so the membership webhook can land. Confirm you are signed in as the paying account and that the ReKindle+ page shows an active expiry date. If it still fails, tap <b>Manage Subscription</b>, confirm the subscription is active in Stripe, then contact support.</p>
            <h2>Clock, weather or language is wrong</h2>
            <p>Set a manual location in Settings. The timezone prompt appears the first time an app needs local time; complete it and the page reloads. Signing in restores a saved timezone.</p>
            <h2>Games tab or a game is missing</h2>
            <p>Turn off <b>Disable Games</b> in Settings. In Edit mode, make sure the app is not hidden. Some games also live inside a folder - open the folder for single, local and live modes.</p>
            <h2>An app says it is unsupported</h2>
            <p>That app needs JavaScript features your browser lacks. The fix is newer firmware or a newer device; the Lite/Legacy builds trade features for compatibility. See <a href="#badges">Badges explained</a>.</p>
            <h2>Feeds, weather or stocks fail to load</h2>
            <p>These call external services. Rate limits, DNS hiccups and provider outages all look like an empty list. Wait a few minutes, use Refresh, and check another app that needs the network. Reddit and some RSS sources are especially prone to rate limiting.</p>
            <h2>Seeing a "La Liga" block page</h2>
            <p>Some Spanish internet providers block websites that share ReKindle's internet address, because of a court order involving La Liga. The notice page comes from your provider, not from ReKindle, so reloading, clearing site data or resetting the device will not help. It usually only lasts for a match window, and rekindle.ink works again afterwards.</p>
            <p>A phone often gets through while an e-reader does not, because the two devices connect in slightly different ways. A phone hotspot on its own does not change that.</p>
            <p>While the block lasts, use the alternate address <b>rekindle.pages.dev</b>. It is the same ReKindle, served from a different address, and it is not affected.</p>
            <div class="note"><b>About your data:</b> signed-in accounts see everything on the alternate address too. Guest data (stored in the browser with no account) is saved per site address, so it does not follow you there.</div>
            <h2>Storage full or data vanished</h2>
            <p>The Kindle cache can be wiped when the device runs low. Sign in before doing heavy work so it reaches Firestore. See <a href="#storage">Where your data lives</a>.</p>
            <h2>Nothing here helped</h2>
            <p>Email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with your username, device, app name and steps. Mention anything you already tried.</p>
        `
    },

    /* ------------------------------------------------------------------ */
    /* ESSENTIALS                                                          */
    /* ------------------------------------------------------------------ */

    {
        id: 'browser',
        cat: 'essentials',
        title: 'Browser',
        summary: 'A distraction-free reader for web pages and search results, with tabs and recent history.',
        tags: 'browser netlite web reader search url tabs history read article frogfind',
        appHref: 'browser',
        appName: 'Browser',
        related: ['reader', 'rssreader'],
        body: `
            <p>Browser is a reader-mode web browser. It fetches a page, strips menus and clutter, and shows the article as clean text with images. That keeps pages readable and fast on e-ink.</p>
            <h2>Using it</h2>
            <ol>
                <li>Type a web address or a search phrase in the top box.</li>
                <li>Press <b>Go</b> (or Enter). Addresses open directly; anything else runs a web search and shows a results list.</li>
                <li>Tap a result to read it. Links inside an article open in the same tab.</li>
                <li>Use <b>Back</b> and <b>Forward</b> to move through the history, <b>+</b> to open another tab, and <b>Home</b> to return to the start screen.</li>
                <li><b>Recent</b> keeps your last few pages; <b>Clear</b> removes them.</li>
            </ol>
            <h2>What it cannot do</h2>
            <ul>
                <li>JavaScript-heavy sites, logins and checkout flows usually fail. Use the device's normal browser for those.</li>
                <li>Some pages block reader extraction or require cookies, and will show an error.</li>
                <li>Paywalls and bot checks are not bypassed.</li>
            </ul>
            <h2>Tips</h2>
            <ul>
                <li>If an article extracts badly, try the site's "print" or "AMP" URL, or open the original in the system browser.</li>
                <li>Tabs share one history stack each, so you can keep a long read and a search open side by side.</li>
                <li>Images are removed from the reading flow when they have no useful source, which keeps e-ink refreshes down.</li>
                <li>The bookmark button saves the current page to <a href="#readlater">Read Later</a>.</li>
            </ul>
        `
    },
    {
        id: 'calendar',
        cat: 'essentials',
        title: 'Calendar',
        summary: 'Agenda, day and month views with local events or Google Calendar sync.',
        tags: 'calendar events agenda month google caldav ics schedule reminders appointments',
        appHref: 'calendar',
        appName: 'Calendar',
        related: ['tasks', 'contacts', 'home'],
        body: `
            <p>Calendar shows your schedule in agenda, day and month views. It works with local events or a Google Calendar account.</p>
            <h2>Adding an event</h2>
            <ol>
                <li>Tap <b>+ Add</b>.</li>
                <li>Enter a title, choose the date and time, and add an optional description.</li>
                <li>Save. Local events are stored on the device and, when signed in, in your account.</li>
            </ol>
            <p>Tap an event to edit or delete it. The <b>Today</b> button returns to the current date, and the arrow controls move between months or days.</p>
            <h2>Google Calendar</h2>
            <p>On first open, choose <b>Use Google</b> in the sync prompt, then tap <b>Log In</b> and sign in with Google. ReKindle requests calendar access so it can list your calendars and read/write events. You can choose which calendars are visible from the calendar picker. Google data is fetched directly from Google's API with a token stored on the device.</p>
            <h2>iCalendar (.ics) feeds</h2>
            <p>Settings accepts an iCalendar (<code>.ics</code>) subscription URL, for example a published Google Calendar or an ICS feed. Calendar fetches that feed through ReKindle's proxy and displays the events in read-only form. This is a one-way import, not two-way sync, and it is not a full CalDAV client. It replaces the local add button while active; remove the URL in Settings to go back to local events.</p>
            <div class="note"><b>Timezone:</b> events use the location and offset saved in Settings, because the Kindle system clock often ignores its own timezone setting. If an event appears an hour off, check Settings -> Location.</div>
        `
    },
    {
        id: 'contacts',
        cat: 'essentials',
        title: 'Contacts',
        summary: 'A local address book with optional read-only Google Contacts or CardDAV import.',
        tags: 'contacts address book google people carddav vcf phone email',
        appHref: 'contacts',
        appName: 'Contacts',
        related: ['calendar', 'mail'],
        body: `
            <p>Contacts keeps names, phone numbers, email addresses and notes. It works offline in local mode or imports an existing address book.</p>
            <h2>Local contacts</h2>
            <p>Tap <b>+ New</b>, fill in the fields you care about, and save. Local contacts can be edited and deleted. When signed in, they sync to your ReKindle account.</p>
            <h2>Google Contacts</h2>
            <p>Tap <b>Connect</b> and authorise Google. ReKindle requests read-only access to your contacts, then shows them in the list. Google contacts are an import view: they cannot be edited or deleted from ReKindle. This is intentional - it avoids accidental changes to your Google address book.</p>
            <h2>CardDAV / vCard</h2>
            <p>In Settings, save a CardDAV or <code>.vcf</code> URL. Contacts fetches the file through ReKindle's proxy and parses the vCard entries. Like Google Contacts, this is a read-only import. A malformed or unreachable URL shows a "CardDAV Error" status instead of a list.</p>
            <div class="note"><b>Privacy:</b> Google and CardDAV data is requested by your browser and is not stored on ReKindle servers. Local contacts are stored in your account when signed in.</div>
        `
    },
    {
        id: 'mail',
        cat: 'essentials',
        title: 'Mail',
        summary: 'A ReKindle+ IMAP/SMTP email client with folders, reading, archiving and composing.',
        tags: 'mail email imap smtp gmail outlook hotmail yahoo icloud inbox compose send archive spam trash app password oauth accounts multiple threads conversations pro',
        badges: ['REKINDLE+'],
        appHref: 'mail',
        appName: 'Mail',
        related: ['pro', 'contacts', 'account'],
        body: `
            <p>Mail is a full email client for ReKindle+. It connects directly to your mailbox over IMAP for reading and SMTP for sending, so your normal provider keeps working.</p>
            <h2>Connecting an account</h2>
            <ol>
                <li>Open Mail and choose your provider: Gmail, Outlook / Hotmail, Yahoo, iCloud or Custom (IMAP).</li>
                <li>For Gmail, Yahoo or iCloud, enter the email address and an <b>app password</b>, not your normal account password.</li>
                <li>For Custom, also enter the IMAP and SMTP hosts and ports.</li>
                <li>Tap Connect. If the connection works, credentials are encrypted and saved to your account (cached on this device).</li>
            </ol>
            <div class="note"><b>Gmail app passwords:</b> Google requires 2-Step Verification first, then an app password from myaccount.google.com/apppasswords. Normal passwords are rejected. Yahoo and iCloud users with 2FA need an app password too.</div>
            <div class="note"><b>Outlook / Hotmail:</b> Microsoft no longer accepts passwords or app passwords for Outlook.com, so Mail uses a Microsoft sign-in code instead. Choose <b>Outlook / Hotmail</b>, tap Connect, then on a phone or computer open the address Mail shows (usually <b>microsoft.com/devicelogin</b>) and type the code. Nothing secret is typed into the Kindle and no password is stored. Make sure IMAP is switched on in Outlook.com (Settings &rarr; Mail &rarr; Forwarding and IMAP &rarr; "Let devices and apps use IMAP"). Leave the Mail page open while it checks for approval. This works with personal Outlook.com and Hotmail accounts; work or school Microsoft 365 accounts are not supported yet.</div>
            <div class="note"><b>Several mailboxes at once:</b> tap <b>Settings</b> to see every account signed in on this device, switch between them, add another with <b>Add another account</b>, or <b>Rename</b> one so the list reads "Work" instead of an address. Use the <b>Accounts</b> button in the toolbar to jump between mailboxes, or choose <b>All inboxes</b> to see every Inbox merged into one list, with a small tag showing which account each message came from. You can add more than one Gmail, Yahoo or Outlook account; each keeps its own folders and signing out of one leaves the others alone. Accounts are remembered per ReKindle user, so they follow you to another device.</div>
            <h2>Reading and organising</h2>
            <ul>
                <li>Conversations are grouped by subject by default: replies to the same subject show as one row with a count, and tapping it expands the messages. Turn <b>Group conversations</b> off in Settings to list every message separately.</li>
                <li>Folders include Inbox, Sent, Drafts, Starred, All Mail/Archive, Spam, Trash and Important, plus any custom folders your provider exposes.</li>
                <li>Tap a message to read it. Links open in a new tab where possible; images and remote content may be limited for privacy.</li>
                <li>Use the toolbar to reply, forward, flag, mark read/unread, archive or move to trash. <b>Refresh</b> re-fetches the current folder.</li>
                <li><b>Compose</b> opens a blank message. Enter recipients, subject and body, then Send.</li>
            </ul>
            <h2>Limitations</h2>
            <ul>
                <li>Attachments are not supported in the current client; use your provider's own app for heavy attachments.</li>
                <li>Mail needs ReKindle+ and a working network. It will not work offline.</li>
                <li>Very large mailboxes load one folder at a time, which keeps e-ink rendering manageable.</li>
            </ul>
            <h2>Security</h2>
            <p>App passwords are encrypted on the device and an encrypted copy is saved to your ReKindle account (Pro-only <code>pro_data</code>) so each mailbox follows you to another device; ReKindle's authenticated mail relay uses it to reach your provider. Treat that as convenient sync, not a security boundary. Outlook accounts store no password at all: Microsoft issues a refresh token that stays on ReKindle's server and is never returned to the browser. Remove a mailbox with <b>Sign out</b> (Outlook) or <b>Remove</b> (password accounts) in Mail Settings.</p>
        `
    },
    {
        id: 'news',
        cat: 'essentials',
        title: 'News (The Daily Kindling)',
        summary: 'A daily digest of headlines by section, with a clean article reader.',
        tags: 'news daily kindling headlines world tech business science arts finance rss newspaper',
        appHref: 'newspaper',
        appName: 'News',
        related: ['rssreader', 'browser'],
        body: `
            <p>News aggregates current headlines into a newspaper-style front page. It is built for a quick scan: sections, headlines, a short summary and a readable article view.</p>
            <h2>Sections</h2>
            <p>Top Headlines, Tech, Business, Science, Arts and Finance. Each section pulls a live RSS feed and shows the newest items first. The date line reflects the saved timezone.</p>
            <h2>Reading an article</h2>
            <ol>
                <li>Tap a headline.</li>
                <li>The article opens in the built-in reader with A-/A+ text controls.</li>
                <li>Use <b>Open Externally</b> if the page extracts badly or needs JavaScript.</li>
                <li>Use the page arrows to page through a long article. Switch sections with the category buttons.</li>
            </ol>
            <h2>Good to know</h2>
            <ul>
                <li>Headlines come from public RSS feeds. If a publisher changes or blocks its feed, that section can appear empty until it is updated.</li>
                <li>News needs a network connection and re-fetches a section when you open it. Tapping through requires the article to load.</li>
                <li>This is a headline digest, not a full newspaper replica. Use <a href="#rssreader">RSS Reader</a> to follow your own sources.</li>
            </ul>
        `
    },
    {
        id: 'stocks',
        cat: 'essentials',
        title: 'Stocks',
        summary: 'A watchlist with price charts for shares and crypto, plus a guest-mode fallback.',
        tags: 'stocks shares crypto bitcoin finance watchlist portfolio charts yahoo',
        appHref: 'stocks',
        appName: 'Stocks',
        related: ['news', 'watchlist'],
        body: `
            <p>Stocks tracks a personal watchlist of tickers and shows a price chart over three ranges: 1 Day, 1 Week and 1 Month. It also recognises common cryptocurrency symbols.</p>
            <h2>Adding and removing</h2>
            <ol>
                <li>Tap <b>Add</b> and enter a ticker symbol (for example <code>AAPL</code>, <code>MSFT</code> or <code>BTC</code>).</li>
                <li>Tap the ticker to open its chart. Use the range buttons to change the period.</li>
                <li>Use <b>Remove</b> on a ticker to take it off the list.</li>
                <li>Refresh with the circular arrow. Data is not streamed - it updates when you refresh.</li>
            </ol>
            <h2>Accounts and storage</h2>
            <p>Signed-in users get their watchlist synced. Guest mode keeps it in local storage and shows a "Guest Mode" note. Quotes and charts come from Yahoo Finance through ReKindle's server-side price proxy, with a second server-side proxy as the fallback. Crypto uses the same route, with CoinCap as a fallback when Yahoo fails.</p>
            <div class="note"><b>Not financial advice:</b> Quotes can be delayed or temporarily unavailable, especially outside market hours. Do not rely on this app for trading decisions.</div>
            <p>If the list stays empty, the upstream provider is probably rate-limiting or unreachable. Wait a minute and refresh; a single failed ticker does not break the rest of the list.</p>
        `
    },
    {
        id: 'weather',
        cat: 'essentials',
        title: 'Weather',
        summary: 'Current conditions, a 24-hour strip and a five-day forecast for saved locations.',
        tags: 'weather forecast temperature rain wind humidity alerts locations open-meteo units',
        appHref: 'weather',
        appName: 'Weather',
        related: ['home', 'settings'],
        body: `
            <p>Weather shows current conditions, an hourly forecast for the next 24 hours and a five-day outlook. It uses Open-Meteo for forecast data and supports multiple saved locations.</p>
            <h2>Locations</h2>
            <ol>
                <li>Open the locations panel and tap <b>Add</b>.</li>
                <li>Search for a city, then choose the matching result.</li>
                <li>Use the left and right arrows to switch between saved locations.</li>
                <li>Remove a location from the same panel.</li>
            </ol>
            <p>If no location is set, Weather follows the manual location from Settings, or falls back to a default. Setting a location also fixes the dashboard weather widget.</p>
            <h2>Units and alerts</h2>
            <p>Temperature and wind units follow the Measurement Units setting (Auto, Metric or Imperial). For US coordinates, active weather alerts are fetched from the National Weather Service and shown as an alert banner.</p>
            <h2>Reading the display</h2>
            <ul>
                <li>The large number is the current temperature; the description is derived from the weather code.</li>
                <li>The hourly strip shows the next 24 hours with small condition icons.</li>
                <li>The five-day panel shows daily highs and lows.</li>
            </ul>
            <div class="note"><b>Location permission:</b> ReKindle normally uses the manual location rather than the browser's geolocation, because Kindle location services are unreliable. If the weather is for the wrong city, fix it in Settings.</div>
        `
    },
    {
        id: 'scores',
        cat: 'essentials',
        title: 'Scores',
        summary: 'Live and recent scores for major leagues, with Favourites for your teams in one feed.',
        tags: 'scores sports nfl nba mlb nhl nrl soccer epl mls ncaa espn favourites favorites',
        appHref: 'scores',
        appName: 'Scores',
        related: ['news', 'watchlist'],
        body: `
            <p>Scores shows scoreboards for major sports, with a <b>Favourites</b> tab that combines your teams into one list.</p>
            <h2>Leagues</h2>
            <p>NFL, NBA, MLB, NHL, NRL, English Premier League, MLS, NCAA Football and NCAA Basketball. Data comes from ESPN's public scoreboard API; NRL is handled by a dedicated ReKindle endpoint because ESPN's API does not expose it directly.</p>
            <h2>Following teams</h2>
            <ol>
                <li>Open a league to see its games.</li>
                <li>Tap the star next to a team to add it to <b>Favourites</b>.</li>
                <li>The Favourites tab then shows only those teams, across leagues, in one feed.</li>
                <li>Tap the star again to remove it.</li>
            </ol>
            <h2>Game states</h2>
            <p>Games show scheduled start times, live scores and progress, or final results. Times are shown as ESPN supplies them (usually US Eastern); ReKindle does not convert them to your timezone.</p>
            <div class="note"><b>Empty board?</b> Out of season, a league may have no games. If every league is empty, the upstream API is probably rate-limiting; wait and refresh. NRL parsing depends on ESPN's page structure and can lag after a site change.</div>
        `
    },

    /* ------------------------------------------------------------------ */
    /* READING & NEWS                                                      */
    /* ------------------------------------------------------------------ */

    {
        id: 'reader',
        cat: 'reading',
        title: 'Reader',
        summary: 'The main library: your own EPUBs, Project Gutenberg and Standard Ebooks in one place.',
        tags: 'reader library epub books gutenberg standard ebooks download read font position offline',
        appHref: 'reader',
        appName: 'Reader',
        related: ['epub', 'books', 'libby', 'comics'],
        body: `
            <p>Reader is the main reading app. It combines your own EPUB library with two public-domain catalogues in a single library overlay:</p>
            <ul>
                <li><b>My Books</b> - EPUBs you added or downloaded.</li>
                <li><b>Gutenberg</b> - search and download from Project Gutenberg's ~70,000 titles.</li>
                <li><b>Standard Ebooks</b> - new releases from standardebooks.org, cleaned and typeset.</li>
            </ul>
            <h2>Opening a book</h2>
            <ol>
                <li>Tap <b>Library</b> and choose a tab.</li>
                <li>For Gutenberg, search by title/author or tap a subject chip, then tap a result to read the plain text, or <b>Get</b> to download an EPUB into My Books.</li>
                <li>For Standard Ebooks, browse new releases and download one. It is cleaned and saved to your library.</li>
                <li>Tap a cover in My Books to open it in the EPUB reader.</li>
            </ol>
            <p>The Gutenberg tab also shows a <b>Continue reading</b> shelf for books you started and a <b>Popular Now</b> row of popular titles.</p>
            <h2>Reading controls</h2>
            <ul>
                <li>In the Gutenberg text view, <b>A- / A+</b> change the text size and <b>Contents</b> opens the chapter list. The EPUB reader itself has no font or contents control.</li>
                <li>The progress bar and percentage show how far you are. Position is saved automatically and restored next time.</li>
                <li>Gutenberg text is paginated by the visible screen: Prev/Next move exactly one page, never a smooth scroll.</li>
                <li><b>Delete</b> removes a book from your library (the catalogue copy is never affected).</li>
            </ul>
            <h2>Library and sync</h2>
            <p>My Books is stored in the browser's local database and synced to your account's Firestore library, including the reading position, so another device can continue where you stopped. Downloads and catalogue browsing need a network connection; once saved, a book can be opened offline.</p>
            <div class="note"><b>Standard Ebooks slow to load?</b> The feed is fetched through a dedicated relay because standardebooks.org blocks Cloudflare's network. The first load is slower; later loads use a cache.</div>
        `
    },
    {
        id: 'books',
        cat: 'reading',
        title: 'Books & reading log',
        summary: 'Track minutes read each day and keep a want-to-read list powered by Open Library.',
        tags: 'books reading log minutes want to read wishlist open library search isbn',
        appHref: 'books',
        appName: 'Books',
        related: ['reader', 'readlater', 'epub'],
        body: `
            <p>Books has two jobs: a daily reading log and a personal want-to-read list. It is not the book reader itself - use <a href="#reader">Reader</a> for that.</p>
            <h2>Reading log</h2>
            <ol>
                <li>Open the <b>Reading Log</b> tab.</li>
                <li>Tap a duration slot on a day, from 15 minutes to 2 hours. Tap the filled slot again to clear it.</li>
                <li>Each day shows its total, and the arrows move a week at a time.</li>
            </ol>
            <p>Signed-in users save minutes to Firestore; guest mode keeps them locally. Setting a day to zero removes that entry.</p>
            <h2>Want to read</h2>
            <ol>
                <li>Open <b>My Books</b> and search by title, author or subject.</li>
                <li>Results come from Open Library, including covers and publication details.</li>
                <li>Open a result to see its details, then tap <b>+ Want</b> to save it or <b>+ Log Read</b> to record that you read it. Saved books use a Want to Read / Read status control.</li>
                <li>Saved books have links to find them on Amazon or Goodreads.</li>
            </ol>
            <div class="note"><b>Login required for saved books:</b> the want-to-read list is account-based. Guest users can search, but the saved list prompts them to log in. The reading log still works locally in guest mode.</div>
            <p><b>Tip:</b> log minutes right after a session. The chart is most useful for spotting streaks and gaps, not for precise page counting.</p>
        `
    },
    {
        id: 'epub',
        cat: 'reading',
        title: 'ePub',
        summary: 'Add a DRM-free EPUB to your library from a direct download URL.',
        tags: 'epub add book url import library drm gutenberg download',
        appHref: 'epub',
        appName: 'ePub',
        related: ['reader', 'books'],
        body: `
            <p>ePub adds a book to your ReKindle library from a direct <code>.epub</code> download link. It is the manual import path; the Reader's Gutenberg and Standard Ebooks tabs are the automated ones.</p>
            <h2>Adding a book</h2>
            <ol>
                <li>Find a DRM-free EPUB on your computer or a public-domain site such as Project Gutenberg.</li>
                <li>Right-click the EPUB download link and copy the full URL. It should usually end in <code>.epub</code>.</li>
                <li>Open ePub, paste the URL, enter a title (author is optional), and tap <b>Add to Library</b>.</li>
                <li>When processing finishes, the book appears in <a href="#reader">Reader</a> -> My Books.</li>
            </ol>
            <h2>Why a direct URL?</h2>
            <p>The app downloads the file in the browser. A landing page or a link that requires a login cannot be used; you need the actual file address. Some sites hide it behind a download button, which is easiest to copy on a desktop browser.</p>
            <div class="note"><b>DRM:</b> Books with copy protection from Kindle, Kobo, Google Play or Audible will not open. ReKindle only handles unencrypted EPUBs. Only download material you have the right to use.</div>
            <p>If a download fails, check the link in a normal browser first. Very large books can take a while on a slow connection; keep the page open until the success dialog appears.</p>
        `
    },
    {
        id: 'libby',
        cat: 'reading',
        title: 'Libby',
        summary: 'An embedded window onto Libby, the public-library app, with an external fallback.',
        tags: 'libby library card overdrive borrow audiobook ebook public library external',
        badges: ['BETA'],
        appHref: 'libby',
        appName: 'Libby',
        related: ['reader', 'books'],
        body: `
            <p>Libby embeds <b>libbyapp.com</b> in ReKindle so you can borrow library books with your library card. ReKindle does not handle the lending itself - Libby and your library do.</p>
            <h2>Using it</h2>
            <ol>
                <li>Open Libby and wait for the embedded site to load.</li>
                <li>Sign in with your library card the first time.</li>
                <li>Borrow or place a hold as you would on the Libby website.</li>
                <li>If the frame is blank or refuses to load, tap <b>Open Ext</b> to open Libby in the device's normal browser.</li>
            </ol>
            <div class="note"><b>Why it may be blank:</b> Libby is designed for full browsers and can block embedding. ReKindle cannot control that. The Reload button retries the frame; Open Ext is the reliable fallback. Borrowed books are read in Libby, not in ReKindle's Reader.</div>
            <p>Libby needs a library card from a participating library. Availability, loan periods and holds are set by your library, not ReKindle.</p>
        `
    },
    {
        id: 'comics',
        cat: 'reading',
        title: 'Comics',
        summary: 'Read public-domain and openly licensed comics from the Internet Archive.',
        tags: 'comics comic reader internet archive public domain manga scanner library',
        appHref: 'comics',
        appName: 'Comics',
        related: ['reader', 'libby'],
        body: `
            <p>Comics is a page-by-page comic reader backed by the Internet Archive. It only lists items with an explicit public-domain or open licence, so the catalogue is legal to read and share.</p>
            <h2>Finding a comic</h2>
            <ol>
                <li>Open <b>Store</b> (the catalogue).</li>
                <li>Search, or browse Most Downloaded, Recently Added or Alphabetical.</li>
                <li>Tap <b>+ Add</b> on a card, then open it from the <b>Library</b> tab.</li>
            </ol>
            <h2>Reading</h2>
            <ul>
                <li>Use the page controls to move forward and back. Pages are loaded as images from the Archive.</li>
                <li>The reader shows the page count from the Archive's scan data.</li>
                <li>Some items are CBZ-only uploads with no scan data. Those cannot be paged in ReKindle; use the "Read on archive.org" fallback.</li>
            </ul>
            <div class="note"><b>Licensing:</b> the catalogue filters on a licence field on purpose. General comic collections contain unauthorised scans and are deliberately excluded. If a title is missing, it may simply not have an open licence.</div>
            <p>The library is stored locally with each item tagged as an Internet Archive source. Old entries from the retired MangaDex integration are dropped automatically.</p>
        `
    },
    {
        id: 'interactive',
        cat: 'reading',
        title: 'Interactive Reader',
        summary: 'Play parser-based interactive fiction from the Interactive Fiction Database.',
        tags: 'interactive fiction ifdb story choose your own adventure zork text adventure parser',
        appHref: 'interactive',
        appName: 'Interactive Reader',
        related: ['reader', 'books'],
        body: `
            <p>Interactive Reader plays classic text adventures and interactive fiction from the Interactive Fiction Database (IFDB). You type commands such as <code>look</code>, <code>take lamp</code> or <code>north</code>, and the story responds.</p>
            <h2>Library and store</h2>
            <p>The Library has two tabs: <b>My Library</b> for stories you saved or uploaded, and <b>Online Store</b> for browsing and searching IFDB. <b>Upload Story</b> accepts a Z-machine story file (<code>.z1</code>-<code>.z3</code>) and shares it with the community.</p>
            <h2>Starting a story</h2>
            <ol>
                <li>Search IFDB by title or author, or browse the recent and popular lists.</li>
                <li>Tap a story to view its details, rating and format.</li>
                <li>Tap Play. The story file is fetched and run in the page.</li>
                <li>Type commands in the input box and press Enter.</li>
            </ol>
            <h2>Library and history</h2>
            <p>Played stories appear in your recent history and library, with ratings pulled from IFDB. You can save a story for later and return to it. Progress is kept per story where the format supports it.</p>
            <div class="note"><b>Parser games need exact words:</b> try <code>look</code>, <code>inventory</code>, <code>open door</code>, <code>north</code>, <code>help</code>. If a command is not understood, the game usually suggests a synonym.</div>
            <p>Most IFDB titles are free to play. Story files are fetched through ReKindle's story service; a missing file or an unsupported format shows an error with a link to the IFDB entry.</p>
        `
    },
    {
        id: 'rssreader',
        cat: 'reading',
        title: 'RSS Reader',
        summary: 'Follow feeds in a clean reader, with preset sources and unread tracking.',
        tags: 'rss feeds news reader unread sources presets free limit pro category',
        appHref: 'rssreader',
        appName: 'RSS Reader',
        related: ['news', 'readlater', 'browser'],
        body: `
            <p>RSS Reader follows any site that publishes an RSS or Atom feed and shows the articles in a readable list.</p>
            <h2>Preset sources</h2>
            <p>The app ships with presets including BBC, NPR, Reuters, AP News, The Guardian, NY Times, Al Jazeera, ABC AU, Hacker News, The Verge, Ars Technica, Nature and XKCD. Tap one to subscribe instantly.</p>
            <h2>Adding your own feed</h2>
            <ol>
                <li>Tap <b>+ Add New Source</b>.</li>
                <li>Paste the feed URL and give it a name.</li>
                <li>Choose a category if you want to group feeds (a Pro feature).</li>
                <li>Save.</li>
            </ol>
            <div class="note"><b>Free limit:</b> free accounts can keep two feeds. Adding a third asks you to choose which two to keep. ReKindle+ removes the limit.</div>
            <h2>Reading</h2>
            <ul>
                <li>Two tabs: <b>Headlines</b> and <b>Sources</b>. On Headlines, the <b>All</b> and <b>Unread</b> filters narrow the list.</li>
                <li>Tap an article to open the built-in reader. Use A-/A+ to change text size.</li>
                <li><b>Mark Unread</b> puts an article back; <b>Mark All Read</b> clears the visible list.</li>
                <li><b>Open Ext</b> opens the original page in the system browser.</li>
                <li>The page arrows page through a long article; <b>Load More</b> fetches older items.</li>
            </ul>
            <p>Feeds are fetched through a conversion service and cached. A source that has not updated recently shows nothing new; that is normal. Broken feeds can be removed with <b>Unsubscribe</b>.</p>
        `
    },
    {
        id: 'readlater',
        cat: 'reading',
        title: 'Read Later',
        summary: 'Save links for later and open them in Browser\'s reader view when you have time.',
        tags: 'read later bookmarks links save queue pocket url',
        appHref: 'readlater',
        appName: 'Read Later',
        related: ['rssreader', 'readwise', 'browser'],
        body: `
            <p>Read Later is a simple queue of links. Paste a URL, and it stays in your list until you remove it.</p>
            <h2>Saving a link</h2>
            <ol>
                <li>Paste the full address into the box at the bottom.</li>
                <li>Tap <b>Add</b>. ReKindle fetches the page title and stores the item.</li>
                <li>Tap an item to open it in Browser's reader view, or use its controls to remove it.</li>
            </ol>
            <p><b>Refresh</b> re-syncs the list from your account. Signed-in users get the queue on every device; guest mode keeps it locally.</p>
            <h2>Good to know</h2>
            <ul>
                <li>This app saves links, not full offline copies. If the page disappears or needs a login, the link stops working.</li>
                <li>For articles you want to read and highlight with a service, see <a href="#readwise">Readwise</a>.</li>
                <li>For feeds you check regularly, use <a href="#rssreader">RSS Reader</a> instead.</li>
            </ul>
        `
    },
    {
        id: 'readwise',
        cat: 'reading',
        title: 'Readwise',
        summary: 'Connect a Readwise account to read saved articles, highlights and the daily review.',
        tags: 'readwise reader highlights daily review api token archive feed',
        badges: ['BETA'],
        appHref: 'readwise',
        appName: 'Readwise',
        related: ['readlater', 'rssreader'],
        body: `
            <p>Readwise pulls your Readwise Reader library and highlights into ReKindle. It is a companion to a paid Readwise account, not a replacement for it.</p>
            <h2>Connecting</h2>
            <ol>
                <li>Get an API token from <b>readwise.io/access_token</b>.</li>
                <li>Open Readwise and tap <b>Connect Account</b>.</li>
                <li>Paste the token and save. The token is stored locally on the device.</li>
            </ol>
            <h2>Views</h2>
            <ul>
                <li><b>Reader</b> - your Reader inbox, with filters for New, Later, Archive and Feed.</li>
                <li><b>Highlights</b> - highlights grouped by book or article.</li>
                <li><b>Daily Review</b> - the spaced-repetition review of saved highlights.</li>
            </ul>
            <p>Tap an article to open it in the built-in reader. Highlight text in Readwise itself; ReKindle is primarily a reading view. To replace the token, open Connect Account and save a new one.</p>
            <div class="note"><b>Beta:</b> Readwise is labelled BETA on the home screen. The integration uses Readwise's API, so features and response formats may change without notice.</div>
        `
    },
    {
        id: 'bible',
        cat: 'reading',
        title: 'Scriptures',
        summary: 'Read the Bible, Quran, Dhammapada and Tao Te Ching with adjustable text.',
        tags: 'bible quran dhammapada tao te ching scriptures religion reading translation font',
        appHref: 'bible',
        appName: 'Scriptures',
        related: ['reader', 'books'],
        body: `
            <p>Scriptures is a reading app for four texts: the Bible, the Quran, the Dhammapada and the Tao Te Ching. Each has its own structure and navigation.</p>
            <h2>Reading</h2>
            <ol>
                <li>Choose a text from the first dropdown in the toolbar.</li>
                <li>Use the chapter or section controls to navigate.</li>
                <li>Use Prev/Next for sequential reading.</li>
                <li>Open the settings gear to change translation (where available) and font size (Small, Medium, Large, X-Large).</li>
            </ol>
            <p>The reader loads one chapter at a time so e-ink refreshes stay manageable. Text size and the selected translation are remembered.</p>
            <div class="note"><b>Translations:</b> the Bible offers multiple translations; the other texts have their own available editions. If a translation fails to load, switch to another and back. The Bible and Quran are fetched from a remote text service and need a connection; the Dhammapada and Tao Te Ching are bundled and work offline.</div>
            <p>For long reading sessions, increase the text size and use the anti-ghosting display mode in Settings.</p>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([

    /* ------------------------------------------------------------------ */
    /* PRODUCTIVITY                                                        */
    /* ------------------------------------------------------------------ */

    {
        id: 'tasks',
        cat: 'productivity',
        title: 'Tasks',
        summary: 'A simple task list that syncs with Google Tasks or stays local.',
        tags: 'tasks todo google tasks checklist sync due complete refresh',
        appHref: 'tasks',
        appName: 'Tasks',
        related: ['quicktodo', 'notes', 'calendar'],
        body: `
            <p>Tasks is a checklist. Add items, tick them off, and choose whether the list should sync with Google Tasks or stay on the device.</p>
            <h2>Getting started</h2>
            <ol>
                <li>Open Tasks. If this is the first run, choose <b>Use Google</b> or <b>Use Local</b>.</li>
                <li>Type a task and add it. Tap the checkbox to complete it.</li>
                <li>Use <b>Refresh</b> to pull the latest list from Google or your account.</li>
            </ol>
            <h2>Google Tasks sync</h2>
            <p>Choosing Google opens an OAuth consent screen. ReKindle requests access to your Google Tasks, then reads and writes the list directly. Each Google list appears as a column and shows up to 100 open tasks. The token is kept on the device. If the connection expires, tap <b>Log In</b> again.</p>
            <h2>Local mode</h2>
            <p>Local tasks are stored on the device and, when signed in, in your ReKindle account. They do not appear in Google Tasks. Switch modes under Settings -> Integrations -> Google Tasks; ReKindle does not automatically merge the two lists, so copy anything important before switching.</p>
            <div class="note"><b>Completed tasks:</b> ticking a task removes it from the active list. In Google mode, Google's own task history keeps the record. In local mode, completion is the deletion.</div>
        `
    },
    {
        id: 'quicktodo',
        cat: 'productivity',
        title: 'Quick ToDo',
        summary: 'Write tasks by hand and let handwriting recognition turn them into digital todos.',
        tags: 'quick todo handwriting ocr scribble stylus google tasks handwriting recognition speed pro',
        badges: ['REKINDLE+'],
        appHref: 'quicktodo',
        appName: 'Quick ToDo',
        related: ['tasks', 'notes', 'airtype'],
        body: `
            <p>Quick ToDo is made for a stylus or a finger. You write on blank lines, and ReKindle recognises the handwriting and turns it into a digital task list.</p>
            <h2>How to use it</h2>
            <ol>
                <li><b>Write a new task</b> on any empty line.</li>
                <li><b>Complete a task</b> by drawing a horizontal strike-through across the text.</li>
                <li>Changes save and sync automatically; there is no Sync button. Google Tasks is polled about once a minute.</li>
                <li>Use the speed selector - Fast, Normal, Slow - to set how long the app waits after you stop writing before it converts. Turn on <b>Manual</b> to convert only when you tap the tick button.</li>
            </ol>
            <h2>Account choice</h2>
            <p>Quick ToDo writes to the same task list as <a href="#tasks">Tasks</a>: Google Tasks, or the local list stored on the device and in your ReKindle account. The chooser appears on first run; change it later under Settings -> Integrations -> Google Tasks. Switching does not merge the two lists.</p>
            <div class="note"><b>ReKindle+ required:</b> handwriting recognition runs on ReKindle's OCR service, so Quick ToDo is a Pro app. The recognition is best with clear, separated letters; cursive works but is less reliable.</div>
            <p><b>Tips:</b> write one task per line, keep the page reasonably still, and strike through firmly from left to right. If a line is misread, erase it and write again rather than editing letter by letter.</p>
        `
    },
    {
        id: 'notes',
        cat: 'productivity',
        title: 'Notes',
        summary: 'A clean note editor with bold, italic and underline, sorting and cloud sync.',
        tags: 'notes note taking editor bold italic underline sort cloud local write',
        appHref: 'notes',
        appName: 'Notes',
        related: ['quicktodo', 'docs', 'journal', 'teleprompter'],
        body: `
            <p>Notes is a distraction-free editor for short and medium pieces of writing: meeting notes, lists, drafts and ideas.</p>
            <h2>Writing</h2>
            <ol>
                <li>Tap <b>+ New</b>, give the note a title and start typing.</li>
                <li>Use <b>B</b>, <b>I</b> and <b>U</b> for bold, italic and underline.</li>
                <li>Notes save automatically. The back arrow returns to the list.</li>
            </ol>
            <h2>Finding and organising</h2>
            <p>Sort by Newest, Oldest, Title A-Z or Title Z-A. Notes sync to your account when signed in; guest notes stay in local storage. Delete uses a confirmation dialog. <b>Export All</b> downloads every note as a text file, and each note has its own download control.</p>
            <div class="note"><b>Notes feed the Teleprompter:</b> any note can be shown line by line in the <a href="#teleprompter">Teleprompter</a> app. Keep one note per speech or script for the cleanest result.</div>
            <p>For long documents with headings, tables, DOCX import/export and print-style formatting, use <a href="#docs">Docs</a> instead.</p>
        `
    },
    {
        id: 'docs',
        cat: 'productivity',
        title: 'Docs',
        summary: 'A ReKindle+ document editor that opens and saves Word files through Files.',
        tags: 'docs documents editor word docx import export files pro ckeditor',
        badges: ['REKINDLE+'],
        appHref: 'docs',
        appName: 'Docs',
        related: ['files', 'notes'],
        body: `
            <p>Docs is a rich-text document editor for ReKindle+. It can create a document from scratch, open a <code>.docx</code> from your Files storage, and save the result back as a Word file.</p>
            <h2>Creating and editing</h2>
            <ol>
                <li>Tap <b>Create New Document</b>, or <b>Open from Files</b> to pick an uploaded Word file.</li>
                <li>The toolbar covers headings, bold, italic, underline, strikethrough, bulleted and numbered lists, indent/outdent, block quotes, tables, undo and redo.</li>
                <li>Tap <b>Save</b>. Choose a filename; the document is written to your Files storage as a DOCX.</li>
                <li>If you are not signed in, Save downloads a DOCX copy instead of storing it.</li>
            </ol>
            <h2>Import and export</h2>
            <p>Word import converts the document to editable HTML with Mammoth, preserving headings, lists, tables and basic formatting. Complex layouts, text boxes and tracked changes may not survive. Export rebuilds a clean DOCX from the editor content, so what you see in the editor is what the file contains.</p>
            <div class="note"><b>Storage:</b> Docs depends on <a href="#files">Files</a>, which has a shared 100 MB quota. A very large document may fail to save when the quota is full. Delete old files or export them first.</div>
            <p>Docs needs ReKindle+ and a network connection. For quick notes, <a href="#notes">Notes</a> is lighter and works offline.</p>
        `
    },
    {
        id: 'files',
        cat: 'productivity',
        title: 'Files',
        summary: 'ReKindle+ cloud storage for documents, images, PDFs and ebooks, shared with Docs and Photo Frame.',
        tags: 'files storage upload image pdf ebook docx word cloud 100mb pro download delete docs',
        badges: ['REKINDLE+'],
        appHref: 'files',
        appName: 'Files',
        related: ['docs', 'storage'],
        body: `
            <p>Files stores documents, images, PDFs and ebooks in your ReKindle account. Word documents can be opened in the <a href="#docs">Docs</a> editor; images and PDFs get an inline preview.</p>
            <h2>Uploading</h2>
            <ol>
                <li>Tap <b>Upload</b> and choose one or more files.</li>
                <li>Wait for the upload to finish. The files appear in the grid or list.</li>
                <li>Tap a Word document to open it in <a href="#docs">Docs</a>. When Docs asks you to open a file, its picker uses this same list.</li>
            </ol>
            <p>Uploading from a PC is often easier because e-reader file pickers can be awkward; sign in to the same account on the computer and upload there.</p>
            <h2>Limits</h2>
            <ul>
                <li>Images, PDFs, text, EPUB, ZIP and Word documents are accepted. Legacy <code>.doc</code> files must be saved as <code>.docx</code> before Docs can open them.</li>
                <li>The shared quota is <b>100 MB per account</b>, and Docs saves and Mindmap exports count against it. The page shows how much is used; a save fails when the quota is full.</li>
                <li>Deleting a file is permanent. Download anything you want to keep first.</li>
            </ul>
            <h2>Viewing and deleting</h2>
            <p>Switch between grid and list views with the toolbar. Tap a file to preview or open it; use the preview's <b>Download</b> button to save a copy. Delete asks for confirmation.</p>
            <div class="note"><b>Privacy:</b> files are stored in Firebase Storage under your user ID. They are not public. See the <a href="privacy.html">Privacy Policy</a>.</div>
        `
    },
    {
        id: 'journal',
        cat: 'productivity',
        title: 'Journal',
        summary: 'Daily mood and reflection entries with a calendar, trends and statistics.',
        tags: 'journal diary mood feelings causes stats calendar reflection mental health',
        appHref: 'journal',
        appName: 'Journal',
        related: ['notes', 'streak', 'food'],
        body: `
            <p>Journal is a private daily diary focused on mood. Each entry records how you felt, what you felt and what contributed to it, plus free text.</p>
            <h2>Writing an entry</h2>
            <ol>
                <li>Pick a date from the calendar or use today.</li>
                <li>Choose a mood from Awful, Bad, Neutral, Good or Great.</li>
                <li>Select any feelings and causes that apply (for example stressed, tired, work, family).</li>
                <li>Write the entry; it saves automatically as you type.</li>
            </ol>
            <h2>Calendar and stats</h2>
            <ul>
                <li><b>Calendar</b> shows a marker on days with entries. Tap a day to read or edit it.</li>
                <li><b>Stats</b> shows a recent trend, mood distribution, top feelings and top causes.</li>
                <li>The calendar scrolls back through earlier months automatically; there are no month arrows. Future dates cannot be opened.</li>
            </ul>
            <p>Entries sync to your account when signed in; guest entries stay local. Delete removes the entry for that date after a confirmation.</p>
            <div class="note"><b>Private by default:</b> Journal is personal data, not social content. It is stored under your user ID and is not posted anywhere. See <a href="privacy.html">Privacy</a>.</div>
        `
    },
    {
        id: 'flashcards',
        cat: 'productivity',
        title: 'Flashcards',
        summary: 'Create decks, import cards from CSV, and review with spaced repetition.',
        tags: 'flashcards study revision spaced repetition srs decks cards csv import',
        appHref: 'flashcards',
        appName: 'Flashcards',
        related: ['notes', 'language'],
        body: `
            <p>Flashcards is a study tool. Cards have a front and a back, and the app schedules reviews using spaced repetition.</p>
            <h2>Creating a deck</h2>
            <ol>
                <li>Tap <b>+ Deck</b>, name it, and save.</li>
                <li>Open the deck and tap <b>+ Card</b> to add a front and back.</li>
                <li>Repeat for each card. Cards can be edited or deleted later.</li>
            </ol>
            <h2>Importing</h2>
            <p>Use <b>Import CSV</b> with two columns: <code>Front,Back</code>. If a field contains a comma, wrap it in double quotes: <code>"Front, with comma",Back</code>. One row becomes one card.</p>
            <h2>Reviewing</h2>
            <p>When you reveal a card, rate how well you knew it:</p>
            <table>
                <tr><th>Rating</th><th>Effect</th></tr>
                <tr><td>Again</td><td>Repeats the card in about a minute and resets its interval.</td></tr>
                <tr><td>Hard</td><td>Pass. First repeat after 1 day, then 6 days, with slower growth afterwards.</td></tr>
                <tr><td>Good</td><td>Pass. Same first intervals, with steadier growth afterwards.</td></tr>
                <tr><td>Easy</td><td>Pass. Same first intervals, with the fastest growth afterwards.</td></tr>
            </table>
            <p>Decks and review state sync to your account when signed in, so a review session can continue on another device.</p>
            <div class="note"><b>Study tip:</b> keep cards small - one fact per card. If a card keeps getting "Again", split it into two simpler cards.</div>
        `
    },
    {
        id: 'timer',
        cat: 'productivity',
        title: 'Timers',
        summary: 'Focus timer, Pomodoro sessions, stopwatch and custom countdowns.',
        tags: 'timer focus pomodoro stopwatch countdown work break session productivity',
        appHref: 'timer',
        appName: 'Timers',
        related: ['countdown', 'breathing'],
        body: `
            <p>Timers combines four tools in one window: a focus timer, a Pomodoro cycle, multiple independent timers and a stopwatch.</p>
            <h2>Focus</h2>
            <p>Type what you are focusing on, choose a duration (25, 15 or 5 minutes, or a custom value), and tap Start. The ring empties as time passes. Reset clears the session.</p>
            <h2>Pomodoro</h2>
            <p>The Pomodoro tab runs a work/short-break/long-break cycle. The default is 25 minutes of work, 5-minute short breaks, a longer break after four sessions. Open the settings to change the work, short-break and long-break lengths and the number of sessions. <b>Skip</b> moves to the next phase.</p>
            <h2>Timers</h2>
            <p>The Timers tab runs several independent countdowns at once. Tap <b>+</b> in the title bar to add one, give it a name and duration, and start it. The set-ups are saved on the device and come back after a reload.</p>
            <h2>Stopwatch</h2>
            <p>Start, stop and reset, with a lap button to record split times. The display shows hundredths of a second; on e-ink the refresh rate limits how useful the smallest digits are.</p>
            <div class="note"><b>Screen behaviour:</b> timers keep running while the page is open. If the device sleeps or you navigate away, the browser may pause JavaScript and a running timer is not restored; the saved Timers set-up is. Use the countdown app for date-based events that must survive a reload.</div>
        `
    },
    {
        id: 'countdown',
        cat: 'productivity',
        title: 'Countdown',
        summary: 'Count down to dates and recurring events, from a launch to a weekly reset.',
        tags: 'countdown timer event date recurring yearly monthly weekly daily deadline',
        appHref: 'countdown',
        appName: 'Countdown',
        related: ['timer', 'calendar'],
        body: `
            <p>Countdown tracks how long remains until an event. It is for dates, not for cooking - use <a href="#timer">Timers</a> for short durations.</p>
            <h2>Adding a countdown</h2>
            <ol>
                <li>Tap <b>+ Add</b>.</li>
                <li>Give it a name and pick the start date and time.</li>
                <li>Optionally turn on <b>Recurring</b> and choose Every Year, Every Month, Every Week or Every Day.</li>
                <li>Save. The list shows the largest remaining unit plus the next one, for example "3 Days 4h" or "2 Hours 15m".</li>
            </ol>
            <h2>Recurring events</h2>
            <p>A recurring countdown rolls forward automatically after it passes, so a birthday or weekly reset stays useful. Deleting it removes the schedule; the confirmation cannot be undone.</p>
            <div class="note"><b>Timezones:</b> countdowns use the location saved in Settings. If a deadline looks an hour off, check Settings -> Location. The list refreshes once a minute while open.</div>
        `
    },
    {
        id: 'teleprompter',
        cat: 'productivity',
        title: 'Teleprompter',
        summary: 'Show a note line by line in huge text for speeches, scripts and practice.',
        tags: 'teleprompter speech script notes lines presentation practice invert font',
        appHref: 'teleprompter',
        appName: 'Teleprompter',
        related: ['notes', 'timer'],
        body: `
            <p>Teleprompter takes a note and shows it one line at a time in the largest text that fits the screen. It is designed for reading aloud on an e-ink device.</p>
            <h2>Using it</h2>
            <ol>
                <li>Write or paste your script in <a href="#notes">Notes</a>, with one sentence or phrase per line.</li>
                <li>Open Teleprompter and choose that note.</li>
                <li>Tap the right side of the screen to advance; tap the left side to go back a line. Use <b>Back</b> to return to the note picker.</li>
                <li>Use <b>Invert</b> if you need white text on a dark background (useful in low light, though e-ink contrast varies).</li>
            </ol>
            <p>The font size is calculated automatically so each line fits without scrolling. Lines are trimmed and blank lines are skipped, which keeps the pacing clean.</p>
            <div class="note"><b>Script tip:</b> keep lines short. A line that wraps will shrink the whole display, making everything harder to read from a distance.</div>
        `
    },
    {
        id: 'airtype',
        cat: 'productivity',
        title: 'AirType',
        summary: 'Use your phone as a keyboard for the e-reader, with a live note panel.',
        tags: 'airtype typewriter phone keyboard pair qr code notes typing pro',
        badges: ['REKINDLE+'],
        appHref: 'airtype',
        appName: 'AirType',
        related: ['notes', 'quicktodo'],
        body: `
            <p>AirType solves the worst part of an e-reader: typing. It pairs your phone to ReKindle so you can type on a real touch keyboard while the text appears on the e-ink screen.</p>
            <h2>Pairing</h2>
            <ol>
                <li>Sign in to ReKindle. AirType requires an account.</li>
                <li>Open AirType on the e-reader and tap <b>Connect</b>.</li>
                <li>Scan the QR code with your phone, or open the shown link and enter the session code.</li>
                <li>Start typing on the phone. The note updates on the e-reader.</li>
            </ol>
            <h2>Writing controls</h2>
            <ul>
                <li><b>A- / A+</b> change the display size on the e-reader.</li>
                <li><b>+ New Note</b> starts a fresh note; existing notes are listed in the sidebar.</li>
                <li><b>Reset</b> forgets whether this device is the display or the keyboard and reopens Device Setup.</li>
                <li>Notes are saved with your account, like the Notes app.</li>
            </ul>
            <div class="note"><b>ReKindle+ required:</b> the pairing relay and session handling are part of the Pro service. Both devices need internet access; they do not need to be on the same Wi-Fi.</div>
        `
    },
    {
        id: 'mindmap',
        cat: 'productivity',
        title: 'Mindmap',
        summary: 'Arrange ideas as connected nodes and export the result as PNG or SVG.',
        tags: 'mindmap ideas nodes diagram brainstorm export png svg library',
        appHref: 'mindmap',
        appName: 'Mindmap',
        related: ['notes', 'docs'],
        body: `
            <p>Mindmap is a visual thinking tool. Each idea is a node, and nodes connect to show relationships.</p>
            <h2>Building a map</h2>
            <ol>
                <li>Tap <b>Library</b> to see saved maps, or create a new one.</li>
                <li>Double-tap empty space to add a node; the <b>+</b> and <b>-</b> controls are zoom.</li>
                <li>Type the node text and confirm. Drag nodes to arrange them.</li>
                <li>Use the zoom controls to fit more of the map on screen.</li>
                <li><b>Center</b> re-centres the view. <b>Edit</b> shows the delete and connect controls; double-tap a node to rename it.</li>
            </ol>
            <h2>Saving and exporting</h2>
            <p>Maps save automatically to your account. <b>Export</b> offers PNG (image) and SVG (vector). Export is a ReKindle+ feature. Choose a filename and format; the export is saved into <a href="#files">Files</a>, where it counts against the shared 100 MB quota.</p>
            <div class="note"><b>Performance:</b> very large maps get slow on e-ink. Break a huge brainstorm into several smaller maps rather than one enormous canvas.</div>
        `
    },
    {
        id: 'streak',
        cat: 'productivity',
        title: 'Habit Tracker',
        summary: 'Build weekly habits and keep a visual streak history.',
        tags: 'habit tracker streak weekly grid routine goals sync',
        appHref: 'streak',
        appName: 'Habit Tracker',
        related: ['journal', 'tasks', 'life'],
        body: `
            <p>Habit Tracker is a weekly checklist for routines. Each habit gets a row of days; tap a day to mark it done.</p>
            <h2>Adding a habit</h2>
            <ol>
                <li>Type the habit name at the bottom (for example "Read" or "Stretch").</li>
                <li>Tap <b>Add</b>. The habit appears as a new row.</li>
                <li>Tap the square for each day you complete it.</li>
                <li>Use the arrows to move between weeks.</li>
            </ol>
            <p>Trends are visual: filled squares in a row show a streak. Completed history syncs to your account when signed in; guest history stays on the device.</p>
            <h2>Deleting</h2>
            <p>Deleting a habit removes its whole history, so the confirmation is intentionally blunt. If you only want to stop tracking for a while, leave the habit and skip days instead.</p>
            <div class="note"><b>Keep it small:</b> two or three habits are easier to maintain than ten. The visual grid rewards consistency, not volume.</div>
        `
    },
    {
        id: 'life',
        cat: 'productivity',
        title: 'Life Calendar',
        summary: 'Visualise your life in weeks with a memento mori grid.',
        tags: 'life calendar weeks birthday memento mori mortality age grid',
        appHref: 'life',
        appName: 'Life Calendar',
        related: ['streak', 'journal'],
        body: `
            <p>Life Calendar turns a lifespan into a grid of weeks. It is a memento mori: a reminder to notice how much time has passed and how much may remain.</p>
            <h2>Setting it up</h2>
            <ol>
                <li>Enter your birthday in DD/MM/YYYY format.</li>
                <li>Tap Start. The grid fills weeks you have lived and leaves the rest open.</li>
                <li>The header shows weeks lived and an estimate of weeks remaining, based on 90 years.</li>
            </ol>
            <p>The estimate is a statistical baseline, not a prediction. Use it as perspective, not a countdown.</p>
            <div class="note"><b>Privacy:</b> your birthday is saved to your ReKindle social profile and shown publicly as your age, because Life Calendar and Neighbourhood share the same birthday field. Enter only what you are comfortable sharing; you can change or clear it from your Neighbourhood profile.</div>
        `
    },
    {
        id: 'food',
        cat: 'productivity',
        title: 'Food Log',
        summary: 'A simple daily food diary for breakfast, lunch, dinner and snacks.',
        tags: 'food log diet meals breakfast lunch dinner snacks notes diary',
        appHref: 'food',
        appName: 'Food Log',
        related: ['journal', 'cookbook'],
        body: `
            <p>Food Log is a lightweight food diary. It is not a calorie counter - there is no nutrition database - it is a place to record what you ate and how it made you feel.</p>
            <h2>Logging a day</h2>
            <ol>
                <li>Open Food Log; today's date is selected.</li>
                <li>Add an item under Breakfast, Lunch, Dinner or Snacks.</li>
                <li>Add a short note if useful (portion, how you felt, cravings).</li>
                <li>Use the day arrows to review or edit previous days.</li>
            </ol>
            <p>Entries are saved per day. When signed in they sync to your account; guest logs stay on the device.</p>
            <div class="note"><b>Not medical advice:</b> this is a personal record, not a diagnostic tool. For dietary or health decisions, talk to a qualified professional.</div>
        `
    },
    {
        id: 'napkin',
        cat: 'productivity',
        title: 'Sketchpad',
        summary: 'A quick blank canvas for drawing with a pen or finger.',
        tags: 'sketchpad napkin draw pen bold clear scratchpad canvas',
        appHref: 'napkin',
        appName: 'Sketchpad',
        related: ['pixel', 'flipbook', 'mindmap'],
        body: `
            <p>Sketchpad is exactly what it sounds like: a blank page you can draw on with a finger or stylus. It is for quick diagrams, doodles and "let me show you" moments.</p>
            <h2>Controls</h2>
            <ul>
                <li><b>Pen</b> draws a normal line.</li>
                <li><b>Bold</b> switches to a thicker stroke.</li>
                <li><b>Clear</b> wipes the canvas.</li>
            </ul>
            <p>Draw directly on the canvas. There is no save, undo or export - it is a scratchpad. Take a screenshot if you need to keep something.</p>
            <div class="note"><b>Want a permanent drawing?</b> Use <a href="#pixel">Pixel</a> for 1-bit art with a gallery, or <a href="#flipbook">Flipbook</a> for animation. Both save and can post to KindleChat.</div>
        `
    },
    {
        id: 'dropbox',
        cat: 'productivity',
        title: 'Dropbox',
        summary: 'Browse a Dropbox account and preview or download files on the e-reader.',
        tags: 'dropbox files cloud storage connect oauth favorites preview download pro beta',
        badges: ['REKINDLE+', 'BETA'],
        appHref: 'dropbox',
        appName: 'Dropbox',
        related: ['files', 'docs'],
        body: `
            <p>Dropbox connects a Dropbox account to ReKindle so you can reach files without a computer. It is a browser for your Dropbox, not a full sync client.</p>
            <h2>Connecting</h2>
            <ol>
                <li>Open Dropbox and tap <b>Connect to Dropbox</b>.</li>
                <li>Sign in and authorise ReKindle. The connection is saved to your ReKindle account (in the Pro-only <code>pro_data</code> record), so it follows you to another device.</li>
                <li>Browse folders, open <b>Favorites</b>, or use the breadcrumb to go back.</li>
            </ol>
            <h2>Working with files</h2>
            <ul>
                <li>Tap a file to preview it where the format is supported.</li>
                <li>Use <b>Download</b> to save a copy to the device.</li>
                <li>Tap the star on a folder to add or remove it from <b>Favorites</b>; favorites sync with your account.</li>
                <li><b>Logout</b> removes the connection.</li>
            </ul>
            <div class="note"><b>Limits:</b> Dropbox needs ReKindle+ and a network connection. Very large files and unsupported preview formats should be opened in the Dropbox app or on a computer. Tokens are stored in your ReKindle account, not on the device; <b>Logout</b> deletes them.</div>
        `
    },

    /* ------------------------------------------------------------------ */
    /* TOOLS & REFERENCE                                                   */
    /* ------------------------------------------------------------------ */

    {
        id: 'calculator',
        cat: 'tools',
        title: 'Calculator',
        summary: 'A standard calculator with a scientific mode for trigonometry, logs and powers.',
        tags: 'calculator math scientific trig sin cos log square root factorial pi percent',
        appHref: 'calculator',
        appName: 'Calculator',
        related: ['converter'],
        body: `
            <p>Calculator starts in basic mode: digits, arithmetic, percent, sign and backspace. Tap <b>SCI</b> to reveal the scientific functions.</p>
            <h2>Scientific functions</h2>
            <p>sin, cos, tan and their inverses; ln and log; powers of ten and e; square, cube, square root, reciprocal and factorial; pi and e constants; and a power key. Trigonometry works in <b>degrees</b>; there is no radian mode.</p>
            <h2>Using it</h2>
            <ul>
                <li><b>C</b> clears the current calculation.</li>
                <li><b>Backspace</b> removes the last digit.</li>
                <li><b>+/-</b> flips the sign.</li>
                <li><b>%</b> applies a percentage.</li>
            </ul>
            <div class="note"><b>Precision:</b> results use normal JavaScript floating-point maths, so very large or very small values may show rounding. This is a handy calculator, not a precision maths engine.</div>
        `
    },
    {
        id: 'converter',
        cat: 'tools',
        title: 'Converter',
        summary: 'Convert length, mass, temperature, speed, volume and currency.',
        tags: 'converter units length mass temperature speed volume currency convert metric imperial',
        appHref: 'converter',
        appName: 'Converter',
        related: ['calculator', 'settings'],
        body: `
            <p>Converter changes a value between units in six categories: Length, Mass, Temperature, Speed, Volume and Currency.</p>
            <h2>Converting</h2>
            <ol>
                <li>Choose a category.</li>
                <li>Pick the "from" and "to" units.</li>
                <li>Type a number on the keypad or use the device keyboard.</li>
                <li>Tap the swap arrows to reverse the direction.</li>
            </ol>
            <p>Temperature handles Celsius, Fahrenheit and Kelvin with the correct offset maths, not just a scale factor. Currency uses live exchange rates when the network is available; rates are indicative and can lag.</p>
            <div class="note"><b>Units in the rest of ReKindle:</b> Weather and distance displays follow the Measurement Units setting in the Control Panel (Auto, Metric or Imperial). Converter is independent - it always lets you pick both sides.</div>
        `
    },
    {
        id: 'dictionary',
        cat: 'tools',
        title: 'Dictionary',
        summary: 'Look up definitions in seven languages, including Ancient Greek.',
        tags: 'dictionary definitions words english spanish french german italian portuguese ancient greek',
        appHref: 'dictionary',
        appName: 'Dictionary',
        related: ['translate', 'wordle'],
        body: `
            <p>Dictionary looks up word definitions. Choose a language, type a word and tap Define.</p>
            <h2>Languages</h2>
            <p>English, Español, Français, Deutsch, Italiano, Português and Ancient Greek. Each language uses its own dictionary source; coverage varies, and uncommon inflections may not resolve.</p>
            <h2>Tips</h2>
            <ul>
                <li>Search the base form of a word ("run", not "running") when a lookup fails.</li>
                <li>Ancient Greek uses polytonic spellings; if the keyboard cannot produce accents, try the plain letters.</li>
                <li>For translation between languages rather than definitions, use <a href="#translate">Translator</a>.</li>
            </ul>
            <div class="note"><b>Network:</b> definitions come from an online dictionary service, so the app needs a connection. A missing result usually means the word is not in that language's source, not that the app is broken.</div>
        `
    },
    {
        id: 'translate',
        cat: 'tools',
        title: 'Translator',
        summary: 'Translate text between ten languages with automatic source detection.',
        tags: 'translate translator languages spanish french german italian portuguese japanese korean chinese russian detect',
        appHref: 'translate',
        appName: 'Translator',
        related: ['dictionary', 'language'],
        body: `
            <p>Translator converts text between English, Spanish, French, German, Italian, Portuguese, Japanese, Korean, Chinese and Russian.</p>
            <h2>Translating</h2>
            <ol>
                <li>Leave the source on <b>Detect</b> to let the app identify the language, or choose it manually.</li>
                <li>Choose the target language.</li>
                <li>Type or paste the text and tap Translate.</li>
                <li>Use the swap arrows to reverse the pair.</li>
            </ol>
            <p>Short phrases work best. Idioms, names and technical terms can come out oddly; treat the result as a draft, especially for anything important.</p>
            <div class="note"><b>KindleChat translations are separate:</b> chat messages are translated automatically by ReKindle's own translation worker into every supported language. See <a href="#kindlechat">KindleChat</a>.</div>
        `
    },
    {
        id: 'clocks',
        cat: 'tools',
        title: 'Clock',
        summary: 'A world clock for several cities, with optional seconds.',
        tags: 'clock world time zones cities seconds local time travel',
        appHref: 'clocks',
        appName: 'Clock',
        related: ['weather', 'settings'],
        body: `
            <p>Clock shows the current time in several cities at once. It is useful when you work with people in other timezones or travel.</p>
            <h2>Setting it up</h2>
            <ol>
                <li>Tap <b>Edit</b> to manage the list.</li>
                <li>Add a city by searching for it.</li>
                <li>Remove cities with the delete control.</li>
                <li>While Edit mode is on, the <b>Secs</b> button toggles seconds.</li>
            </ol>
            <p>Times are calculated from the location and timezone saved in Settings, with daylight-saving rules applied per city. The local clock row shows your own saved time.</p>
            <div class="note"><b>Why not use the device clock?</b> Kindle browsers often ignore the system timezone and report UTC. ReKindle uses its own stored offset so world clocks stay consistent. See <a href="#troubleshooting">Troubleshooting</a> if a city is off by an hour.</div>
        `
    },
    {
        id: 'breathing',
        cat: 'tools',
        title: 'Breathing',
        summary: 'Guided breathing patterns for relaxation, focus and balance.',
        tags: 'breathing relax focus box 4-7-8 balance calm anxiety meditation',
        appHref: 'breathing',
        appName: 'Breathing',
        related: ['timer', 'journal'],
        body: `
            <p>Breathing is a visual breathing guide. Choose a pattern, tap Start, and follow the expanding and contracting circle.</p>
            <h2>Patterns</h2>
            <table>
                <tr><th>Pattern</th><th>Rhythm</th><th>Best for</th></tr>
                <tr><td>Relax 4-7-8</td><td>Inhale 4, hold 7, exhale 8</td><td>Winding down and settling</td></tr>
                <tr><td>Focus (Box)</td><td>Inhale 4, hold 4, exhale 4, hold 4</td><td>Steady attention before work</td></tr>
                <tr><td>Balance 6-6</td><td>Inhale 6, exhale 6</td><td>An even, comfortable pace</td></tr>
            </table>
            <p>There is no audio; the guide is visual. Stop if you feel light-headed and return to normal breathing.</p>
            <div class="note"><b>Not medical advice:</b> breathing exercises are a general wellbeing tool, not treatment for a health condition.</div>
        `
    },
    {
        id: 'decide',
        cat: 'tools',
        title: 'Decider',
        summary: 'A spinning wheel for when you cannot choose between options.',
        tags: 'decider spinner wheel random choice decide options',
        appHref: 'decide',
        appName: 'Decider',
        related: ['trivia'],
        body: `
            <p>Decider is a random choice wheel. Add options, tap Spin, and let it pick.</p>
            <h2>Using it</h2>
            <ol>
                <li>Type an option and add it to the wheel. Add as many as you like.</li>
                <li>Tap <b>Spin!</b>.</li>
                <li>The result appears in the centre. Tap OK and spin again, or edit the options.</li>
            </ol>
            <p>The choice is genuinely random. On e-ink the wheel may not animate smoothly; the result is still valid.</p>
            <div class="note"><b>Use it for:</b> what to eat, which game to play, who goes first, or breaking a tie. Do not use it for decisions that need evidence.</div>
        `
    },
    {
        id: 'maps',
        cat: 'tools',
        title: 'Maps',
        summary: 'Search places, view OpenStreetMap tiles and calculate a route.',
        tags: 'maps openstreetmap osm directions route location search travel gps',
        appHref: 'maps',
        appName: 'Maps',
        related: ['weather', 'clocks'],
        body: `
            <p>Maps uses OpenStreetMap data and services: Nominatim for search and OSRM for routing. Search for a place, pan and zoom the map, or ask for a route between two points.</p>
            <h2>Finding a place</h2>
            <ol>
                <li>Type a place in the search box and tap <b>Find</b>.</li>
                <li>Tap a result to centre the map on it.</li>
                <li>Use the arrow and +/- controls to pan and zoom.</li>
                <li><b>Clear</b> resets the search and markers.</li>
            </ol>
            <h2>Routes</h2>
            <ol>
                <li>Switch to <b>Route</b>.</li>
                <li>Enter a start and a destination. Leaving the start empty uses the current map centre, so pan to your position first.</li>
                <li>Tap <b>Get Route</b>. The route and distance/time estimate are drawn on the map.</li>
            </ol>
            <div class="note"><b>Not a navigation app:</b> there is no turn-by-turn guidance, live traffic or voice. Use it for orientation and planning, not for driving directions. Map tiles need a network connection.</div>
        `
    },
    {
        id: 'wikipedia',
        cat: 'tools',
        title: 'Wikipedia',
        summary: 'Search the free encyclopedia or open a random article.',
        tags: 'wikipedia encyclopedia reference random search article knowledge',
        appHref: 'wikipedia',
        appName: 'Wikipedia',
        related: ['history', 'browser'],
        body: `
            <p>Wikipedia is a focused reader for the free encyclopedia. Search a topic or tap Random for something new.</p>
            <h2>Reading</h2>
            <ul>
                <li>Type a topic and tap <b>Go</b>.</li>
                <li>Tap <b>Random</b> to open a random article.</li>
                <li>Internal links load the next article in the same reader.</li>
                <li>Images and long articles may take a moment on e-ink.</li>
            </ul>
            <div class="note"><b>Licence:</b> Wikipedia text is available under CC BY-SA. If you reuse it, keep the attribution and share-alike terms. This app is a reader, not an offline copy - articles need a connection.</div>
            <p>For "what happened on this date", see <a href="#history">On This Day</a>. For general web reading, use <a href="#browser">Browser</a>.</p>
        `
    },
    {
        id: 'history',
        cat: 'tools',
        title: 'On This Day',
        summary: 'Events, births and deaths that happened on today\'s date.',
        tags: 'history on this day events births deaths date wikipedia anniversary',
        appHref: 'history',
        appName: 'On This Day',
        related: ['wikipedia', 'news'],
        body: `
            <p>On This Day shows historical events, births and deaths for the current date, sourced from Wikipedia's date pages.</p>
            <h2>Using it</h2>
            <ol>
                <li>Open the app; today's date is selected.</li>
                <li>Switch between Events, Births and Deaths.</li>
                <li>Entries are plain summaries; there are no further links in the app.</li>
            </ol>
            <p>The date follows the location saved in Settings, so a device set to UTC does not show yesterday's entries.</p>
            <div class="note"><b>Historical framing:</b> entries are summaries from a public wiki and may reflect gaps or bias in the source. Treat them as a starting point, not a definitive record.</div>
        `
    },
    {
        id: 'chat',
        cat: 'tools',
        title: 'AI Assistant',
        summary: 'A text-first AI chat, with hosted Gemini or your own API key.',
        tags: 'ai assistant oracle chat gemini openai groq xai mistral perplexity ollama api key custom model pro quota',
        badges: ['REKINDLE+'],
        appHref: 'chat',
        appName: 'AI Assistant',
        related: ['pro', 'wikipedia', 'notes'],
        body: `
            <p>AI Assistant is a chat window optimised for text. It can answer questions, rewrite text, explain ideas and help with code. Replies are rendered as Markdown, so ask for short, plain answers when you want the least screen refreshing.</p>
            <h2>Using the hosted model</h2>
            <ol>
                <li>Open AI Assistant and type a message.</li>
                <li>Tap <b>Send</b>. The default hosted model is Google Gemini.</li>
                <li>The strip under the message box shows the remaining daily messages (10 for the hosted model). A custom API key removes the cap.</li>
                <li><b>Clear</b> starts a new conversation.</li>
                <li><b>Copy to Note</b> on a reply saves it into <a href="#notes">Notes</a>.</li>
            </ol>
            <h2>Bring your own key</h2>
            <p>Open <b>Settings</b> in the app and enable a custom provider. Supported presets include OpenAI, Google Gemini, Groq, xAI (Grok), Mistral, Perplexity, Together AI, Fireworks AI, Ollama (local) and custom OpenAI- or Gemini-compatible endpoints. Pick a model, paste the API key and save. The key is stored in your private account settings (Firebase), so it follows you to another device; clearing site data does not remove it. Saving a custom key requires ReKindle+.</p>
            <div class="note"><b>Privacy:</b> messages sent to a hosted provider are subject to that provider's terms. Do not paste passwords, private keys or sensitive personal data into any AI chat. Local Ollama keeps prompts on your own network.</div>
            <p><b>Tip:</b> ask for short answers and plain formatting. Long markdown tables and code blocks are harder to read on a small e-ink screen.</p>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([

    /* ------------------------------------------------------------------ */
    /* LIFESTYLE & MEDIA                                                   */
    /* ------------------------------------------------------------------ */

    {
        id: 'bluesky',
        cat: 'lifestyle',
        title: 'Bluesky',
        summary: 'Read your Bluesky feed, notifications and discover timeline, and post from the e-reader.',
        tags: 'bluesky bsky social feed post app password notifications discover search pro',
        badges: ['REKINDLE+'],
        appHref: 'bluesky',
        appName: 'Bluesky',
        related: ['mastodon', 'pinterest', 'substack'],
        body: `
            <p>Bluesky connects to your Bluesky account so you can read your timeline, check notifications, discover posts and publish short updates.</p>
            <h2>Logging in</h2>
            <ol>
                <li>Tap <b>Bluesky Login</b>.</li>
                <li>Enter your handle and an <b>app password</b> from Bluesky's settings, not your main password.</li>
                <li>Tap Log In. The session is kept on the device, and the app password is encrypted and saved to your account so you can reconnect on another device.</li>
            </ol>
            <div class="note"><b>Use an app password:</b> it can be revoked separately and limits the damage if the device is lost. Never enter your main Bluesky password into a shared e-reader.</div>
            <h2>Using it</h2>
            <ul>
                <li><b>Feed</b> - your following timeline. It reloads when reopened and refreshes at most every few minutes.</li>
                <li><b>Notifications</b> - likes, reposts, follows and replies.</li>
                <li><b>Discover</b> - suggested and trending posts.</li>
                <li><b>Search</b> - find posts and people.</li>
                <li><b>New Post</b> - compose up to 300 characters and publish.</li>
            </ul>
            <p>The <b>Messages</b> tab lists your recent conversations read-only. Opening a thread and replying still happens in the official Bluesky app.</p>
            <p><b>Logout</b> clears the session on this device; the saved app password stays in your account until you replace it or delete the account. ReKindle+ is required.</p>
        `
    },
    {
        id: 'mastodon',
        cat: 'lifestyle',
        title: 'Mastodon',
        summary: 'Connect a Mastodon instance with an access token to read and post.',
        tags: 'mastodon fediverse social instance access token posts following favourites pro',
        badges: ['REKINDLE+'],
        appHref: 'mastodon',
        appName: 'Mastodon',
        related: ['bluesky', 'pinterest'],
        body: `
            <p>Mastodon is decentralised: you choose an instance, and your account lives there. ReKindle connects to whichever instance you use.</p>
            <h2>Connecting</h2>
            <ol>
                <li>Enter your instance URL (for example <code>mastodon.social</code>).</li>
                <li>In your instance's settings, create an access token with read and write permissions.</li>
                <li>Paste the token into ReKindle and tap Log In.</li>
            </ol>
            <h2>Tabs</h2>
            <ul>
                <li><b>Home</b> - your home timeline.</li>
                <li><b>Trending</b> - popular posts on the instance.</li>
                <li><b>Messages</b> - your conversations.</li>
                <li><b>Notifications</b> - mentions, favourites and follows.</li>
                <li><b>Profile</b> - your account, with Posts, Following and Favorites sub-tabs.</li>
                <li><b>New Post</b> - compose up to 500 characters and publish.</li>
            </ul>
            <p>The token is encrypted and saved to your ReKindle account (Pro data), so another device can pick it up, and sent directly to your instance. Logout deletes it everywhere. ReKindle+ is required.</p>
            <div class="note"><b>Instance differences:</b> some instances limit API access, media or character counts. If a tab is empty, check that your token has the right scopes and that the instance URL is correct (https:// is added automatically).</div>
        `
    },
    {
        id: 'pinterest',
        cat: 'lifestyle',
        title: 'Pinterest',
        summary: 'Browse pins, search ideas and view or save to your boards.',
        tags: 'pinterest pins boards ideas search save connect pro beta',
        badges: ['REKINDLE+', 'BETA'],
        appHref: 'pinterest',
        appName: 'Pinterest',
        related: ['bluesky', 'mastodon', 'photoframe'],
        body: `
            <p>Pinterest brings your boards and ideas to the e-reader: browse pins, search, open a board and save an image to one of your boards.</p>
            <h2>Connecting</h2>
            <ol>
                <li>Sign in on a <b>phone or computer</b> and tap <b>Connect Pinterest</b>, then authorise ReKindle.</li>
                <li>The connection is saved to your ReKindle account, so opening Pinterest on your Kindle picks it up automatically - you only authorise once.</li>
                <li>Pinterest's own sign-in page cannot run in the Kindle browser, so connecting directly on a Kindle shows a blank page.</li>
                <li>Use <b>Disconnect</b> to remove the connection from every device.</li>
            </ol>
            <h2>Browsing</h2>
            <ul>
                <li>Search for an idea or topic.</li>
                <li>Tap a pin to see it larger, with its title and destination.</li>
                <li>Open a board to see its pins.</li>
                <li>Use <b>Save to Board</b> to save a pin you found.</li>
            </ul>
            <div class="note"><b>BETA:</b> Pinterest's API can be slow and occasionally returns empty results. Images are the point of Pinterest, so expect more e-ink refreshing than in text apps. ReKindle+ is required.</div>
        `
    },
    {
        id: 'substack',
        cat: 'lifestyle',
        title: 'Substack',
        summary: 'Read your Substack inbox, subscriptions and paid posts with a session cookie.',
        tags: 'substack newsletters inbox subscriptions paid posts cookie session pro sync',
        badges: ['REKINDLE+'],
        appHref: 'substack',
        appName: 'Substack',
        related: ['rssreader', 'readwise', 'news'],
        body: `
            <p>Substack shows your personal Substack feed: publications you follow and paid posts you have access to.</p>
            <h2>Connecting</h2>
            <p>Substack does not offer a public login API, so ReKindle asks for your Substack session cookie:</p>
            <ol>
                <li>Sign in to substack.com in a desktop browser.</li>
                <li>Open the developer tools, find the site cookies, and copy the session cookie value.</li>
                <li>Paste it into ReKindle and tap <b>Save &amp; Connect</b>.</li>
            </ol>
            <div class="note"><b>Treat the cookie like a password.</b> It grants access to your Substack account. While ReKindle+ is active and you are signed in, the cookie syncs to your other devices through your ReKindle account automatically; only do that on accounts you trust. There is no disconnect control yet; deleting your ReKindle account removes the saved cookie.</div>
            <h2>Reading</h2>
            <ul>
                <li><b>Following</b> - recent posts from the publications you follow.</li>
                <li><b>Subscriptions</b> - your library of paid/free subscriptions; tapping a publication filters the posts to it.</li>
                <li>Tap a post to read it in the built-in reader, or open it externally.</li>
            </ul>
            <p>ReKindle+ is required. Paid posts work only if your cookie belongs to an account with access.</p>
        `
    },
    {
        id: 'reddit',
        cat: 'lifestyle',
        title: 'Reddit',
        summary: 'A text-first Reddit browser for saved subreddits, with automatic retry when rate-limited.',
        tags: 'reddit subreddits saved posts comments browse rate limit offline retry',
        appHref: 'reddit',
        appName: 'Reddit',
        related: ['news', 'rssreader', 'browser'],
        body: `
            <p>Reddit reads public subreddits in a text-first layout. It is for browsing and reading, not for posting or voting.</p>
            <h2>Using it</h2>
            <ol>
                <li>Type a subreddit name (for example <code>books</code> or <code>eink</code>) and tap <b>Go</b>, then tap the star to save it.</li>
                <li>Choose it from the sidebar to load its posts.</li>
                <li>Tap a post to read the text and comments.</li>
                <li><b>Remove Subreddit</b> deletes it from your list.</li>
            </ol>
            <h2>Rate limiting</h2>
            <p>Reddit aggressively limits requests from shared cloud addresses. When that happens, ReKindle says it is retrying and keeps the window open. It backs off and tries again rather than failing immediately. If it cannot recover, wait several minutes; this is Reddit's limit, not a ReKindle setting.</p>
            <div class="note"><b>Saved subreddits</b> are stored on the device and sync to your account when signed in. Posts and comments need a connection; there is no offline archive of old threads. NSFW and quarantined communities may not load.</div>
        `
    },
    {
        id: 'watchlist',
        cat: 'lifestyle',
        title: 'Watchlist',
        summary: 'Track films and TV shows, keep a watch list and see release dates on a calendar.',
        tags: 'watchlist movies tv shows films tmdb calendar search my list trailers',
        appHref: 'watchlist',
        appName: 'Watchlist',
        related: ['news', 'books', 'photoframe'],
        body: `
            <p>Watchlist is a film and TV tracker powered by The Movie Database (TMDB). Search for a title, add it to your list, and see upcoming release dates in a calendar view.</p>
            <h2>Building a list</h2>
            <ol>
                <li>Search for a movie or show.</li>
                <li>Tap a result to open its details: title, release date, type and overview.</li>
                <li>Add it to <b>My List</b>. Use the calendar tab to see dates for saved titles.</li>
                <li>Open a saved title and use <b>Remove</b> in the detail view.</li>
            </ol>
            <p>A free account is required to search, save titles and see the calendar; the page shows a login prompt otherwise. The list syncs through your account. The app does not stream anything - it is a tracker with links to find a title elsewhere.</p>
            <div class="note"><b>Metadata:</b> posters and details come from TMDB and may change. If posters are slow, the list still works; on e-ink, black-and-white posters are expected.</div>
        `
    },
    {
        id: 'photoframe',
        cat: 'lifestyle',
        title: 'Photo Frame',
        summary: 'Turn the e-reader into a photo slideshow with adjustable timing and layout.',
        tags: 'photo frame slideshow jpeg pictures shuffle fit crop duration pro',
        badges: ['REKINDLE+'],
        appHref: 'photoframe',
        appName: 'Photo Frame',
        related: ['pixel', 'flipbook'],
        body: `
            <p>Photo Frame displays a slideshow of your photos, which is a good use for an e-reader that is otherwise idle. JPEG, PNG and WebP are accepted.</p>
            <h2>Loading photos</h2>
            <ol>
                <li>Tap <b>Upload JPEGs</b> (the picker also accepts PNG and WebP) and choose photos from the device.</li>
                <li>Wait for them to load; the counter shows how many are ready.</li>
                <li>Choose <b>Sequential</b> or <b>Shuffle</b>.</li>
                <li>Choose <b>Fit to Screen</b> or <b>Crop to Fill</b>.</li>
                <li>Set the slide duration: 10 seconds, 30 seconds, 1, 5 or 30 minutes.</li>
                <li>Tap <b>Start Playback</b>. Tap the screen to advance manually; <b>Exit</b> stops.</li>
            </ol>
            <div class="note"><b>E-ink reality:</b> photos look best in grayscale, and each new slide is a full screen refresh. Longer durations (5-30 minutes) suit a photo frame; 10 seconds is a fast slideshow, not a smooth animation. ReKindle+ is required.</div>
        `
    },
    {
        id: 'sheetmusic',
        cat: 'lifestyle',
        title: 'Sheet Music',
        summary: 'Browse and render MusicXML or MIDI scores, and build a personal library.',
        tags: 'sheet music scores musicxml mxl midi piano instruments upload library store osmd',
        appHref: 'sheetmusic',
        appName: 'Sheet Music',
        related: ['chords', 'language'],
        body: `
            <p>Sheet Music renders notation in the browser. It includes a public-domain library, an online store list and an upload option that is currently limited to administrators.</p>
            <h2>Viewing a score</h2>
            <ol>
                <li>Choose <b>All Instruments</b> or a specific instrument.</li>
                <li>Pick a score from the library or the online store.</li>
                <li>The score renders as SVG page notation.</li>
                <li>Tap <b>Add</b> to add it to <b>My Library</b>.</li>
            </ol>
            <h2>Uploading</h2>
            <p>The <b>Upload Sheet Music</b> button is visible but disabled for normal accounts: uploads are limited to administrators for now. When it opens up, it will take a title, composer, instrument and a <code>.mxl</code>, <code>.musicxml</code> or <code>.mid</code> file, converted to notation in the browser.</p>
            <div class="note"><b>No playback:</b> this app displays notation; it does not play audio. For guitar chords and tabs, use <a href="#chords">Chords</a>.</div>
        `
    },
    {
        id: 'chords',
        cat: 'lifestyle',
        title: 'Chords',
        summary: 'Search guitar chords and tabs, then save songs to a personal library.',
        tags: 'chords guitar tabs lyrics music search library save songs',
        appHref: 'chords',
        appName: 'Chords',
        related: ['sheetmusic'],
        body: `
            <p>Chords searches a guitar tab service for songs and displays the chords and lyrics in a monospaced, readable view.</p>
            <h2>Searching</h2>
            <ol>
                <li>Open <b>Search</b> and type a song or artist.</li>
                <li>Tap a result to load the tab.</li>
                <li>Use the back control to return to results.</li>
            </ol>
            <h2>Your library</h2>
            <p>Tap <b>Save</b> on a tab to keep it in <b>Library</b>. Saved songs sync to your account when signed in and are cached locally for guest use. Remove a song from the library when you no longer need it.</p>
            <div class="note"><b>Formatting:</b> tabs are shown in a fixed-width font so chord lines stay above the lyrics. On a narrow screen, rotate to landscape for long lines. The service can return errors if its upstream source is unavailable; try again later.</div>
        `
    },
    {
        id: 'cookbook',
        cat: 'lifestyle',
        title: 'Cookbook',
        summary: 'Find recipes by name or by the ingredients you have, and save favourites.',
        tags: 'cookbook recipes food cooking ingredients meals themealdb search my cookbook',
        appHref: 'cookbook',
        appName: 'Cookbook',
        related: ['food', 'notes'],
        body: `
            <p>Cookbook searches TheMealDB for recipes. You can search by recipe name or list the ingredients in your kitchen and find meals that use them.</p>
            <h2>Finding recipes</h2>
            <ol>
                <li>Switch between <b>By Ingredients</b> and <b>By Recipe Name</b>.</li>
                <li>Add one or more ingredients, then tap <b>Find Recipes</b>.</li>
                <li>Tap a result to open the full recipe: ingredients, measures and instructions.</li>
                <li>Tap <b>Save</b> to add it to <b>My Cookbook</b>.</li>
            </ol>
            <p>Saved recipes sync to your account when signed in; guest recipes stay on the device. The cookbook search requires a network connection.</p>
            <div class="note"><b>Ingredient search is a match, not a strict filter.</b> Results may include recipes with extra ingredients beyond what you listed. Check the recipe before cooking, especially for allergies.</div>
        `
    },
    {
        id: 'language',
        cat: 'lifestyle',
        title: 'Languages',
        summary: 'Practise common words and sentences in eight languages with short quizzes.',
        tags: 'language learning spanish french german italian portuguese russian japanese chinese quiz practice sentences',
        badges: ['BETA'],
        appHref: 'language',
        appName: 'Languages',
        related: ['dictionary', 'translate', 'flashcards'],
        body: `
            <p>Languages is a pocket vocabulary trainer. It covers Spanish, French, German, Italian, Portuguese, Russian, Japanese and Chinese with short units of common words and sentence practice.</p>
            <h2>Quiz mode</h2>
            <ol>
                <li>Choose a language.</li>
                <li>Pick a unit: Basics, Animals, Food, Places or Family.</li>
                <li>Answer the multiple-choice question and tap <b>Check</b>.</li>
                <li>Tap <b>Continue</b> to advance. Completed units are remembered.</li>
            </ol>
            <h2>Sentence practice</h2>
            <p>The Sentences mode gives you a random sentence to translate or complete. It is less structured than the units and works best once you know some vocabulary.</p>
            <div class="note"><b>BETA:</b> translations come from an online service, so a phrase can occasionally be literal or use a regional variant. Treat the quiz as practice, not a certified course. Progress is stored locally.</div>
        `
    },
    {
        id: 'flipbook',
        cat: 'lifestyle',
        title: 'Flipbook',
        summary: 'Draw frame-by-frame pixel animations, preview them and post them to KindleChat.',
        tags: 'flipbook animation pixel art frames fps onion skin gif post kindlechat pro',
        badges: ['REKINDLE+'],
        appHref: 'flipbook',
        appName: 'Flipbook',
        related: ['pixel', 'kindlechat'],
        body: `
            <p>Flipbook is a frame-by-frame animation editor. Each frame is a 256x256 pixel canvas; play them in sequence to make a short animation.</p>
            <h2>Creating an animation</h2>
            <ol>
                <li>Tap <b>+ New</b> to start an animation; it begins as "Untitled" and can be renamed from the library.</li>
                <li>Draw on the canvas with Pen, Eraser or Fill. <b>Clear</b> empties the current frame.</li>
                <li>Add frames with the frame controls. Duplicate a frame to continue a drawing smoothly.</li>
                <li>Use undo/redo while drawing. Onion skin shows the previous frame faintly.</li>
                <li>Change the playback speed with the FPS button (6 FPS by default).</li>
                <li>Preview the animation, then save. Autosave runs shortly after each stroke.</li>
            </ol>
            <h2>Sharing</h2>
            <ul>
                <li><b>Download</b> exports the animation as an animated file for use outside ReKindle.</li>
                <li><b>Post to KindleChat</b> publishes it to the General chat and the art gallery after confirmation.</li>
                <li>Animations are saved to your account, not just the device.</li>
            </ul>
            <div class="note"><b>ReKindle+ required.</b> Keep animations short - many large frames make saving slower on an e-reader. Posted art must be all-ages friendly.</div>
        `
    },
    {
        id: 'pixel',
        cat: 'lifestyle',
        title: 'Pixel',
        summary: 'Draw 1-bit pixel art on 16x16, 32x32 or 64x64 grids, set it as wallpaper or post it.',
        tags: 'pixel art drawing 1bit grid wallpaper kindlechat gallery download 16 32 64',
        appHref: 'pixel',
        appName: 'Pixel',
        related: ['flipbook', 'napkin', 'kindlechat'],
        body: `
            <p>Pixel is a 1-bit drawing tool. Every pixel is black or white, which suits e-ink perfectly and makes crisp icons and avatars.</p>
            <h2>Drawing</h2>
            <ol>
                <li>Tap <b>+ New Drawing</b> and choose 16x16, 32x32 or 64x64.</li>
                <li>Use <b>Pen</b> to draw, <b>Eraser</b> to remove, and <b>Fill</b> to flood-fill a region.</li>
                <li>Use undo/redo and <b>Clear</b> as needed.</li>
                <li>Changes save automatically. Drawings appear in <b>My Drawings</b>.</li>
            </ol>
            <h2>What you can do with a drawing</h2>
            <ul>
                <li><b>Download</b> - save a PNG to the device.</li>
                <li><b>Set Background</b> - use it as the ReKindle desktop wallpaper.</li>
                <li><b>Post to KindleChat</b> - share it in General chat and the art gallery. Blank art and an unchanged repost are blocked. 64x64 drawings can be downloaded or set as wallpaper but cannot be posted.</li>
            </ul>
            <div class="note"><b>Community art:</b> posted pixel art must be friendly for all ages. Duplicate posts of the same drawing are rejected; edit the drawing first if you want to repost.</div>
        `
    },
    {
        id: 'suggestions',
        cat: 'lifestyle',
        title: 'Suggestions',
        summary: 'Post feature ideas, bugs and translation fixes, vote on others and follow the status.',
        tags: 'suggestions feedback feature request bug report vote status translation community',
        appHref: 'suggestions',
        appName: 'Suggestions',
        related: ['support', 'discord'],
        body: `
            <p>Suggestions is the official feedback board. It covers feature ideas, problems, translation issues and other requests.</p>
            <h2>Posting</h2>
            <ol>
                <li>Sign in, then tap <b>+ New Idea</b>.</li>
                <li>Choose a type: Suggestion, Problem or Translation.</li>
                <li>Start typing a title. If a similar idea is already loaded, ReKindle shows it under the title - open it and upvote there instead of posting a duplicate.</li>
                <li>Write a title and details. For a bug, include the app, device and steps.</li>
                <li>Submit. Only the owner can edit, recategorise or delete a post after it is submitted; add a comment to clarify.</li>
            </ol>
            <h2>Voting and status</h2>
            <ul>
                <li>Upvote ideas you want to see. The list can be sorted by Popular or Newest.</li>
                <li><b>My Suggestions</b> filters to your own posts.</li>
                <li>Status labels show where an item stands: Open, In Progress, Deferred, Done or Closed.</li>
                <li>Switch type to see Suggestions, Problems or Translation issues separately.</li>
                <li>The board loads recent ideas first. Tap <b>Load older</b> at the bottom to search further back; the search box covers the ideas currently loaded.</li>
            </ul>
            <p>Answers to common questions live in the <a href="#faq">FAQ</a>, recent changes are on the <a href="changelog.html">Changelog</a>, and billing questions are covered under <a href="#faq">refunds and Pro</a> and <a href="#support">Support</a>.</p>
            <div class="note"><b>Before posting:</b> search for an existing item and vote on it instead. Duplicates make the board harder to use. For urgent account, billing or safety issues, email support rather than posting publicly.</div>
        `
    },

    /* ------------------------------------------------------------------ */
    /* COMMUNITY & SAFETY                                                  */
    /* ------------------------------------------------------------------ */

    {
        id: 'kindlechat',
        cat: 'social',
        title: 'KindleChat',
        summary: 'The ReKindle community chat: translations, emoji, pixel art, gallery and direct messages.',
        tags: 'kindlechat chat messages general room emoji ascii art gallery translations block report rules dm',
        appHref: 'kindlechat',
        appName: 'KindleChat',
        related: ['kindlechat-dm', 'neighbourhood', 'topics', 'safety'],
        body: `
            <p>KindleChat is the public community chat for ReKindle readers. It has one main General room, an art gallery, automatic translations and optional direct messages.</p>
            <h2>Sending messages</h2>
            <ol>
                <li>Sign in and complete the age check.</li>
                <li>Type in the composer. Messages can be up to 1,000 characters.</li>
                <li>Tap <b>Send</b>. By default Enter sends and Shift+Enter adds a new line; this can be changed in Settings.</li>
                <li>Scroll to the top of the chat to load older messages.</li>
            </ol>
            <h2>Translations</h2>
            <p>Messages are translated into every supported language by ReKindle's translation worker. Open <b>Settings</b> and choose <b>Translation Language</b>, or leave it on Auto to follow your system language. When <b>Show Translations</b> is on, each message is replaced by its translation and a <b>Show Original</b> control switches back. If a translation is missing, it may still arrive - retries continue for a few minutes after sending.</p>
            <h2>Emoji and ASCII art</h2>
            <p>The smiley button opens a picker with Unicode emoji (shown as OpenMoji images, so they display correctly on Kindle) and a tab of ASCII art emoticons. The composer inserts the right form; type plain text normally.</p>
            <h2>Art gallery</h2>
            <p>Pixel art and flipbooks posted to chat appear in the <b>Gallery</b>. Tap an item to view it larger or play the animation. You can save pixel art from the gallery to your own drawings.</p>
            <h2>Safety and rules</h2>
            <ul>
                <li>Be kind. No harassment, hate, spam, flooding or self-promotion.</li>
                <li>Links and URLs are blocked. Promotion of competing services is blocked and masked.</li>
                <li>Art must be safe for all ages.</li>
                <li>Messages are moderated. Use the <b>!</b> report control; if a direct-message thread makes you uncomfortable, block the person there.</li>
                <li>Flood protection rejects the third near-identical message within 10 minutes and exact repeats within 5 minutes.</li>
            </ul>
            <p>General chat keeps the last 30 days of messages (and always at least the latest 50), so old conversations age out. Replies and reactions are available on each message.</p>
            <div class="note"><b>Direct messages</b> are opt-in and separate from the public room. See <a href="#kindlechat-dm">KindleChat DMs</a>.</div>
        `
    },
    {
        id: 'kindlechat-dm',
        cat: 'social',
        title: 'KindleChat direct messages',
        summary: 'Opt-in one-to-one chats: requests, acceptance, blocking and what is moderated.',
        tags: 'kindlechat dm direct message private request accept decline block pro safety',
        related: ['kindlechat', 'safety'],
        body: `
            <p>Direct messages let two people talk privately. They are deliberately opt-in: a first contact is a request that the recipient must accept.</p>
            <h2>The rules</h2>
            <ul>
                <li>Only ReKindle+ members can <b>start</b> a conversation. Anyone age-verified can receive a request and reply once accepted.</li>
                <li>The first request is limited to 300 characters and is moderated before it is delivered.</li>
                <li>Messages are text only (up to 1,000 characters). Links, pixel art and flipbooks are not allowed.</li>
                <li>A declined pair cannot restart the conversation. A block stops contact until the person who set it unblocks.</li>
                <li>Block and report are always available.</li>
            </ul>
            <h2>Using DMs</h2>
            <ol>
                <li>Open the <b>Messages</b> tab in KindleChat and tap <b>New Message</b>, then enter the username.</li>
                <li>Write a short introduction and send the request.</li>
                <li>The recipient accepts or declines. Once accepted, the thread opens for both.</li>
                <li>Use the <b>Block</b> button to stop all further contact. You can lift a block later with <b>Unblock</b> in that conversation (an accepted chat reopens; a blocked request returns to your inbox).</li>
            </ol>
            <h2>Request settings</h2>
            <p>In KindleChat Settings you can turn <b>Allow message requests</b> on or off. Turning it off does not delete existing accepted conversations; it stops new requests. You can have at most three outgoing requests waiting at once. Messages are moderated and stored on ReKindle's social service, not on your device.</p>
            <div class="note"><b>Safety:</b> never share passwords, addresses, payment details or other private information. If a request feels wrong, decline it; you do not owe anyone a reply.</div>
        `
    },
    {
        id: 'neighbourhood',
        cat: 'social',
        title: 'Neighbourhood',
        summary: 'A profile-based community for posts, comments, profiles and messaging.',
        tags: 'neighbourhood profile posts comments neighbours find people message avatar interests social',
        appHref: 'neighbourhood',
        appName: 'Neighbourhood',
        related: ['kindlechat', 'topics', 'safety'],
        body: `
            <p>Neighbourhood is the profile side of ReKindle's community. You create a public profile, post updates, comment, and find other readers with shared interests.</p>
            <h2>Your profile</h2>
            <p>Tap <b>Edit Profile</b> to set a display name, bio/status, location, occupation, hometown, languages, social links, interests, favourites (music, TV, movies, games, sports) and travel history. You can also draw a 16x16 pixel avatar with <b>Draw Icon</b>. Birthday is optional and is shown on your profile as your age, so leave it blank if you do not want that.</p>
            <h2>Posts and comments</h2>
            <ol>
                <li>Write a post at the top of the Posts tab and tap <b>Post</b>.</li>
                <li>Tap the comment control under a post to read and add comments.</li>
                <li>Edit or delete your own posts. A reported post is removed after two independent reports; a comment goes on the first. The owner can also remove anything that breaks the rules.</li>
            </ol>
            <h2>Finding people</h2>
            <p>Profiles are reached from their posts and comments. Tap a profile to view it, then <b>Message</b> to start a KindleChat direct conversation.</p>
            <div class="note"><b>Requirements:</b> you must be signed in and age-verified to post. Posts are limited to 280 characters, one after another is blocked until someone else posts, and the server also limits bursts (about 5 posts per 5 minutes and 10 comments per 30 seconds). Links and promotional content are blocked. A report adds a snapshot of the post and its author to ReKindle's report queue. Be careful about how much personal information you share.</div>
        `
    },
    {
        id: 'topics',
        cat: 'social',
        title: 'Topics',
        summary: 'Start discussion threads with optional polls and reply to other readers.',
        tags: 'topics discussion forum threads polls comments replies rules daily limit',
        appHref: 'topics',
        appName: 'Topics',
        related: ['neighbourhood', 'kindlechat', 'safety'],
        body: `
            <p>Topics is a discussion board. Each topic has a title, a short subheading, an icon and a thread of comments. Some topics include a poll.</p>
            <h2>Creating a topic</h2>
            <ol>
                <li>Tap <b>+ New</b>.</li>
                <li>Enter a title (up to 20 characters) and subheading (up to 35).</li>
                <li>Choose an icon and, optionally, add a poll question (up to 100 characters) with 2-4 options (up to 50 characters each).</li>
                <li>Create the topic. You can add comments immediately.</li>
            </ol>
            <div class="note"><b>Topic limits:</b> the board asks for one topic per day, and the server rate-limits new topics - you can post a few at first, then roughly one every eight hours. Search first; duplicate topics are removed.</div>
            <h2>Reading and replying</h2>
            <ul>
                <li>The sidebar loads the 60 most recent topics; <b>Show all topics</b> loads the rest. Use search to filter and <b>Mark Read</b> to clear unread markers.</li>
                <li>Tap a topic to open it, then add a comment (up to 1,000 characters).</li>
                <li>Vote in a poll by tapping an option; a submitted vote cannot be changed.</li>
                <li>Edit or delete your own topic and comments. A reported topic is removed after two independent reports (comments go on the first), and the owner can remove anything that breaks the rules.</li>
            </ul>
            <h2>Rules</h2>
            <p>Search before posting, keep topics conversational, no spam or self-promotion, and be respectful. Links and competitor promotions are blocked. Use the <b>!</b> report control for problems.</p>
        `
    },
    {
        id: 'safety',
        cat: 'social',
        title: 'Staying safe on ReKindle',
        summary: 'Age checks, reporting, blocking, moderation and the rules that keep social apps usable.',
        tags: 'safety report block moderation age verification privacy rules harassment scam links personal information',
        related: ['kindlechat', 'neighbourhood', 'topics', 'privacy'],
        body: `
            <p>ReKindle's social apps are for readers of all ages, and they are moderated. These are the tools and rules that keep them usable.</p>
            <h2>Age verification</h2>
            <p>Opening KindleChat, Neighbourhood or Topics asks you to confirm your date of birth and country before anything else loads. ReKindle checks the minimum social-media age for that country. This is a self-declaration, not an identity document upload, and the prompt cannot be dismissed - the social app stays locked until it is completed.</p>
            <h2>Reporting</h2>
            <p>Messages, posts, topic comments and direct messages have a <b>!</b> report control; profiles and the art gallery viewer do not. A report adds a snapshot of the content and its author to ReKindle's report queue, which only the owner can read. Every report needs a reason and a short comment containing at least one real word. Repeated false reports are themselves a rule violation.</p>
            <h2>Blocking</h2>
            <p>Blocking is available inside a KindleChat direct-message thread (there is no block in the public chat room or in Neighbourhood). Open the thread and tap <b>Block</b>: it ends the conversation and prevents new requests until you unblock them. Tap <b>Unblock</b> in the same place, and it returns to how it was before (an accepted chat reopens; a message request goes back to your inbox). Only the person who set the block can lift it. Elsewhere, stop interacting and report the account; the owner can remove or restrict it.</p>
            <h2>What is not allowed</h2>
            <ul>
                <li>Harassment, hate speech, threats, sexual content involving minors, or anything illegal.</li>
                <li>Spam, flooding, repeated near-identical messages, or automated posting.</li>
                <li>Links and URLs, self-promotion, or advertising competing services.</li>
                <li>Sharing someone else's private information without consent.</li>
                <li>Art that is not safe for all ages.</li>
            </ul>
            <p>Enforcement is mostly automatic: rate limits, blocked links and promoted terms, and content removal when a report threshold is reached. The owner can also ban accounts and IP addresses.</p>
            <h2>Protect yourself</h2>
            <ul>
                <li>Never share passwords, addresses, phone numbers, payment details or identity documents.</li>
                <li>Be sceptical of anyone asking to move the conversation off ReKindle or offering money, gifts or "support".</li>
                <li>Use a unique password. ReKindle staff will never ask for it.</li>
                <li>You can leave a conversation or decline a request at any time.</li>
            </ul>
            <div class="note"><b>Urgent problem?</b> Email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with "safety" in the subject. Include the username and a description; do not forward illegal content.</div>
        `
    },
    {
        id: 'discord',
        cat: 'social',
        title: 'Discord community',
        summary: 'Join the ReKindle Discord for chat, help and development updates.',
        tags: 'discord community chat help invite updates',
        related: ['support', 'suggestions'],
        body: `
            <p>ReKindle has a community Discord for general chat, troubleshooting and development updates. It is the quickest place to ask whether something is broken for everyone.</p>
            <h2>Joining</h2>
            <p>Tap the Discord app icon on the home screen, or open the About panel (ReKindle logo) and tap <b>Discord</b>. Both show the invite; the app icon opens a modal with the link and a QR code.</p>
            <h2>Before you ask</h2>
            <ul>
                <li>Search the channel history for the same question.</li>
                <li>Include your device, firmware and the app name.</li>
                <li>Do not post passwords, emails, API keys or private account details.</li>
                <li>Use the <a href="#suggestions">Suggestions</a> board for formal feature requests so they do not get lost in chat.</li>
            </ul>
            <div class="note"><b>Not official support:</b> Discord is community-run. For account, billing, safety or privacy issues, email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> so there is a traceable record.</div>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([

    /* ------------------------------------------------------------------ */
    /* GAMES                                                               */
    /* ------------------------------------------------------------------ */

    {
        id: 'games-overview',
        cat: 'games',
        title: 'Games: how they work',
        summary: 'Starting a game, controls, saves, the ? rules button and playing well on e-ink.',
        tags: 'games arcade play controls rules button save high score eink tips folders badges',
        sub: 'Start here',
        related: ['game-modes', 'leaderboards', 'car-games'],
        body: `
            <p>ReKindle has around fifty games, from quick word puzzles to long adventures. They all use the same System 7 window and most work with touch alone.</p>
            <h2>Finding a game</h2>
            <ul>
                <li>Open the <b>Games</b> tab for single-player games.</li>
                <li>Open <b>Multiplayer Games</b> for local pass-and-play and live online games.</li>
                <li>Games with several modes are grouped in a folder. Tap the folder, then choose Single, Local or Live.</li>
                <li>Use the <a href="#all">A-Z index</a> or this help app's search if you know the name.</li>
            </ul>
            <h2>Controls</h2>
            <p>Most games are tap-only, with large on-screen buttons. Action and arcade games also accept the arrow keys and Space on a keyboard, and usually have left/right, up/jump and down/roll controls. Each game's guide lists its own controls.</p>
            <h2>The ? rules button</h2>
            <p>Many games add a small <b>?</b> button to the title bar. It opens a "How to Play" panel with the rules and controls. Games with universally understood rules (Tic-Tac-Toe, Snake, Tetris, Dino, Memory and a few others) do not show it.</p>
            <h2>Saving</h2>
            <p>Many games save progress and high scores locally, and some sync state or post to a leaderboard. A few puzzles (Jigsaw, Hangman, Memory, Word Search, Anagrams, Connections) keep no saved state at all. Leaderboards need an account; the game itself does not. Clearing site data can remove local high scores and saved games even if the leaderboard entry remains.</p>
            <h2>Playing on e-ink</h2>
            <ul>
                <li>Wait for a refresh between fast actions; double taps can register twice.</li>
                <li>Use <b>Settings -> Display Mode -> LED (No Flashes)</b> for fewer full refreshes, or eInk mode if ghosting is distracting.</li>
                <li>Canvas games are deliberately black-and-white. Any grey anti-aliasing would force a full screen refresh every frame.</li>
                <li>If a game feels too fast, check whether it has a speed or difficulty setting before giving up.</li>
            </ul>
            <div class="note"><b>Games missing?</b> Check Settings for <b>Disable Games</b>, and check Edit mode on the home screen to see whether the icon is hidden.</div>
        `
    },
    {
        id: 'game-modes',
        cat: 'games',
        title: 'Single, local and live modes',
        summary: 'The difference between 1P, 2P and LIVE, plus every game that has more than one mode.',
        tags: 'single player local two player pass and play live online multiplayer lobby host join afk',
        sub: 'Start here',
        related: ['games-overview', 'leaderboards', 'chess', 'uno'],
        body: `
            <p>Many games exist in up to three versions. They share rules but differ in who you play and how the game is stored.</p>
            <h2>1P - single-player</h2>
            <p>You against the computer, or a solo puzzle. Most progress and high scores are local; board and cloud games (Wordle, Spelling Bee, Crossword, Mini Crossword, Sudoku, Minesweeper, Nonograms) also save to your account. These are the games listed under the Games tab and the single-player entry in a folder.</p>
            <h2>2P - local pass-and-play</h2>
            <p>Two people share one device and take turns. There is no account or network requirement. The screen usually tells you whose turn it is. These live under Multiplayer Games.</p>
            <h2>LIVE - online multiplayer</h2>
            <p>Real-time games against other ReKindle users. You need an account and a connection. Typical flow:</p>
            <ol>
                <li>Host a game from the live app, or open the home screen's <b>Live Games</b> list to join one. A shared link also works.</li>
                <li>Wait for an opponent. Most two-player games start automatically on the second join; Uno and Pictionary lobbies wait for the host to press Start.</li>
                <li>Play in real time. Uno has a 30-second AFK auto-skip and Pictionary has round timers; the other live games have no turn timer.</li>
                <li>If the host leaves, another player is promoted so the match can continue.</li>
            </ol>
            <h2>Games with multiple modes</h2>
            <table>
                <tr><th>Game</th><th>Single</th><th>Local</th><th>Live</th></tr>
                <tr><td>Chess</td><td>chess</td><td>2pchess</td><td>livechess</td></tr>
                <tr><td>Checkers</td><td>checkers</td><td>2pcheckers</td><td>livecheckers</td></tr>
                <tr><td>Connect 4</td><td>connect4</td><td>2pconnect4</td><td>liveconnect4</td></tr>
                <tr><td>Dots &amp; Boxes</td><td>dotsandboxes</td><td>2pdotsandboxes</td><td>livedotsandboxes</td></tr>
                <tr><td>Tic-Tac-Toe</td><td>tictactoe</td><td>2ptictactoe</td><td>livetictactoe</td></tr>
                <tr><td>Battleship</td><td>battleship</td><td>2pbattleships</td><td>-</td></tr>
                <tr><td>8 Ball (pool)</td><td>pool</td><td>pool2p</td><td>-</td></tr>
                <tr><td>Yahtzee</td><td>yahtzee</td><td>-</td><td>liveyahtzee</td></tr>
                <tr><td>Uno</td><td>uno (vs bots)</td><td>-</td><td>liveuno</td></tr>
                <tr><td>Pictionary</td><td>-</td><td>-</td><td>livepictionary</td></tr>
            </table>
            <p><b>Words Online</b> is asynchronous rather than live: it has no lobby or turn timer, and a match resumes later, so it is not listed in the LIVE column.</p>
            <div class="note"><b>Live games need patience:</b> lobbies may be empty at quiet times. Create a match and leave the tab open; the home screen shows joinable live games when someone is waiting.</div>
        `
    },
    {
        id: 'leaderboards',
        cat: 'games',
        title: 'Leaderboards and scoring',
        summary: 'How high scores are saved, which games have boards, and why impossible scores are rejected.',
        tags: 'leaderboard high score ranking verified cheating score server account records',
        sub: 'Start here',
        related: ['games-overview', 'game-modes'],
        body: `
            <p>Many games have a top-scores board. Boards show other players' best results, not just yours.</p>
            <h2>How a score is saved</h2>
            <ol>
                <li>You open a game, which starts a server-timed run.</li>
                <li>When the game ends, the score is sent to ReKindle's server.</li>
                <li>The server checks it against the game's limits and, for higher-is-better boards, the elapsed time, then writes it if it is believable.</li>
            </ol>
            <p>Scores are written only by the server. The browser cannot create or edit a leaderboard entry directly. That is why a fabricated value from the console does not appear on the board.</p>
            <h2>Games with boards</h2>
            <p>Tetris, Snake, Pac-Man, Wordle, Spelling Bee, Dino, Maze, Tower of Hanoi, Lights Out, Trivia, Solitaire, Block Blast, Pet, Mario, Yahtzee, Perfect Circle, Crossy, Surfer, Jumpy and Oregon Trail. Some boards rank by points (higher is better); others rank by moves or time (lower is better) - for example Solitaire, Hanoi and Lights Out.</p>
            <h2>Local and cloud records</h2>
            <ul>
                <li>Some games also keep a personal best on the device; others only store it on the shared board.</li>
                <li>You must be signed in for a score to reach the shared board.</li>
                <li>The game itself is playable in guest mode; only the shared submission needs an account.</li>
            </ul>
            <div class="note"><b>Why a score was rejected:</b> it was outside the game's allowed range or arrived faster than a human could play. Rejected attempts are logged for review. Play honestly; the board is meant to be fun, not a competition to exploit.</div>
        `
    },
    {
        id: 'wordle',
        cat: 'games',
        title: 'Wordle',
        summary: 'Guess the five-letter word in six tries, with daily and unlimited modes.',
        tags: 'wordle word guessing daily unlimited six tries stats streaks green yellow grey',
        sub: 'Word games',
        appHref: 'wordle',
        appName: 'Wordle',
        related: ['spellbound', 'nerdle', 'crossword'],
        body: `
            <p>Wordle is the familiar five-letter word game. You have six guesses; after each, the tiles show how close you are.</p>
            <h2>How to play</h2>
            <ol>
                <li>Type a five-letter word and press Enter.</li>
                <li>Green means the letter is correct and in the right place.</li>
                <li>Yellow means the letter is in the word but in the wrong place.</li>
                <li>Grey means the letter is not in the word.</li>
                <li>Solve it within six guesses.</li>
            </ol>
            <h2>Modes and stats</h2>
            <ul>
                <li><b>Daily</b> - one puzzle per day, shared by everyone. New games do not replace the daily.</li>
                <li><b>Unlimited</b> - play as many random words as you like.</li>
                <li><b>Stats</b> - games played, win percentage, current streak, max streak and guess distribution.</li>
            </ul>
            <p>Guesses must be real words from the game's dictionary. The on-screen keyboard shows which letters you have used and their best-known state.</p>
            <div class="note"><b>Leaderboard:</b> the shared Wordle board ranks cumulative daily wins. Stats sync to your account, but an in-progress Daily or Unlimited board stays on the device.</div>
        `
    },
    {
        id: 'spellbound',
        cat: 'games',
        title: 'Spelling Bee',
        summary: 'Make words from seven letters, always using the centre letter.',
        tags: 'spelling bee pangram seven letters daily unlimited genius queen bee words',
        sub: 'Word games',
        appHref: 'spellbound',
        appName: 'Spelling Bee',
        related: ['wordle', 'anagrams', 'wordsearch'],
        body: `
            <p>Spelling Bee gives you seven letters arranged around a centre letter. Find as many valid words as you can.</p>
            <h2>Rules</h2>
            <ul>
                <li>Every word must use the centre letter.</li>
                <li>Words must be at least four letters long.</li>
                <li>Letters can be reused.</li>
                <li>A word that uses all seven letters is a <b>pangram</b> and scores a bonus.</li>
            </ul>
            <h2>Playing</h2>
            <ol>
                <li>Tap letters on the on-screen keyboard.</li>
                <li>Press Enter to submit. Valid words are added to your list and score.</li>
                <li>Use Shuffle to rearrange the outer letters if you are stuck.</li>
                <li>Delete removes the current input.</li>
            </ol>
            <p><b>Daily</b> gives one shared puzzle; <b>Unlimited</b> generates new puzzles. Stats track games played, words found, "Genius" rank and "Queen Bee" (all words found). Progress syncs for signed-in players, and the leaderboard ranks lifetime words found.</p>
            <div class="note"><b>Tip:</b> look for common prefixes and suffixes, then check whether each can be built. Pangrams often use every letter exactly once - hunting for one early can unlock the board.</div>
        `
    },
    {
        id: 'bindings',
        cat: 'games',
        title: 'Connections',
        summary: 'Group sixteen words into four hidden categories with four mistakes allowed.',
        tags: 'connections bindings groups categories words puzzle mistakes shuffle',
        sub: 'Word games',
        appHref: 'bindings',
        appName: 'Connections',
        related: ['strands', 'wordle', 'crossword'],
        body: `
            <p>Connections (the page file is still <code>bindings.html</code>) shows sixteen words. Your job is to find four groups of four that share something in common.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap four words you think belong together.</li>
                <li>Tap <b>Submit</b>. A correct group locks in with its category name.</li>
                <li>An incorrect group costs one of your four mistakes.</li>
                <li>Use <b>Shuffle</b> to rearrange the board and <b>Deselect</b> to clear your picks.</li>
                <li>Find all four groups before you run out of mistakes.</li>
            </ol>
            <p>Categories can be anything: synonyms, things with a shared prefix, members of a set, wordplay. The hardest part is usually spotting the group that is <i>almost</i> right but has one word belonging elsewhere.</p>
            <div class="note"><b>Strategy:</b> solve the most obvious group first, then look for categories with exactly four members. If two words feel like a pair, they may be a trap with a third that fits a different group.</div>
        `
    },
    {
        id: 'strands',
        cat: 'games',
        title: 'Strands',
        summary: 'Trace hidden theme words through a letter grid, including the edge-to-edge spangram.',
        tags: 'strands word search theme spangram daily unlimited hint letters grid',
        sub: 'Word games',
        appHref: 'strands',
        appName: 'Strands',
        related: ['wordsearch', 'bindings', 'spellbound'],
        body: `
            <p>Strands is a themed word search. Every word relates to a daily theme, and one special word - the <b>spangram</b> - describes the theme and stretches from one side of the grid to the other.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap letters one at a time to build a word; each letter must touch the previous one, including diagonals.</li>
                <li>Tap the last letter again or press <b>Submit</b>. Correct theme words stay highlighted.</li>
                <li>The theme clue is shown from the start. The <b>spangram</b> is the theme's answer and must touch opposite edges of the grid.</li>
                <li>Fill every letter on the board by finding all words.</li>
            </ol>
            <p><b>Daily</b> is one shared puzzle; <b>Unlimited</b> generates new ones. <b>Hint</b> reveals one letter of an unfound theme word: find three non-theme words to earn one. <b>Clear</b> resets the current selection.</p>
            <div class="note"><b>Strategy:</b> hunt for the spangram first. Once the theme clicks, the remaining words are much easier to spot. Every letter is used exactly once when the puzzle is solved, so process of elimination helps.</div>
        `
    },
    {
        id: 'crossword',
        cat: 'games',
        title: 'Crossword',
        summary: 'Solve a random crossword from the archive, with check and solve helpers.',
        tags: 'crossword puzzle across down clues archive grid check solve',
        sub: 'Word games',
        appHref: 'crossword',
        appName: 'Crossword',
        related: ['mini-crossword', 'wordsearch', 'wordle'],
        body: `
            <p>Crossword loads a full-size puzzle from a public crossword archive. Each new game picks another puzzle, so you can keep going after finishing one.</p>
            <h2>Solving</h2>
            <ol>
                <li>Open the app; it fetches a puzzle and fills the grid.</li>
                <li>Tap a square or a clue to select a word.</li>
                <li>Type letters; the cursor advances across or down depending on the selected clue.</li>
                <li>Use the across/down clue lists to jump between words.</li>
                <li><b>Check</b> reports errors in the clue bar; <b>Solve</b> fills the selected word.</li>
            </ol>
            <p>Progress autosaves on the device and, when signed in, to your account. Starting a new puzzle discards the old one after a confirmation.</p>
            <div class="note"><b>Archive note:</b> puzzles are fetched from an online archive through a proxy. If loading fails, the archive or proxy is temporarily unavailable; try again later. Answers can contain dated references and older spellings.</div>
        `
    },
    {
        id: 'mini-crossword',
        cat: 'games',
        title: 'Mini Crossword',
        summary: 'A quick five-by-five crossword from a bundled puzzle set.',
        tags: 'mini crossword small puzzle daily quick across down check',
        sub: 'Word games',
        appHref: 'mini',
        appName: 'Mini Crossword',
        related: ['crossword', 'wordle'],
        body: `
            <p>Mini Crossword is a small crossword for a short break. The puzzles ship with the app, so no archive request is needed.</p>
            <h2>Playing</h2>
            <ol>
                <li>Open the app to get a random mini puzzle.</li>
                <li>Tap a square or clue, then type. The grid moves automatically.</li>
                <li><b>Check</b> tells you whether the grid is correct; <b>Solve</b> fills the selected word.</li>
                <li>Tap <b>New</b> for another puzzle; your current progress is discarded after confirmation.</li>
            </ol>
            <p>Across and Down clues are listed side by side. The selected clue is highlighted as you move through the grid. Progress saves on the device and, when signed in, to your account.</p>
            <div class="note"><b>Good for e-ink:</b> a small grid means fewer refreshes than a full crossword. It is one of the quickest games to play on a slow screen.</div>
        `
    },
    {
        id: 'anagrams',
        cat: 'games',
        title: 'Anagrams',
        summary: 'Unscramble a word using the on-screen keyboard; every solved word is worth 10 points.',
        tags: 'anagrams unscramble letters word puzzle keyboard score give up',
        sub: 'Word games',
        appHref: 'anagrams',
        appName: 'Anagrams',
        related: ['wordle', 'spellbound', 'wordsearch'],
        body: `
            <p>Anagrams shows a scrambled word. Rearrange the letters and type the original word.</p>
            <h2>How to play</h2>
            <ol>
                <li>Read the scrambled letters at the top.</li>
                <li>Tap letters on the on-screen keyboard.</li>
                <li>Press Enter to check. A correct answer scores 10 points and loads the next word.</li>
                <li>Backspace removes a letter. <b>Give Up</b> reveals the answer.</li>
            </ol>
            <p>There is no timer, so you can take as long as you like. The challenge is the anagram itself. Longer words are not worth more points in the current scoring - every solved word is +10 - but they are harder to unscramble.</p>
            <div class="note"><b>Tip:</b> look for common endings (-ing, -tion, -ed) and vowel patterns first. If the word is a plural, the trailing S gives it away.</div>
        `
    },
    {
        id: 'hangman',
        cat: 'games',
        title: 'Hangman',
        summary: 'Guess the hidden word one letter at a time before the drawing is complete.',
        tags: 'hangman word guessing letters classic',
        sub: 'Word games',
        appHref: 'hangman',
        appName: 'Hangman',
        related: ['wordle', 'anagrams'],
        body: `
            <p>Hangman picks a hidden word. Guess letters; each correct letter is revealed, and each wrong letter adds a stroke to the drawing.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap a letter on the keyboard.</li>
                <li>Correct letters appear in their positions in the word.</li>
                <li>Wrong letters dim on the keyboard and add a stroke to the drawing.</li>
                <li>Guess the word before six wrong letters are used.</li>
                <li>Tap <b>New Game</b> for another word.</li>
            </ol>
            <p>Start with common letters (E, T, A, O, I, N, S, R) and use the word length and revealed pattern to narrow things down.</p>
            <div class="note"><b>No penalties for thinking:</b> there is no timer. The only cost is a wrong letter.</div>
        `
    },
    {
        id: 'wordsearch',
        cat: 'games',
        title: 'Word Search',
        summary: 'Find hidden words in a letter grid in any direction.',
        tags: 'word search grid hidden words horizontal vertical diagonal',
        sub: 'Word games',
        appHref: 'wordsearch',
        appName: 'Word Search',
        related: ['strands', 'crossword'],
        body: `
            <p>Word Search hides a list of words in a grid. Words can run horizontally, vertically or diagonally, forwards or backwards.</p>
            <h2>How to play</h2>
            <ol>
                <li>Look at the word list below the grid.</li>
                <li>Tap the first letter of a word, then tap its last letter. The line between them is selected.</li>
                <li>If the selection matches a word, it is crossed off the list.</li>
                <li>Find every word to complete the puzzle. <b>Reset</b> starts a new grid.</li>
            </ol>
            <div class="note"><b>Tip:</b> scan for unusual first letters. Words with rare letters (Q, Z, X, J) are the easiest to spot and give you a direction to follow.</div>
        `
    },
    {
        id: 'nerdle',
        cat: 'games',
        title: 'Nerdle',
        summary: 'Guess a hidden maths equation in six tries.',
        tags: 'nerdle math equation numbers guessing six tries calculation',
        sub: 'Word games',
        appHref: 'nerdle',
        appName: 'Nerdle',
        related: ['wordle', 'calculator', 'sudoku'],
        body: `
            <p>Nerdle is Wordle for equations. Each guess must be a complete, valid calculation with one equals sign, such as <code>12+35=47</code>.</p>
            <h2>How to play</h2>
            <ol>
                <li>Type an equation using the number and operator keys.</li>
                <li>Press Enter. Both sides must be mathematically correct.</li>
                <li>Tiles show whether a character is in the right place, in the equation but in the wrong place, or not used.</li>
                <li>Solve it in six guesses.</li>
            </ol>
            <p>The equation length is fixed by the puzzle, so the grid tells you how many characters to use. <b>New</b> starts another equation after a confirmation.</p>
            <div class="note"><b>Strategy:</b> start with an equation that uses a spread of digits and operators. Remember that the order of operations matters - <code>1+2*3=7</code> is valid, <code>1+2*3=9</code> is not.</div>
        `
    },
    {
        id: 'sudoku',
        cat: 'games',
        title: 'Sudoku',
        summary: 'Fill a 9x9 grid so every row, column and box contains 1-9.',
        tags: 'sudoku numbers puzzle grid easy medium hard check solve',
        sub: 'Logic & puzzle',
        appHref: 'sudoku',
        appName: 'Sudoku',
        related: ['nonograms', 'nerdle', 'minesweeper'],
        body: `
            <p>Sudoku is the classic number-placement puzzle. Every row, column and 3x3 box must contain the digits 1-9 exactly once.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose New and pick a difficulty: Easy, Medium or Hard.</li>
                <li>Tap an empty square, then tap a number from 1-9.</li>
                <li>Given numbers are fixed and cannot be changed.</li>
                <li>A duplicate in the same row, column or box is invalid.</li>
                <li><b>Check</b> highlights mistakes; <b>Solve</b> fills the selected square.</li>
            </ol>
            <p>The game remembers your current puzzle, so you can leave and come back; signed-in progress syncs to your account. A completed grid shows a congratulations dialog.</p>
            <div class="note"><b>Solving tip:</b> start with the digit that appears most often. For each box, ask where that digit can legally go. Then repeat for rows and columns. On e-ink, use a finger and take your time - the grid is small but the targets are full squares.</div>
        `
    },
    {
        id: 'nonograms',
        cat: 'games',
        title: 'Nonograms',
        summary: 'Reveal a hidden picture from row and column number clues.',
        tags: 'nonograms picross logic puzzle grid numbers picture easy medium hard expert',
        sub: 'Logic & puzzle',
        appHref: 'nonograms',
        appName: 'Nonograms',
        related: ['sudoku', 'minesweeper'],
        body: `
            <p>Nonograms (also called Picross) is a logic puzzle. The numbers beside each row and column describe blocks of filled cells; solving the grid reveals a picture.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose a difficulty. The app fetches a puzzle of that size.</li>
                <li>Read a clue like <code>3 1</code> as "three filled cells, a gap, then one filled cell", in that order.</li>
                <li>Tap a cell to fill it. Use the X mode to mark a cell you know is empty.</li>
                <li>Use <b>Check</b> to see mistakes and <b>Clear</b> to restart the puzzle.</li>
                <li>Complete the grid to reveal the picture.</li>
            </ol>
            <p>There is no guessing required at the easier sizes, though the largest grids can be demanding. <b>Fill</b> and <b>X</b> are separate modes; switch between them as you work. Progress saves on the device and, when signed in, to your account.</p>
            <div class="note"><b>Starting move:</b> find a row whose clues fill the entire width, or a clue larger than half the line - its position is forced. Mark those cells, then work outward.</div>
        `
    },
    {
        id: 'minesweeper',
        cat: 'games',
        title: 'Minesweeper',
        summary: 'Clear a minefield using the numbers on safe squares.',
        tags: 'minesweeper mines flags logic grid difficulty classic',
        sub: 'Logic & puzzle',
        appHref: 'minesweeper',
        appName: 'Minesweeper',
        related: ['nonograms', 'sudoku', 'lightsout'],
        body: `
            <p>Minesweeper hides mines under a grid. Reveal every safe square without detonating one.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose a difficulty: Easy 10x10, Medium 18x14 or Hard 24x20.</li>
                <li>Tap a square to dig. A number tells you how many mines touch that square, including diagonals.</li>
                <li>Switch to flag mode and tap a square you believe is a mine.</li>
                <li>Clear every safe square to win. Tapping a mine ends the game.</li>
            </ol>
            <p>The header shows remaining mines and elapsed time. <b>New</b> starts a fresh board after a confirmation. Progress saves on the device and, when signed in, to your account.</p>
            <div class="note"><b>Logic, not luck:</b> most positions can be deduced. If two squares are ambiguous, look at the numbers on both sides of them. Guessing should be a last resort on the first click, which is always safe.</div>
        `
    },
    {
        id: 'memory',
        cat: 'games',
        title: 'Memory',
        summary: 'Flip cards to find matching pairs in as few moves as possible.',
        tags: 'memory matching pairs cards concentration moves',
        sub: 'Logic & puzzle',
        appHref: 'memory',
        appName: 'Memory',
        related: ['jigsaw', 'sudoku'],
        body: `
            <p>Memory is the card-matching game. Flip two cards at a time; a matching pair stays face up.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap a card to flip it, then tap a second card.</li>
                <li>If the faces match, the pair stays revealed.</li>
                <li>If not, both cards flip back after a short delay.</li>
                <li>Find every pair. The move counter tracks your efficiency; <b>Reset</b> starts a new board.</li>
            </ol>
            <div class="note"><b>Tip:</b> work systematically across the board and say the card positions to yourself. On e-ink, the flip-back delay is short; watch carefully before tapping the next pair.</div>
        `
    },
    {
        id: 'jigsaw',
        cat: 'games',
        title: 'Jigsaw',
        summary: 'Rebuild an image by swapping tiles, with a peek at the target.',
        tags: 'jigsaw puzzle tiles image swap 3x3 4x4 peek',
        sub: 'Logic & puzzle',
        appHref: 'jigsaw',
        appName: 'Jigsaw',
        related: ['memory', 'pixel'],
        body: `
            <p>Jigsaw scrambles an image into tiles. Swap tiles until the picture is restored.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose a 3x3 or 4x4 grid.</li>
                <li>Tap one tile, then another, to swap them.</li>
                <li>Use <b>Peek</b> to see the target image.</li>
                <li><b>New Art</b> generates a fresh picture.</li>
            </ol>
            <p>The 3x3 grid is a quick warm-up; 4x4 takes noticeably longer. There is no timer, but progress is not saved if you leave the page.</p>
            <div class="note"><b>Strategy:</b> solve the top row and left column first, then work inward. On a scrambled image, look for distinctive edges and colours rather than trying to place every tile at once.</div>
        `
    },
    {
        id: 'hanoi',
        cat: 'games',
        title: 'Tower of Hanoi',
        summary: 'Move a stack of discs to another peg in the minimum number of moves.',
        tags: 'tower hanoi discs pegs moves minimum puzzle scores',
        sub: 'Logic & puzzle',
        appHref: 'hanoi',
        appName: 'Tower of Hanoi',
        related: ['lightsout', 'sudoku'],
        body: `
            <p>Tower of Hanoi is a classic recursive puzzle. Move the whole stack from the left peg to the right peg.</p>
            <h2>Rules</h2>
            <ul>
                <li>Move one disc at a time.</li>
                <li>A larger disc can never sit on a smaller disc.</li>
                <li>Use the middle peg as temporary storage.</li>
            </ul>
            <h2>Playing</h2>
            <ol>
                <li>Choose 3, 4, 5, 6 or 7 discs.</li>
                <li>Tap a peg to pick up its top disc, then tap another peg to place it.</li>
                <li>Complete the stack to win. The move counter compares you to the minimum.</li>
                <li><b>Reset</b> restarts the puzzle; <b>Scores</b> shows the top results per disc count.</li>
            </ol>
            <p>The minimum number of moves is 2<sup>n</sup> - 1, so 3 discs need 7 moves and 7 discs need 127. The leaderboard ranks by fewest moves for each difficulty.</p>
        `
    },
    {
        id: 'lightsout',
        cat: 'games',
        title: 'Lights Out',
        summary: 'Switch every light off; each tap toggles a plus-shaped group.',
        tags: 'lights out puzzle toggle grid easy medium hard moves',
        sub: 'Logic & puzzle',
        appHref: 'lightsout',
        appName: 'Lights Out',
        related: ['minesweeper', 'nonograms'],
        body: `
            <p>Lights Out starts with some lights on. Tapping a light toggles it and its four direct neighbours (up, down, left, right). Turn them all off.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose Easy, Medium or Hard.</li>
                <li>Tap a cell. The cell and its orthogonal neighbours flip between on and off.</li>
                <li>Every tap changes up to five cells, so order matters.</li>
                <li>Clear the board to win. The move counter is your score.</li>
            </ol>
            <p><b>New Game</b> generates a solvable board. <b>Scores</b> shows the fewest moves for each difficulty. Because a board is solvable by construction, there is always a solution.</p>
            <div class="note"><b>Tip:</b> work from one corner. Tapping a cell twice cancels out, so a solution never needs the same cell twice. Fewer moves is better on the leaderboard.</div>
        `
    },
    {
        id: 'codebreaker',
        cat: 'games',
        title: 'Codebreaker',
        summary: 'Deduce a hidden number code from black and white peg feedback.',
        tags: 'codebreaker mastermind code pegs black white guesses easy medium hard',
        sub: 'Logic & puzzle',
        appHref: 'codebreaker',
        appName: 'Codebreaker',
        related: ['minesweeper', 'nerdle'],
        body: `
            <p>Codebreaker is a Mastermind-style deduction game. A secret code of numbers is hidden; each guess gets feedback pegs.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose a difficulty: Easy (4 pegs, 6 numbers), Medium (4 pegs, 8 numbers) or Hard (5 pegs, 8 numbers).</li>
                <li>Pick a number for each position, then tap <b>Submit</b>.</li>
                <li>A <b>black</b> peg means a correct number in the correct position.</li>
                <li>A <b>white</b> peg means a correct number in the wrong position.</li>
                <li>Crack the code before your guesses run out: 10 on Easy, 12 on Medium and Hard.</li>
            </ol>
            <p>The code does not contain duplicate numbers, which makes deduction cleaner. <b>DEL</b> removes the last entry; the <b>?</b> button opens the rules panel.</p>
            <div class="note"><b>First guess:</b> use a spread of numbers to gather information. Then use the black/white counts to test one position at a time rather than guessing whole codes randomly.</div>
        `
    },
    {
        id: 'g2048',
        cat: 'games',
        title: '2048',
        summary: 'Slide and merge numbered tiles to reach 2048.',
        tags: '2048 numbers tiles slide merge puzzle score best',
        sub: 'Logic & puzzle',
        appHref: '2048',
        appName: '2048',
        related: ['sudoku', 'minesweeper'],
        body: `
            <p>2048 is a sliding-tile puzzle. Merge matching numbers to build larger ones, with the goal of creating a 2048 tile.</p>
            <h2>How to play</h2>
            <ol>
                <li>Use the on-screen arrows or the keyboard arrow keys to slide every tile in one direction.</li>
                <li>When two equal tiles touch, they merge into one tile worth double.</li>
                <li>A new 2 or 4 appears after every move.</li>
                <li>Build a 2048 tile for the goal; the game does not stop there. It ends only when the board is full and no merges are possible.</li>
            </ol>
            <p>The score is the sum of all merges. <b>Best</b> is your local high score. <b>Reset</b> starts a new game.</p>
            <div class="note"><b>Strategy:</b> pick one corner and keep your largest tile there. Avoid moving in the opposite direction unless you must, and keep a clear lane for merges.</div>
        `
    },
    {
        id: 'maze',
        cat: 'games',
        title: 'Maze',
        summary: 'Navigate a randomly generated maze to the exit.',
        tags: 'maze puzzle navigation arrows leaderboard completed',
        sub: 'Logic & puzzle',
        appHref: 'maze',
        appName: 'Maze',
        related: ['snake', 'g2048'],
        body: `
            <p>Maze puts you at one end of a generated maze. Find the exit.</p>
            <h2>How to play</h2>
            <ol>
                <li>Use the arrow buttons or the keyboard arrows to move.</li>
                <li>Reach the exit marker to win. The completed-maze counter increases.</li>
                <li><b>New</b> generates a fresh maze; <b>Leaderboard</b> shows top results.</li>
            </ol>
            <p>There is no timer or move limit. The leaderboard rewards completed mazes, so steady exploration is fine.</p>
            <div class="note"><b>Technique:</b> pick a wall and follow it consistently. This "wall follower" method eventually reaches the exit in a simply connected maze, even if it takes a long route.</div>
        `
    },
    {
        id: 'circle',
        cat: 'games',
        title: 'Perfect Circle',
        summary: 'Draw a circle as close to perfect as you can and see your accuracy score.',
        tags: 'perfect circle draw accuracy score leaderboard',
        sub: 'Logic & puzzle',
        appHref: 'circle',
        appName: 'Perfect Circle',
        related: ['napkin', 'pixel'],
        body: `
            <p>Perfect Circle is a drawing challenge: draw the roundest circle you can in one stroke.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap <b>Start</b>.</li>
                <li>Draw a circle on the canvas in one continuous stroke.</li>
                <li>Release. The app scores how close your shape is to a perfect circle, with a percentage.</li>
                <li>Tap Retry to try again; <b>Top Circles</b> shows the leaderboard.</li>
            </ol>
            <p>Device scaling is disabled for this game so the drawing coordinates match your finger exactly. That makes it one of the few apps where zoom is intentionally off.</p>
            <div class="note"><b>Tip:</b> draw slowly and use a smooth, single motion. A small circle is easier to keep round than a large one; start with a size you can complete comfortably.</div>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([

    {
        id: 'solitaire',
        cat: 'games',
        title: 'Solitaire',
        summary: 'Classic Klondike solitaire, scored by the fewest moves.',
        tags: 'solitaire klondike cards patience foundations tableau stock moves leaderboard',
        sub: 'Cards & board',
        appHref: 'solitaire',
        appName: 'Solitaire',
        related: ['blackjack', 'texasholdem', 'yahtzee'],
        body: `
            <p>Solitaire is Klondike patience: build the four suits from Ace to King on the foundations.</p>
            <h2>How to play</h2>
            <ul>
                <li>Build tableau columns downward in alternating colours (red on black, black on red).</li>
                <li>Only a King can be placed in an empty column.</li>
                <li>Tap the stock to draw a new card; when it runs out, the waste is recycled back into the stock.</li>
                <li>Move Aces to the foundations first, then build each suit upward.</li>
                <li>Reveal every face-down card and complete all four foundations to win.</li>
            </ul>
            <p>The move counter rewards efficiency. <b>New</b> deals a fresh game; <b>Finish</b> auto-completes the remaining legal moves once the outcome is decided. The leaderboard ranks completed games by fewest moves.</p>
            <div class="note"><b>Tip:</b> expose face-down cards early. A move that reveals a hidden card is usually worth more than a tidy-looking stack.</div>
        `
    },
    {
        id: 'blackjack',
        cat: 'games',
        title: 'Blackjack',
        summary: 'Beat the dealer to 21 without going bust, with a persistent bankroll.',
        tags: 'blackjack cards casino dealer hit stand double bet bank 21',
        sub: 'Cards & board',
        appHref: 'blackjack',
        appName: 'Blackjack',
        related: ['texasholdem', 'solitaire', 'yahtzee'],
        body: `
            <p>Blackjack is you against the dealer. Get closer to 21 than the dealer without going over.</p>
            <h2>Rules</h2>
            <ul>
                <li>Number cards are face value; face cards are 10; Aces are 1 or 11.</li>
                <li><b>Hit</b> takes another card. <b>Stand</b> keeps your hand.</li>
                <li><b>Double</b> doubles the bet and deals exactly one more card.</li>
                <li>Over 21 is a bust and loses the hand.</li>
                <li>The dealer draws to 16 and stands on 17.</li>
            </ul>
            <h2>Playing</h2>
            <ol>
                <li>Choose a bet ($10, $50 or $100) from your bank.</li>
                <li>Tap <b>Deal</b> (or the equivalent start control).</li>
                <li>Hit, stand or double as the hand develops.</li>
                <li>When the round ends, tap <b>New Round</b>.</li>
            </ol>
            <p>Your bank starts at $1,000 and persists between sessions. There is no split or insurance in this version. If the bank reaches zero, reload the app: the next load tops it back up to $100 so you can keep playing. A new round alone does not.</p>
            <div class="note"><b>Basic strategy:</b> stand on 17+, hit on 11 or less, and double on 10 or 11 when the dealer shows a weak card. It is a game of odds, not guaranteed wins.</div>
        `
    },
    {
        id: 'texasholdem',
        cat: 'games',
        title: "Texas Hold'em",
        summary: 'A fixed-limit poker table against three bots, with a $1,000 bank.',
        tags: 'texas holdem poker cards bots fold check call raise pot bank',
        badges: ['BETA'],
        sub: 'Cards & board',
        appHref: 'texasholdem',
        appName: "Texas Hold'em",
        related: ['blackjack', 'solitaire'],
        body: `
            <p>Texas Hold'em is a poker table against three computer opponents. Each player starts with a $1,000 bank.</p>
            <h2>How a hand works</h2>
            <ol>
                <li>You and three bots receive two private cards.</li>
                <li>Five community cards are dealt in stages: the flop (3), the turn (1) and the river (1).</li>
                <li>Each betting round you can <b>Fold</b>, <b>Check</b>, <b>Call</b> or <b>Raise</b>. Raises are a fixed size (the current bet plus the big blind); there is no bet slider.</li>
                <li>Win by having the best five-card hand at showdown, or by making everyone else fold.</li>
            </ol>
            <h2>Hand rankings (best first)</h2>
            <p>Royal Flush, Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, Pair, High Card.</p>
            <div class="note"><b>Beta and unlisted:</b> this game is not shown on the home screen. Open it directly at <code>/texasholdem</code>. Bots are simple opponents; do not treat the table as a realistic poker trainer.</div>
            <p><b>Tip:</b> fold weak starting hands rather than chasing every pot. Position and patience matter more than bluffing against bots.</p>
        `
    },
    {
        id: 'yahtzee',
        cat: 'games',
        title: 'Yahtzee',
        summary: 'Roll five dice over thirteen rounds and fill every scoring category.',
        tags: 'yahtzee dice categories full house straight bonus cpu leaderboard live',
        sub: 'Cards & board',
        badges: ['1P', 'LIVE'],
        appHref: 'yahtzee',
        appName: 'Yahtzee',
        related: ['blackjack', 'uno', 'solitaire'],
        body: `
            <p>Yahtzee is a dice game of thirteen rounds. Each round you roll up to three times, holding dice between rolls, then score one category.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap <b>Roll</b> to roll five dice.</li>
                <li>Tap dice to hold them between rolls. Roll again up to three times total.</li>
                <li>Choose an empty category to score the roll: Ones through Sixes, Three/Four of a Kind, Full House, Small/Large Straight, Yahtzee or Chance.</li>
                <li>Every category can be used only once. A poor roll may force a zero somewhere.</li>
            </ol>
            <h2>Scoring</h2>
            <ul>
                <li>Upper section: the sum of matching dice. Score 63+ there for a 35-point bonus.</li>
                <li>Three/Four of a Kind: total of all dice if the pattern is met.</li>
                <li>Full House: 25 points. Small Straight: 30. Large Straight: 40.</li>
                <li>Yahtzee (five of a kind): 50 points.</li>
                <li>Chance: total of all dice.</li>
            </ul>
            <p>You play against a CPU opponent. <b>Scores</b> shows the leaderboard; the live version supports online matches.</p>
        `
    },
    {
        id: 'uno',
        cat: 'games',
        title: 'Uno',
        summary: 'Play Uno against three bots solo, or join an online match for two to ten players.',
        tags: 'uno cards pattern color number skip reverse draw wild solo bots online live stacking',
        sub: 'Cards & board',
        badges: ['1P', 'LIVE'],
        appHref: 'uno',
        appName: 'Uno',
        related: ['yahtzee', 'pool', 'game-modes'],
        body: `
            <p>Uno is the card game of numbers and four stripe-pattern suits (Vertical, Horizontal, Diag Up and Diag Down). The app has a solo match against three bots and a live online mode for two to ten players.</p>
            <h2>Rules</h2>
            <ul>
                <li>Play a card matching the top discard by pattern, number or symbol.</li>
                <li>If you cannot play, draw a card.</li>
                <li><b>Skip</b> skips the next player; <b>Reverse</b> changes direction; <b>Draw Two</b> makes the next player draw two.</li>
                <li><b>Wild</b> lets you choose the next pattern; <b>Wild Draw Four</b> does the same and makes the next player draw four.</li>
                <li>First player to empty their hand wins the round.</li>
            </ul>
            <h2>Modes</h2>
            <p><b>Play Solo vs Bots</b> starts a fixed four-player match immediately. <b>Play Online</b> opens the live lobby: the host sets the player count (2-10, four by default), bots and whether <b>Stacking</b> is on (with stacking, a +2 or +4 can be answered with another). The live game has turn timers and an AFK auto-skip so one idle player cannot stall the table.</p>
            <div class="note"><b>Tip:</b> save wild cards for moments when you cannot match, and watch the next player's card count - a Draw Two is most valuable when they are close to winning.</div>
        `
    },
    {
        id: 'chess',
        cat: 'games',
        title: 'Chess',
        summary: 'Play the computer at three difficulty levels, locally, or live online.',
        tags: 'chess ai difficulty white black undo stats local 2p live',
        badges: ['1P', '2P', 'LIVE'],
        sub: 'Cards & board',
        appHref: 'chess',
        appName: 'Chess',
        related: ['checkers', 'game-modes'],
        body: `
            <p>Chess uses the standard rules: checkmate the enemy king, and never leave your own king in check.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap a piece to see its legal moves.</li>
                <li>Tap a highlighted square to move. Captures work the same way.</li>
                <li>Pawns promote on the far rank; castling and en passant follow normal chess rules.</li>
                <li>New Game lets you play as White or Black and choose difficulty 1 (Easy), 2 (Normal) or 3 (Hard).</li>
                <li><b>Undo</b> takes back the last move. <b>Stats</b> shows wins, losses and draws.</li>
            </ol>
            <h2>Modes</h2>
            <ul>
                <li><b>Single</b> - against the computer at your chosen difficulty.</li>
                <li><b>Local (2P)</b> - two players on one device, taking turns.</li>
                <li><b>Live</b> - online matches with other ReKindle users.</li>
            </ul>
            <div class="note"><b>Difficulty:</b> higher levels search deeper and take longer to move. On a slow e-reader, Normal is a good balance; Hard can pause for a few seconds while it thinks.</div>
        `
    },
    {
        id: 'checkers',
        cat: 'games',
        title: 'Checkers',
        summary: 'Capture or block every enemy piece; kings can move backwards.',
        tags: 'checkers draughts ai easy medium hard undo stats local live kings',
        badges: ['1P', '2P', 'LIVE'],
        sub: 'Cards & board',
        appHref: 'checkers',
        appName: 'Checkers',
        related: ['chess', 'connect4', 'game-modes'],
        body: `
            <p>Checkers (draughts) is played on the dark squares. Capture all enemy pieces, or block them so they cannot move.</p>
            <h2>Rules</h2>
            <ul>
                <li>Pieces move diagonally forward one square.</li>
                <li>Capture by jumping over an adjacent enemy piece to the empty square beyond it.</li>
                <li>Jumps are mandatory when available, and multiple jumps can chain in one turn.</li>
                <li>Reaching the far row crowns a <b>King</b>, which can move and jump backwards.</li>
            </ul>
            <h2>Playing</h2>
            <p>Tap a piece, then tap a highlighted destination. Choose Easy, Medium or Hard for the computer; <b>Undo</b> takes back a move and <b>Stats</b> shows your record. Local and live versions follow the same rules.</p>
            <div class="note"><b>Tip:</b> protect your back row early. A piece that reaches the far side becomes a king and changes the game, so trading pieces carelessly can hand your opponent an advantage.</div>
        `
    },
    {
        id: 'connect4',
        cat: 'games',
        title: 'Connect 4',
        summary: 'Drop discs to line up four in a row against the computer or a friend.',
        tags: 'connect four discs columns line easy hard 4 5 local live',
        badges: ['1P', '2P', 'LIVE'],
        sub: 'Cards & board',
        appHref: 'connect4',
        appName: 'Connect 4',
        related: ['checkers', 'battleship', 'tictactoe'],
        body: `
            <p>Connect 4 is a drop-and-align game. Players alternate dropping discs into columns; the first to line up four wins.</p>
            <h2>How to play</h2>
            <ol>
                <li>Tap a column. Your disc falls to the lowest free slot.</li>
                <li>Connect four discs horizontally, vertically or diagonally to win.</li>
                <li>Choose Easy or Hard for the computer.</li>
                <li>Use <b>Mode: 4</b> to switch between four-in-a-row and five-in-a-row variants.</li>
                <li><b>Restart</b> clears the board.</li>
            </ol>
            <p>Local and live versions use the same board and rules. The hard AI looks several moves ahead and blocks obvious threats.</p>
            <div class="note"><b>Tip:</b> the centre column is the most powerful opening because it participates in the most potential lines. Watch for "double threats" where you create two ways to win at once.</div>
        `
    },
    {
        id: 'dotsandboxes',
        cat: 'games',
        title: 'Dots & Boxes',
        summary: 'Draw lines between dots and claim more boxes than your opponent.',
        tags: 'dots boxes lines squares claim turn extra local live easy hard',
        badges: ['1P', '2P', 'LIVE'],
        sub: 'Cards & board',
        appHref: 'dotsandboxes',
        appName: 'Dots & Boxes',
        related: ['connect4', 'tictactoe'],
        body: `
            <p>Dots &amp; Boxes is a pencil-and-paper classic. Players take turns drawing lines between adjacent dots; completing a box claims it.</p>
            <h2>Rules</h2>
            <ul>
                <li>On your turn, draw one line between two adjacent dots.</li>
                <li>Completing the fourth side of a box claims it and scores a point.</li>
                <li>Claiming a box gives you another turn, so boxes can be chained.</li>
                <li>When every line is drawn, the player with more boxes wins.</li>
            </ul>
            <h2>Playing</h2>
            <p>Tap a dot, then an adjacent dot, to draw a line. Choose Easy or Hard for the computer. Local and live versions follow the same rules.</p>
            <div class="note"><b>Strategy:</b> avoid drawing the third side of a box unless you are setting a trap. Late in the game, count the remaining chain lengths to decide whether to open a long chain or force your opponent to.</div>
        `
    },
    {
        id: 'battleship',
        cat: 'games',
        title: 'Battleship',
        summary: 'Place your fleet, then hunt and sink the enemy ships before yours go down.',
        tags: 'battleship ships grid fire hit miss auto rotate fleet cpu local',
        badges: ['1P', '2P'],
        sub: 'Cards & board',
        appHref: 'battleship',
        appName: 'Battleship',
        related: ['connect4', 'chess', 'game-modes'],
        body: `
            <p>Battleship is a hidden-information game. Each side places a fleet on a grid, then takes turns firing at squares.</p>
            <h2>Placing your fleet</h2>
            <ol>
                <li>Ships are placed in a fixed order (Carrier first); tap a grid square to place the current ship.</li>
                <li>Use <b>Rotate</b> to switch between horizontal and vertical.</li>
                <li>Use <b>Clear</b> to reset placement, or <b>Auto</b> to place the whole fleet randomly and start at once.</li>
                <li>The game starts automatically when the last ship is placed.</li>
            </ol>
            <h2>Firing</h2>
            <ul>
                <li>Tap a square on the enemy grid. A hit is marked; a miss is recorded.</li>
                <li>Keep firing around a hit to find the rest of that ship.</li>
                <li>A ship sinks when every square it occupies has been hit.</li>
                <li>Sink the whole enemy fleet to win.</li>
            </ul>
            <p>The CPU uses hunt/target logic: it searches until it hits, then focuses nearby squares. The local two-player version hides the screen between turns.</p>
            <div class="note"><b>Tip:</b> place long ships along the edges early, then vary the pattern. A predictable fleet is easy for the CPU to finish off.</div>
        `
    },
    {
        id: 'tictactoe',
        cat: 'games',
        title: 'Tic-Tac-Toe',
        summary: 'The classic three-in-a-row game, with an easy or unbeatable hard AI.',
        tags: 'tic tac toe noughts crosses easy hard minimax local live',
        badges: ['1P', '2P', 'LIVE'],
        sub: 'Cards & board',
        appHref: 'tictactoe',
        appName: 'Tic-Tac-Toe',
        related: ['connect4', 'checkers'],
        body: `
            <p>Tic-Tac-Toe needs no introduction: place X or O on a 3x3 grid and be first to get three in a row.</p>
            <h2>Playing</h2>
            <ol>
                <li>Choose <b>Easy</b> or <b>Hard</b>.</li>
                <li>Tap an empty square to place your mark.</li>
                <li>The computer replies. Three in a row wins; a full board is a draw.</li>
                <li><b>Reset</b> starts a new round.</li>
            </ol>
            <p>Easy plays randomly. Hard uses minimax, so it cannot be beaten - the best a human can achieve is a draw. Local and live versions use the same rules against another person.</p>
            <div class="note"><b>Beat the easy AI:</b> take the centre, then create two threats at once. Against perfect play, a draw is the correct result.</div>
        `
    },
    {
        id: 'pool',
        cat: 'games',
        title: '8 Ball (pool)',
        summary: 'Aim, shoot and pocket your balls before the 8-ball, solo or local two-player.',
        tags: 'pool 8 ball billiards aim shoot solids stripes scratch cue local',
        badges: ['1P', '2P'],
        sub: 'Cards & board',
        appHref: 'pool',
        appName: '8 Ball',
        related: ['battleship', 'uno'],
        body: `
            <p>8 Ball is a top-down pool game. Pocket your seven balls (solids or stripes), then legally pot the black 8-ball to win.</p>
            <h2>Playing</h2>
            <ol>
                <li>Choose Easy, Medium or Hard for the opponent, or play the local two-player version.</li>
                <li>Drag from the cue ball to aim; the longer the drag, the harder the shot. Release to shoot.</li>
                <li>After the break, the first ball potted decides who has solids and who has stripes.</li>
                <li>Pocket all of your balls, then pot the 8-ball.</li>
            </ol>
            <h2>Fouls</h2>
            <ul>
                <li>Pocketing the cue ball (a scratch) re-spots it and ends your turn.</li>
                <li>Pocketing the 8-ball before clearing your group loses the game.</li>
            </ul>
            <div class="note"><b>Controls:</b> page zoom is disabled for pool so touch coordinates stay accurate. Use slow, deliberate drags; e-ink cannot show a smooth aiming preview in real time.</div>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([

    {
        id: 'snake',
        cat: 'games',
        title: 'Snake',
        summary: 'Eat, grow longer and avoid your own tail in the arcade classic.',
        tags: 'snake arcade eat grow tail arrows high score leaderboard',
        sub: 'Action & arcade',
        appHref: 'snake',
        appName: 'Snake',
        related: ['pacman', 'tetris', 'dino'],
        body: `
            <p>Snake is the arcade classic: guide a growing snake to food without hitting a wall or your own tail.</p>
            <h2>How to play</h2>
            <ul>
                <li>Use the arrow buttons or the keyboard arrows to change direction.</li>
                <li>Eat the food to grow and score points.</li>
                <li>The pace is fixed; the run ends when you hit a wall or your own tail.</li>
                <li>Hitting a wall or yourself ends the run.</li>
            </ul>
            <p>Your high score is shown in the header. <b>Leaderboard</b> opens the shared top scores; <b>Retry</b> starts again after a game over.</p>
            <div class="note"><b>Tip:</b> stay away from the edges - touching a wall ends the run - and avoid doubling back into your body when the tail is close.</div>
        `
    },
    {
        id: 'tetris',
        cat: 'games',
        title: 'Tetris (Blocks)',
        summary: 'Rotate and drop falling blocks to clear lines and score.',
        tags: 'tetris blocks falling pieces rotate drop lines score leaderboard',
        sub: 'Action & arcade',
        appHref: 'tetris',
        appName: 'Tetris',
        related: ['snake', 'blockblast', 'pacman'],
        body: `
            <p>Tetris - labelled <b>Blocks</b> in the title bar - is the falling-block puzzle. Complete horizontal lines to clear them and keep the stack from reaching the top.</p>
            <h2>Controls</h2>
            <ul>
                <li><b>Left / Right</b> move the piece.</li>
                <li><b>Rotate</b> (the circular arrow) turns the piece.</li>
                <li><b>Drop</b> sends it down faster.</li>
            </ul>
            <h2>Scoring</h2>
            <p>Clearing more lines at once scores more. The game ends when a new piece cannot enter the board. The high score is shown in the header; <b>Leaderboard</b> shows the shared board and <b>Retry</b> starts a new run.</p>
            <div class="note"><b>Tip:</b> leave a vertical well for the long bar and keep the surface flat. Clearing one line repeatedly is safer than stacking high for a big combo.</div>
        `
    },
    {
        id: 'pacman',
        cat: 'games',
        title: 'Pac-Man',
        summary: 'Eat every dot, dodge four ghosts and use power pellets to turn the tables.',
        tags: 'pacman arcade ghosts dots power pellet lives score leaderboard',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'pacman',
        appName: 'Pac-Man',
        related: ['snake', 'maze', 'tetris'],
        body: `
            <p>Pac-Man is the maze arcade game. Clear the dots while avoiding ghosts; power pellets briefly let you eat them.</p>
            <h2>How to play</h2>
            <ul>
                <li>Use the arrow buttons or keyboard arrows to move through the maze.</li>
                <li>Eat all the dots to clear the level.</li>
                <li>A power pellet turns the ghosts blue for a short time - touch them to send them home.</li>
                <li>You start with three lives. Touching a normal ghost costs one.</li>
            </ul>
            <p>The header shows score, high score and lives. <b>Leaderboard</b> opens the shared board; <b>Retry</b> starts again after a game over.</p>
            <div class="note"><b>Tip:</b> learn the ghost patterns. Turning a corner at the last moment breaks their pursuit better than running in a straight line. Save power pellets for when a ghost is close.</div>
        `
    },
    {
        id: 'dino',
        cat: 'games',
        title: 'Dino',
        summary: 'Jump the cacti in a one-button endless runner.',
        tags: 'dino runner jump cactus endless high score leaderboard',
        sub: 'Action & arcade',
        appHref: 'dino',
        appName: 'Dino',
        related: ['crossy', 'surfer', 'snake'],
        body: `
            <p>Dino is the familiar offline-runner: a dinosaur runs automatically, and you jump over obstacles as the speed increases.</p>
            <h2>How to play</h2>
            <ul>
                <li>Tap the screen or press Space/Up to jump.</li>
                <li>Avoid the cacti.</li>
                <li>The longer you survive, the faster it gets.</li>
                <li>One collision ends the run.</li>
            </ul>
            <p>Score and HI (high score) are drawn in the game canvas. <b>Leaderboard</b> shows the shared board; tap the screen or press Space to start again after a collision.</p>
            <div class="note"><b>Timing:</b> on e-ink the frame rate is low, so jump a little earlier than feels natural. Keep taps short - holding does not give a higher jump.</div>
        `
    },
    {
        id: 'crossy',
        cat: 'games',
        title: 'Crossy',
        summary: 'Cross roads and rivers without getting hit or falling in.',
        tags: 'crossy road hopper traffic river logs arrows score leaderboard',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'crossy',
        appName: 'Crossy',
        related: ['dino', 'surfer', 'jumpy'],
        body: `
            <p>Crossy is a lane-hopping game. Move forward across busy roads and rivers; one wrong step ends the run.</p>
            <h2>How to play</h2>
            <ul>
                <li>Use the arrow buttons or keyboard arrows to hop one lane at a time.</li>
                <li>Cars and trucks run along the roads. Time your crossings.</li>
                <li>On rivers, ride the logs and avoid the water.</li>
                <li>Score increases with each lane crossed.</li>
            </ul>
            <p>The header shows score and high score. <b>Leaderboard</b> opens the shared top scores; <b>Retry</b> starts a new run after a crash.</p>
            <div class="note"><b>Tip:</b> do not rush. Waiting at the edge of a road costs nothing, while a blind hop often ends the run. Use short taps, not held directions.</div>
        `
    },
    {
        id: 'surfer',
        cat: 'games',
        title: 'Surfer',
        summary: 'A three-lane endless runner: dodge trains, jump barriers and roll under signs.',
        tags: 'surfer runner lanes trains barriers signs coins jump roll swipe leaderboard',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'surfer',
        appName: 'Surfer',
        related: ['crossy', 'cubedash', 'dino'],
        body: `
            <p>Surfer is a three-lane runner. You move between lanes, jump low barriers, roll under overhead signs and collect coins.</p>
            <h2>Controls</h2>
            <ul>
                <li><b>Left / Right</b> - change lane (arrows, on-screen buttons or swipe).</li>
                <li><b>Up</b> - jump over a barrier.</li>
                <li><b>Down</b> - roll under a sign.</li>
                <li>Trains can only be avoided by changing lanes.</li>
            </ul>
            <p>Speed increases with distance; obstacle spacing is tuned so there is always a safe line. Coins add to your score. <b>Leaderboard</b> shows the shared board; <b>Retry</b> starts again after a crash.</p>
            <div class="note"><b>E-ink tip:</b> the renderer is deliberately one-bit black and white to avoid constant full-screen refreshes. Inputs register instantly, but wait for the screen before planning the next lane change.</div>
        `
    },
    {
        id: 'cubedash',
        cat: 'games',
        title: 'Cube Dash',
        summary: 'A ten-level one-button platformer with cube and ship modes and collectible gears.',
        tags: 'cube dash geometry platformer levels ship cube jump gears spikes one button',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'cubedash',
        appName: 'Cube Dash',
        related: ['surfer', 'jumpy', 'dino'],
        body: `
            <p>Cube Dash is an original one-button platformer. You run automatically; tap to jump, and hold to fly when you enter ship mode. There are ten levels, each with collectible gears.</p>
            <h2>Controls</h2>
            <ul>
                <li><b>Tap</b> or <b>Space</b> - jump (hold to keep hopping).</li>
                <li><b>Hold</b> in ship sections - thrust upward; release to descend.</li>
                <li><b>Pause</b> - the II button; resume, restart or quit to the menu.</li>
            </ul>
            <h2>Progress</h2>
            <p>The level menu shows your best percentage per level and your gear count. Portals switch between cube and ship modes. Spikes, blocks and pillars kill on contact; pads bounce you upward and rings launch you. Reach the end gate to complete a level.</p>
            <div class="note"><b>No settings:</b> rendering is forced to a strict one-bit mode because grey anti-aliased pixels cause constant e-ink full refreshes. The tight jump windows are intentional. If a level feels impossible, watch the pattern and jump earlier than you think.</div>
        `
    },
    {
        id: 'cookieclicker',
        cat: 'games',
        title: 'Cookie Clicker',
        summary: 'Tap the big cookie, buy buildings and upgrades, and let the cookies pile up.',
        tags: 'cookie clicker idle incremental tycoon clicker buildings upgrades golden cookie save offline unlisted',
        sub: 'Action & arcade',
        appHref: 'cookieclicker',
        appName: 'Cookie Clicker',
        related: ['surfer', 'jumpy', 'cubedash'],
        body: `
            <p>Cookie Clicker is a quiet idle game built for e-ink. Tap the big cookie to bake; buildings then bake on their own while you read or play something else.</p>
            <div class="note"><b>Unlisted:</b> the home-screen icon is hidden for now while the game settles. It is still playable directly at <code>/cookieclicker</code>; open it from this guide or type the address.</div>
            <h2>Playing</h2>
            <ul>
                <li>Tap the cookie for cookies. Each tap is worth more after click upgrades.</li>
                <li><b>Buildings</b> produce cookies per second. Each one gets more expensive after you buy it.</li>
                <li><b>Upgrades</b> unlock as you reach click, building and total-cookie milestones. They double a building, double your taps, or raise all production.</li>
                <li>Every minute or two a <b>Golden cookie</b> may appear. Tap it for a bonus worth about 10% of your current cookies.</li>
            </ul>
            <h2>Stimulation mode</h2>
            <p>The <b>Stimulation</b> tab is a short, run-based parody of Neal.fun's <i>Stimulation Clicker</i>. Click the big button to earn stimulation, then buy stimuli: a DVD logo, a podcast, autoplay video, an algorithm and so on. Active stimuli generate points while a text feed fills with their noise. Activate all ten to reach the beach.</p>
            <p>This mode is deliberately original and silent: no audio, video or animation, just text and the same once-a-second update as the cookie game. A run lasts about ten minutes, is not saved, and resets when the page reloads. Your best run is kept on the device. Boosts double one stimulus permanently for the rest of the run.</p>
            <h2>Saving</h2>
            <p>The cookie game saves on this device automatically. When you are signed in it also syncs to <code>users/&lt;uid&gt;/settings/cookieSave</code>, so your cookies follow your account. Offline production is capped at eight hours and pays half the normal rate. <b>Reset</b> clears both the local and cloud save.</p>
            <div class="note"><b>No leaderboard:</b> idle games can be edited offline, so a shared score would not be meaningful. Progress is personal. The page avoids animation and only redraws the numbers once a second to keep e-ink refreshes down.</div>
        `
    },
    {
        id: 'jumpy',
        cat: 'games',
        title: 'Jumpy',
        summary: 'Bounce upward on platforms, dodging gaps and moving ledges.',
        tags: 'jumpy doodle jump platformer bounce platforms high score leaderboard unlisted',
        sub: 'Action & arcade',
        appHref: 'jumpy',
        appName: 'Jumpy',
        related: ['cubedash', 'crossy', 'dino'],
        body: `
            <p>Jumpy is a vertical platformer in the Doodle Jump style. Your character bounces automatically; you steer left and right to land on the next platform.</p>
            <h2>Controls</h2>
            <ul>
                <li>Hold the <b>left</b> or <b>right</b> button, use the arrow keys/A-D, or touch the left/right half of the canvas.</li>
                <li>Land on a platform to bounce. Some platforms break, some move, and some launch you higher.</li>
                <li>Falling off the bottom ends the run.</li>
            </ul>
            <p>Score increases with height. The local high score is kept on the device and the shared <b>Leaderboard</b> shows top jumpers.</p>
            <div class="note"><b>Unlisted:</b> Jumpy is playable and has a leaderboard, but it is not currently shown on the home screen. Open it directly at <code>/jumpy</code>. Its movement speed is tuned for e-ink; do not expect desktop-game responsiveness.</div>
        `
    },
    {
        id: 'mario',
        cat: 'games',
        title: 'Mario',
        summary: 'An auto-running platformer: jump, stomp enemies and collect coins to the flag.',
        tags: 'mario platformer auto run jump coins distance time leaderboard',
        sub: 'Action & arcade',
        appHref: 'mario',
        appName: 'Mario',
        related: ['crossy', 'cubedash'],
        body: `
            <p>Mario is an auto-running platformer. The character moves forward on his own; you control the jumps and timing.</p>
            <h2>Controls</h2>
            <ul>
                <li><b>A</b> - jump; hold it for a higher jump. There is no double jump.</li>
                <li><b>B</b> - run, and fire a fireball when powered up.</li>
                <li><b>Left / Right</b> - adjust movement; <b>Down</b> - duck while standing.</li>
                <li><b>Auto Run</b> toggles automatic forward movement.</li>
            </ul>
            <p>The HUD shows distance, coins and time. Reach the flag to complete the level; death restarts at the beginning of the level. The leaderboard has tabs for score, distance, coins and completion time.</p>
            <div class="note"><b>Tip:</b> coins are optional but count toward your score. Time is also ranked, so replay a level you know to improve your result rather than collecting every coin slowly.</div>
        `
    },
    {
        id: 'blockblast',
        cat: 'games',
        title: 'Block Blast',
        summary: 'Fit block shapes onto a grid and clear rows or columns for points.',
        tags: 'block blast blocks puzzle grid rows columns drag undo leaderboard',
        sub: 'Action & arcade',
        appHref: 'blockblast',
        appName: 'Block Blast',
        related: ['tetris', 'g2048', 'sudoku'],
        body: `
            <p>Block Blast gives you three block pieces at a time. Place them on the grid; complete horizontal or vertical lines to clear them.</p>
            <h2>How to play</h2>
            <ol>
                <li>Drag one of the three pieces onto the board.</li>
                <li>Fill a complete row or column to clear it and score.</li>
                <li>Clearing multiple lines at once earns a bonus.</li>
                <li>The game ends when none of the remaining pieces fit anywhere.</li>
                <li><b>Undo</b> takes back the last placement; <b>Reset</b> starts over.</li>
            </ol>
            <p>The score and best are shown in the header, and the leaderboard tracks top runs. Pieces cannot be rotated in this version, so plan around their given orientation.</p>
            <div class="note"><b>Tip:</b> keep the centre open for awkward shapes and avoid creating isolated single-cell gaps. A nearly full board with no legal piece is the usual way a run ends.</div>
        `
    },
    {
        id: 'pet',
        cat: 'games',
        title: 'Pet',
        summary: 'Raise a virtual pet through egg, child, teen and adult stages.',
        tags: 'pet virtual tamagotchi feed play clean evolve age leaderboard',
        sub: 'Action & arcade',
        appHref: 'pet',
        appName: 'Pet',
        related: ['oregontrail', 'trivia'],
        body: `
            <p>Pet is a pocket virtual pet. It hatches from an egg, grows through child and teen stages, and settles into one of five adult forms. How you care for it affects its mood and health.</p>
            <h2>Controls</h2>
            <p>Three buttons sit under the screen: <b>Select</b>, <b>Confirm</b> and <b>Cancel</b>. Use Select to move through the menu, Confirm to choose, and Cancel to go back. The canvas shows the pet and its needs.</p>
            <h2>Growing up</h2>
            <p>Feed, play with and clean up after your pet: neglect makes it unhappy and can make it ill. Age is measured in pet years and increases by one for every minute the page is open, so the leaderboard is an age board rather than a skill board. Stage changes run on fixed timers (egg to child after a minute, then teen and adult), and they catch up when you return; care does not make evolution faster.</p>
            <div class="note"><b>Long-term:</b> a hidden reset exists on the title text, but it erases the current pet - use it deliberately, not as an undo.</div>
        `
    },
    {
        id: 'trivia',
        cat: 'games',
        title: 'Trivia',
        summary: 'Ten-question quizzes with category, difficulty and type filters.',
        tags: 'trivia quiz questions categories difficulty true false multiple choice score stats leaderboard',
        sub: 'Action & arcade',
        appHref: 'trivia',
        appName: 'Trivia',
        related: ['akinator', 'history', 'wordle'],
        body: `
            <p>Trivia asks ten questions per game. You can filter by category, difficulty and type, or leave everything on "Any".</p>
            <h2>Playing</h2>
            <ol>
                <li>Choose a category, difficulty and type (multiple choice or true/false).</li>
                <li>Tap <b>Start Game</b>.</li>
                <li>Answer each question; the score updates as you go.</li>
                <li>At the end, review your score and tap Play Again. Stats stays available in the title bar.</li>
            </ol>
            <h2>Stats and leaderboard</h2>
            <p>Statistics cover all time, last year, last month and last week, with a performance history. The leaderboard ranks <b>average accuracy</b> over the selected period (All, Year, Month or Week), not a single-game high score - so one perfect game can top a quiet period.</p>
            <div class="note"><b>Tip:</b> start with the categories you know and a difficulty you can finish. The board rewards consistent accuracy, so a few strong games can lift your average quickly.</div>
        `
    },
    {
        id: 'akinator',
        cat: 'games',
        title: 'Akinator',
        summary: 'Think of a character, object or animal and let the genie guess it in twenty questions.',
        tags: 'akinator genie guess character object animal questions yes no probably region child mode',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'akinator',
        appName: 'Akinator',
        related: ['trivia', 'games-overview'],
        body: `
            <p>Akinator is the guessing genie. Think of a character (real or fictional), an object or an animal, and answer its questions. It tries to identify what you are thinking of.</p>
            <h2>How to play</h2>
            <ol>
                <li>Choose a region/language. The English list includes Characters, Objects and Animals, so pick the one that matches what you are thinking of.</li>
                <li>Turn on Child Mode if appropriate.</li>
                <li>Tap <b>Start Game</b>.</li>
                <li>Answer each question: Yes, No, Don't Know, Probably or Probably Not.</li>
                <li>After about twenty questions the genie makes a guess. Confirm it, or say no and keep going.</li>
            </ol>
            <p><b>Back</b> returns to the previous question if you misread one. The confidence meter shows how sure the genie is. A wrong first guess usually leads to more questions, not the end of the game.</p>
            <div class="note"><b>Network:</b> Akinator talks to the real Akinator service through ReKindle's relay. It needs a connection; if the session expires, the page resets to the start screen. Answer honestly - deliberately misleading answers make the genie wander.</div>
        `
    },
    {
        id: 'oregontrail',
        cat: 'games',
        title: 'Oregon Trail',
        summary: 'Lead five people 2,000 miles to Oregon in 1848, with limited supplies and a winter deadline.',
        tags: 'oregon trail history wagon survival travel hunting rivers forts winter score leaderboard',
        sub: 'Action & arcade',
        appHref: 'oregontrail',
        appName: 'Oregon Trail',
        related: ['games-overview', 'leaderboards', 'pet'],
        body: `
            <p>Oregon Trail is a survival management game. You lead a party of five from Independence, Missouri to the Willamette Valley, 2,000 miles away, starting in 1848.</p>
            <h2>Getting started</h2>
            <ol>
                <li>Choose a profession: Banker ($1,600, score x1), Carpenter ($800, x2) or Farmer ($400, x3).</li>
                <li>Name your five party members and choose a departure month: March, April, May or June.</li>
                <li>Buy oxen, food, ammunition, clothing and spare parts at the General Store. The storekeeper's advice is worth following.</li>
                <li>Begin the trail.</li>
            </ol>
            <h2>Each day</h2>
            <ul>
                <li><b>Travel</b> advances one day. Weather, terrain and ox fatigue change the distance covered.</li>
                <li><b>Pace</b> and <b>Rations</b> trade health and oxen condition for speed.</li>
                <li><b>Rest</b> heals the party and rests the oxen, but costs a day.</li>
                <li><b>Hunt</b> opens a shooting minigame to fill the larder.</li>
                <li><b>Trade</b> with passing emigrants for supplies or an ox.</li>
                <li>Repair the wagon with spare parts when it breaks.</li>
            </ul>
            <h2>Rivers, forts and winter</h2>
            <p>At rivers you can ford, caulk, ferry or wait; deeper water is more dangerous. Forts sell supplies at rising prices - the game calls Fort Laramie the last real fort before the mountains, but Fort Bridger, Fort Hall and Fort Boise still trade. Buy two sets of warm clothing per person and reach the mountains before the passes close around Christmas. A late start can still win, but the run ends on 26 December (day 360) if you are not through; the first warning comes on 1 November.</p>
            <h2>Scoring</h2>
            <p>Score combines survivors, party health, remaining supplies, cash and an early-arrival bonus, multiplied by your profession. Win by reaching Oregon. The leaderboard records completed journeys only.</p>
            <div class="note"><b>Save and resume:</b> progress is saved automatically. If you reload, use <b>New</b> only if you want to abandon the current run.</div>
        `
    },
    {
        id: 'car-games',
        cat: 'games',
        title: 'Car Games',
        summary: 'Ten pass-the-Kindle games for a car journey, with a saved crew of players.',
        tags: 'car games road trip travel pass the kindle crew cricket alphabet categories story bingo',
        sub: 'Action & arcade',
        badges: ['NEW'],
        appHref: 'cargames',
        appName: 'Car Games',
        related: ['games-overview', 'trivia', 'decide'],
        body: `
            <p>Car Games is a collection of ten low-tech games for a car journey. They are designed to be played aloud, passing one Kindle around.</p>
            <h2>The games</h2>
            <table>
                <tr><th>#</th><th>Game</th><th>What you do</th></tr>
                <tr><td>01</td><td>Car Cricket</td><td>Tap what you see; yellow cars are out.</td></tr>
                <tr><td>02</td><td>Alphabet Hunt</td><td>Spot every letter from A to Z.</td></tr>
                <tr><td>03</td><td>Categories</td><td>One letter, five headings - shout out answers.</td></tr>
                <tr><td>04</td><td>Keep It Going</td><td>Name one, then pass the Kindle on.</td></tr>
                <tr><td>05</td><td>Plate Words</td><td>Three letters in order, one word.</td></tr>
                <tr><td>06</td><td>Rhyme Time</td><td>Say a rhyme before the car moves on.</td></tr>
                <tr><td>07</td><td>Same Page</td><td>Count down, then compare answers.</td></tr>
                <tr><td>08</td><td>Spot Bingo</td><td>Five in a row from the car window.</td></tr>
                <tr><td>09</td><td>Story Chain</td><td>One line each, build a story together.</td></tr>
                <tr><td>10</td><td>Would You Rather</td><td>Two choices, one crew, no escape.</td></tr>
            </table>
            <h2>The crew</h2>
            <p>Add up to eight players. Names are saved on the device, and every pass-the-Kindle game uses the same crew, so you only set it up once. Choose a game card to see its rules and start.</p>
            <div class="note"><b>No network needed:</b> Car Games is a set of prompts, not an internet game. It is a good choice when the signal drops. The passenger holding the Kindle should be the scorekeeper.</div>
        `
    },
    {
        id: 'doom',
        cat: 'games',
        title: 'DOOM',
        summary: 'The classic shooter through a browser WebAssembly port, where the device supports it.',
        tags: 'doom fps shooter wasm webassembly controls kindle disabled',
        sub: 'Action & arcade',
        appHref: 'doom',
        appName: 'DOOM',
        related: ['games-overview', 'maze'],
        body: `
            <p>DOOM is a browser port of the original first-person shooter. It needs WebAssembly, a large game file and a reasonably capable browser, so it is the most demanding app in the arcade.</p>
            <h2>Controls</h2>
            <ul>
                <li>Arrow buttons or arrow keys - move and turn.</li>
                <li><b>FIRE</b> (Ctrl) - shoot.</li>
                <li><b>USE</b> (Space) - open doors and interact.</li>
                <li>Enter - confirm menu; Esc - menu/back.</li>
            </ul>
            <h2>Display options</h2>
            <p>The mode selector cycles four looks: <b>Color</b>, <b>Bayer 4x4</b>, <b>Bayer 8x8</b> and <b>Blue Noise</b> (the three monochrome modes suit e-ink). The + / - controls adjust contrast. The choice is per session, not saved.</p>
            <div class="note"><b>Device warning:</b> some Kindle firmware versions have WebAssembly disabled. If the game cannot start, ReKindle shows a message explaining that the device cannot run it. There is no workaround in the browser. DOOM is also heavy on battery and refresh; it is best on a tablet or desktop.</div>
        `
    },
    {
        id: 'words',
        cat: 'games',
        title: 'Words Online (Scrabble)',
        summary: 'An asynchronous Scrabble-style match against another ReKindle user.',
        tags: 'words scrabble online asynchronous tiles board recall mix forfeit unlisted',
        badges: ['BETA'],
        sub: 'Action & arcade',
        appHref: 'words',
        appName: 'Words Online',
        related: ['wordle', 'spellbound', 'game-modes'],
        body: `
            <p>Words Online is a two-player Scrabble-style board. It is asynchronous: you make a move, and your opponent can respond later.</p>
            <h2>Playing</h2>
            <ol>
                <li>Sign in and open Words. Tap <b>New</b> to search for an opponent.</li>
                <li>When a match is found, place tiles on the board to form words.</li>
                <li>Use <b>Recall</b> to take back tiles before submitting, and <b>Mix</b> to shuffle your rack.</li>
                <li>Tap <b>PLAY</b> to submit the word.</li>
                <li>Wait for your opponent's move; the board updates when they play.</li>
            </ol>
            <p>Scores, tile values and bonus squares follow Scrabble conventions, with +50 for playing all seven tiles. The board checks the line shape only: words are not dictionary-checked, and a word does not have to connect to existing tiles. Starting a new game forfeits the current one after a confirmation.</p>
            <div class="note"><b>Unlisted and beta:</b> this app is not shown on the home screen. Open it directly at <code>/words</code>. You must be logged in, and finding an opponent depends on someone else queueing at the same time.</div>
        `
    },
    {
        id: 'pictionary',
        cat: 'games',
        title: 'Pictionary (live)',
        summary: 'Draw a secret word while other players race to guess it.',
        tags: 'pictionary live drawing guessing words rounds online multiplayer',
        badges: ['LIVE'],
        sub: 'Action & arcade',
        appHref: 'livepictionary',
        appName: 'Pictionary',
        related: ['game-modes', 'pixel', 'napkin'],
        body: `
            <p>Pictionary is a live online drawing game. One player chooses from three secret words and draws one; everyone else types guesses.</p>
            <h2>How a round works</h2>
            <ol>
                <li>Join or create a live match and wait in the lobby.</li>
                <li>When it is your turn to draw, choose one of three words, then draw it without writing letters or numbers.</li>
                <li>Guessers type into the guess box. A correct guess scores points - faster and earlier guesses score more - and the drawer also earns 50 points per correct guess.</li>
                <li>Rounds rotate so everyone gets a turn to draw.</li>
            </ol>
            <p>The drawing canvas is deliberately simple and works with a finger or stylus. The game needs an account and a connection; there is no single-player version.</p>
            <div class="note"><b>Drawing tip:</b> start with the big shapes and the category, then add detail. On a slow e-ink screen, a clear silhouette beats a detailed picture. Guessing is faster on a physical keyboard if your device has one.</div>
        `
    },

    /* ------------------------------------------------------------------ */
    /* SETTINGS & HELP                                                     */
    /* ------------------------------------------------------------------ */

    {
        id: 'settings',
        cat: 'settings',
        title: 'Control Panel',
        summary: 'Every setting in one place: appearance, scaling, rotation, integrations, language and account.',
        tags: 'settings control panel appearance scale rotation wallpaper location language units games fullscreen integrations google caldav carddav password',
        appHref: 'settings',
        appName: 'Settings',
        related: ['display', 'accessibility', 'account', 'pro'],
        body: `
            <p>The Control Panel configures ReKindle. Open it from the top menu on the home screen. Changes usually apply immediately and are saved on the device; signed-in settings also sync to your account.</p>
            <h2>Desktop Pattern</h2>
            <p>Choose the wallpaper behind the app grid: presets, a custom pixel pattern, clear, invert or random. The pixel editor lets you draw a pattern and sets it as the background.</p>
            <h2>Appearance</h2>
            <ul>
                <li><b>Home Layout</b> - Modern (tabs) or Classic (sidebar). The classic layout loads the older dashboard and has fewer features; modern is recommended.</li>
                <li><b>Theme</b> - Light, Dark or Auto (Night). Auto switches to dark between 6pm and 6am using your saved timezone. Dark mode is marked BETA; bright themes usually show less ghosting on e-ink.</li>
            </ul>
            <h2>Scaling and display</h2>
            <p>Auto Scaling, Fixed Scale (50-200%), Display Mode and Screen Rotation each have their own trade-offs; see <a href="#display">Display, scaling and rotation</a> for when to use which.</p>
            <h2>Accessibility</h2>
            <p><b>OpenDyslexic Font</b> switches the interface to a dyslexia-friendly typeface. Text size in this Help app is adjusted with the A-/A+ buttons in the title bar.</p>
            <h2>Location, language and units</h2>
            <ul>
                <li><b>Manual Location</b> sets the city used for time, weather and language detection.</li>
                <li><b>Language</b> sets the interface language, or Auto to follow the location/browser.</li>
                <li><b>Measurement Units</b> sets Metric, Imperial or Auto for weather and distances.</li>
            </ul>
            <h2>Preferences and integrations</h2>
            <ul>
                <li><b>Disable Games</b> hides the Games and Multiplayer tabs.</li>
                <li><b>Default Fullscreen</b> opens supported apps in fullscreen mode.</li>
                <li><b>Google Tasks / Calendar / Contacts</b> connect via Google OAuth. <b>iCalendar (.ics)</b> and <b>CardDAV / vCard</b> accept read-only feed URLs.</li>
            </ul>
            <h2>Account</h2>
            <p>Change your password here, including the <b>Forgot your current password?</b> reset while you are signed in. <b>Delete Account</b> permanently removes the account and its data after you re-enter your password and type your username. ReKindle+ status and subscription management are also available from this area and the ReKindle+ page.</p>
        `
    },
    {
        id: 'display',
        cat: 'settings',
        title: 'Display, scaling and rotation',
        summary: 'Choose the right e-ink mode, zoom level and orientation for your device.',
        tags: 'display eink ghosting flash led mode scale zoom rotation landscape portrait fullscreen theme',
        related: ['settings', 'accessibility', 'input'],
        body: `
            <p>E-ink panels trade speed for readability. These settings make the trade-off on your device.</p>
            <h2>Display Mode</h2>
            <ul>
                <li><b>LED (No Flashes)</b> - uses partial refreshes. Navigation is faster and quieter, but text can ghost (leave faint traces).</li>
                <li><b>eInk (Anti-Ghosting)</b> - performs more full refreshes. The screen flashes more, but text and images are cleaner.</li>
            </ul>
            <p>Try eInk mode for reading long articles and LED mode for games and browsing. There is no "best" setting; it depends on your eyes and your panel.</p>
            <h2>Scaling</h2>
            <p><b>Auto Scaling</b> fits the interface to the screen. <b>Fixed Scale</b> lets you pick 50-200%. Larger values help with small text but push controls off-screen; smaller values show more content but make buttons harder to hit. Games that use a canvas disable page zoom so touch coordinates stay aligned.</p>
            <h2>Rotation</h2>
            <p>Portrait is the default. Landscape can help with crosswords, sheet music and wide tables. The 180-degree option is for devices whose native orientation is inverted. Rotation is marked beta because a few apps assume portrait dimensions.</p>
            <h2>Fullscreen</h2>
            <p>Many apps have a fullscreen control in the title bar. <b>Default Fullscreen</b> in Settings makes supported apps open that way, removing the desktop border for a little more reading area.</p>
            <div class="note"><b>Dark mode:</b> choose Dark or Auto (Night) under Settings - Theme. It is marked BETA and inverts the whole interface; on an e-ink panel, Light still refreshes less and ghosts less. Auto switches at 6pm and 6am using your saved timezone.</div>
        `
    },
    {
        id: 'accessibility',
        cat: 'settings',
        title: 'Accessibility',
        summary: 'Larger text, OpenDyslexic, display modes and practical tips for low vision or motor difficulty.',
        tags: 'accessibility font size dyslexia opendyslexic zoom contrast touch targets keyboard low vision',
        related: ['display', 'input', 'settings'],
        body: `
            <p>ReKindle runs on devices with small screens and imprecise touch. These options make it easier to use.</p>
            <h2>Text and fonts</h2>
            <ul>
                <li><b>OpenDyslexic Font</b> in Settings switches the interface to a dyslexia-friendly typeface.</li>
                <li><b>Fixed Scale</b> enlarges the whole interface, not just text.</li>
                <li>In this Help app, use <b>A- / A+</b> in the title bar to set article text from 13 to 22 pixels. The choice is remembered.</li>
                <li>Reader, RSS and News have their own A-/A+ controls for article text.</li>
            </ul>
            <h2>Contrast and ghosting</h2>
            <p>Use <b>eInk (Anti-Ghosting)</b> for the crispest text. If flashing is uncomfortable, use <b>LED (No Flashes)</b> and refresh manually when ghosting builds up (for example by opening the home screen).</p>
            <h2>Touch and motor access</h2>
            <ul>
                <li>Prefer the large on-screen buttons in games over tiny icons.</li>
                <li>Use the device in landscape for wider tap targets where an app supports it.</li>
                <li>On a device with a keyboard, Tab moves between controls and Enter activates buttons.</li>
                <li>Search in this Help app accepts partial words, so you do not need to spell an app name exactly.</li>
            </ul>
            <div class="note"><b>Something still hard to use?</b> Post it in <a href="#suggestions">Suggestions</a> with the app name and what would help. Accessibility feedback is treated as a product issue, not a nitpick.</div>
        `
    },
    {
        id: 'privacy',
        cat: 'settings',
        title: 'Privacy and your data',
        summary: 'What stays on the device, what goes to Firebase, and how third-party services are used.',
        tags: 'privacy data firebase google limited use third party cookies local storage delete account',
        related: ['storage', 'account', 'safety'],
        body: `
            <p>ReKindle is built to keep guest data on the device and to send only the minimum needed for cloud features. The full legal text is in the <a href="privacy.html">Privacy Policy</a>; this is the practical summary.</p>
            <h2>Guest mode</h2>
            <p>No account, no server record. Notes, tasks, games and settings live in browser storage on that device. Nothing is uploaded to ReKindle.</p>
            <h2>Cloud mode</h2>
            <p>When you sign in, supported app data is stored in Google Firebase (Firestore, Storage and Realtime Database) under your user ID. Security rules restrict each user to their own records. Social content is in ReKindle's social project; the owner-only moderation console can read reports and automod entries, with no blanket access to private direct messages.</p>
            <h2>Google data</h2>
            <p>Google Tasks, Calendar and Contacts are accessed with OAuth tokens stored on the device. ReKindle's use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements: the data is used only to provide the feature you connected, not sold, and not used for advertising. It is fetched directly from Google's APIs, not copied into ReKindle's database.</p>
            <h2>Third-party services</h2>
            <ul>
                <li>Mail connects to your email provider via IMAP/SMTP; app passwords are encrypted before an encrypted copy is saved to your private account record. Outlook/Hotmail uses a Microsoft refresh token kept on ReKindle's server and never returned to the browser, so the device stores no password.</li>
                <li>AI chat sends your prompts to the selected provider (or locally to Ollama).</li>
                <li>Dropbox, Bluesky, Mastodon, Pinterest and Substack use tokens/cookies you provide, stored on the device or in your private account records.</li>
                <li>News, RSS, weather, stocks, Wikipedia and similar apps fetch public data from their providers.</li>
            </ul>
            <p>Each service has its own privacy policy. Do not paste secrets or sensitive personal data into third-party apps.</p>
            <h2>Deleting data</h2>
            <p>Clear browser site data to remove guest data and local caches. To delete your account and cloud records, sign in and use <b>Settings -> Delete Account</b>; it removes your profile, files, posts, chat messages and scores from both Firebase projects. If you are locked out, email <a href="mailto:support@rekindle.ink">support@rekindle.ink</a> with your username. See <a href="#storage">Where your data lives</a> for what each clear operation affects.</p>
        `
    },
    {
        id: 'hidden-legacy',
        cat: 'settings',
        title: 'Unlisted & legacy pages',
        summary: 'Pages that exist but are not on the home screen, and what they are for.',
        tags: 'unlisted hidden legacy jumpy texas holdem words readwise manga quicknotes login moderation index old',
        related: ['games-overview'],
        body: `
            <p>A few ReKindle pages are reachable but deliberately not shown on the home grid. They are either in beta, retired, or meant for administrators.</p>
            <h2>Playable but unlisted</h2>
            <table>
                <tr><th>Page</th><th>What it is</th></tr>
                <tr><td><code>/jumpy</code></td><td>A vertical platformer with a leaderboard. Fully playable; see <a href="#jumpy">Jumpy</a>.</td></tr>
                <tr><td><code>/cookieclicker</code></td><td>An idle cookie game with an optional text-mode challenge. Fully playable; the home-screen icon is hidden for now. See <a href="#cookieclicker">Cookie Clicker</a>.</td></tr>
                <tr><td><code>/texasholdem</code></td><td>Poker against three bots. Beta; see <a href="#texasholdem">Texas Hold'em</a>.</td></tr>
                <tr><td><code>/words</code></td><td>Asynchronous Scrabble-style matches. Beta and needs an opponent; see <a href="#words">Words Online</a>.</td></tr>
                <tr><td><code>/quicknotes</code></td><td>An older handwritten-notes page superseded by Quick ToDo and Notes. Pro-gated; kept for compatibility.</td></tr>
            </table>
            <h2>Retired or redirect pages</h2>
            <table>
                <tr><th>Page</th><th>Status</th></tr>
                <tr><td><code>/manga</code></td><td>The old MangaDex reader. It redirects to the dashboard; unlicensed content was removed. Use <a href="#comics">Comics</a> for public-domain comics.</td></tr>
                <tr><td><code>/index_old</code></td><td>The classic dashboard, used as the home page by the Lite build and whenever Home Layout is set to Classic. It has fewer features than the modern home screen.</td></tr>
                <tr><td><code>/login</code></td><td>A diagnostics page for authentication, network, diagnostics and logout. It is not the normal sign-in flow - use the home screen's LOG IN / REGISTER modal. See <a href="#account">Account and sign-in</a>.</td></tr>
                <tr><td><code>/moderation</code></td><td>Owner-only moderation console: Automod Log, Reports, Banned IPs, Users and Content Review. Social moderation is otherwise automatic, so this is not a general support page.</td></tr>
                <tr><td><code>/changelog</code></td><td>A searchable list of every GitHub commit, newest first. Also linked from the About panel.</td></tr>
                <tr><td><code>/probe</code></td><td>A browser capability report for support and the Lite/Legacy builds. Open it on the device when asked; it is a raw diagnostic page.</td></tr>
            </table>
            <div class="note"><b>Stability:</b> unlisted pages can change or disappear without the usual deprecation notice. If you rely on one, mention it in <a href="#suggestions">Suggestions</a> so it can be promoted or documented properly.</div>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([
    {
        id: 'help',
        cat: 'start',
        title: 'Help & FAQ (this app)',
        summary: 'How to search this help centre, browse the A-Z index and change the text size.',
        tags: 'help faq documentation search a-z index font size guides',
        appHref: 'help',
        appName: 'Help & FAQ',
        related: ['welcome', 'support', 'troubleshooting'],
        body: `
            <p>This app is the reference manual for ReKindle. It covers every app, game, account feature, setting and common problem.</p>
            <h2>Finding a guide</h2>
            <ul>
                <li><b>Search</b> - type an app name, a feature ("sync", "password") or a problem ("blank page"). Search looks at titles, summaries, tags and article text.</li>
                <li><b>Categories</b> - use the buttons in the sidebar (top strip on a narrow screen) to browse by area.</li>
                <li><b>A-Z index</b> - an alphabetical list of every app and game with its own guide and launch button.</li>
                <li><b>Related guides</b> - each article ends with links to useful neighbours.</li>
            </ul>
            <h2>Text size</h2>
            <p>Use the <b>A-</b> and <b>A+</b> buttons in the title bar to change article text from 13 to 22 pixels. The choice is saved on the device. This affects the main reading area only, not the sidebar or title bar.</p>
            <h2>Opening an app</h2>
            <p>Guides for real apps have an <b>Open ...</b> button at the bottom. It launches the app exactly as the home-screen icon would. Guides without a button are concepts, overviews or retired pages.</p>
            <div class="note"><b>Found a mistake?</b> Use the <b>Report a problem</b> link at the bottom of the guide. It opens an email with the article title filled in. Missing or outdated documentation is worth reporting.</div>
            <p>Press <b>Back</b> to return to the help home, or <b>X</b> to close help and return to the ReKindle dashboard.</p>
        `
    }
]);

HELP_ARTICLES = HELP_ARTICLES.concat([
    {
        id: 'google-integrations',
        cat: 'start',
        title: 'Google, iCalendar and CardDAV',
        summary: 'Connect Google Tasks, Calendar and Contacts, or import read-only iCalendar and CardDAV/vCard feeds.',
        tags: 'google tasks calendar contacts oauth caldav carddav ics vcf sync permissions token revoke',
        related: ['tasks', 'calendar', 'contacts', 'privacy'],
        body: `
            <p>ReKindle can connect to Google and to standard calendar/contact feeds. Each integration has a different level of access, so check what it can change before connecting.</p>
            <h2>Google Tasks</h2>
            <p>Tasks can read and write your Google Tasks. Connect from the Tasks or Quick ToDo sync prompt. Completing a task in ReKindle completes it in Google; adding one creates a new Google task.</p>
            <h2>Google Calendar</h2>
            <p>Calendar requests full calendar access so it can list your calendars and create, edit or delete events. Choose which calendars are visible in the calendar picker. The dashboard agenda reads the same connection.</p>
            <h2>Google Contacts</h2>
            <p>Contacts requests <b>read-only</b> access to Google Contacts. It is an import view: you can read and search the address book, but ReKindle cannot modify or delete Google contacts. Local contacts remain editable.</p>
            <h2>iCalendar (.ics)</h2>
            <p>Save an iCalendar (<code>.ics</code>) subscription URL in Settings, for example a published Google Calendar or an ICS feed. Calendar fetches it through ReKindle's proxy and shows the events read-only. This is a one-way import, not two-way sync, and it is not a full CalDAV client: feeds that require OAuth or a session cookie usually fail. The CalDAV/CardDAV URL fields only appear after you turn the matching Google Calendar/Contacts toggle off.</p>
            <h2>CardDAV / vCard</h2>
            <p>Save a CardDAV or <code>.vcf</code> URL in Settings. Contacts parses the file and shows the entries read-only. Large address books can take a moment to parse on an e-reader.</p>
            <h2>Tokens and revoking access</h2>
            <p>OAuth tokens are stored on the device, not in ReKindle's database. When a token expires, the app asks you to sign in again. To revoke access completely, visit <b>myaccount.google.com/permissions</b> and remove ReKindle, then clear the app's site data on the device. Clearing site data alone signs you out but does not revoke the grant at Google.</p>
            <h2>Common problems</h2>
            <ul>
                <li><b>Nothing happens when you connect</b> - Google sign-in replaces the page with its consent screen rather than opening a popup. Check the connection and try again from the app.</li>
                <li><b>Empty list after connecting</b> - check that the Google account actually has tasks/events/contacts, and that the right calendar is visible.</li>
                <li><b>"Token expired" or repeated prompts</b> - clear site data and reconnect; long dormant sessions expire.</li>
                <li><b>iCalendar error</b> - the URL may require authentication, be malformed, or be temporarily unreachable. Test it in a browser.</li>
            </ul>
            <div class="note"><b>Privacy:</b> Google data is fetched directly with your token and is not copied into ReKindle's Firebase records. ReKindle's use follows the Google API Services User Data Policy, including Limited Use. See <a href="#privacy">Privacy and your data</a>.</div>
        `
    }
]);
