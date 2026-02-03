# ReKindle

**Your E-Ink Device, Upgraded.**

ReKindle is a free, web-based dashboard and operating system designed specifically for E-ink devices (Kindle Scribe, Paperwhite, Boox, etc.). It transforms your simple e-reader into a powerful productivity tool, gaming console, and news hub—all running directly in the browser.

## Setup & Installation

ReKindle is a Progressive Web App (PWA). No "installation" or jailbreak is required.

1.  Open the web browser on your E-ink device.
2.  Navigate to `rekindle.ink`.
3.  **Recommended:** Bookmark the page or add it to your device's home screen if supported.

## Gallery

<p align="center">
  <img src="screenshots/ReKindle-1.png" width="30%" />
  <img src="screenshots/ReKindle-2.png" width="30%" />
  <img src="screenshots/ReKindle-3.png" width="30%" />
</p>

<p align="center">
  <img src="screenshots/ReKindle-4.png" width="30%" />
  <img src="screenshots/ReKindle-5.png" width="30%" />
  <img src="screenshots/ReKindle-6.png" width="30%" />
</p>

<p align="center">
  <img src="screenshots/ReKindle-7.png" width="30%" />
  <img src="screenshots/ReKindle-8.png" width="30%" />
  <img src="screenshots/ReKindle-9.png" width="30%" />
</p>

<p align="center">
  <img src="screenshots/ReKindle-10.png" width="30%" />
  <img src="screenshots/ReKindle-11.png" width="30%" />
</p>

## Features

ReKindle operates in two modes: **Guest Mode** (all data stored locally on your device) and **Cloud Mode** (create an account to sync data across devices).

### Productivity & Organization
*   **Quick ToDo⁺:** A unique task manager that uses **OCR (Handwriting Recognition)** to convert your handwriting into digital, sync-able tasks.
*   **Google Integration:** Full read/write sync for **Google Tasks**, **Google Calendar**, and **Google Contacts**.
*   **Gmail⁺:** A fully functional email client for your E-ink device.
*   **Universal Sync:** Supports **CalDAV** and **CardDAV** for non-Google users.
*   **Note Pad:** A clean, distraction-free writing environment.
*   **Habit Tracker:** Keep your streaks alive with a visual weekly tracker.
*   **Focus Timer:** A Pomodoro-style timer to boost productivity.
*   **Decider:** A random decision engine for when you just can't choose.
*   **Mindmap:** Visually organize your ideas and concepts.
*   **Teleprompter:** Display notes line-by-line for speeches or practice.

### Reading & News
*   **Reader:** A fully functional EPUB reader powered by `epub.js` with library management.
*   **Library Integration:** Built-in search and download for **Project Gutenberg**, **Standard Ebooks**, and **Libby**.
*   **NetLite:** A lightweight, text-only web browser powered by **FrogFind**, optimizing the web for E-ink screens.
*   **RSS Reader:** Follow your favorite feeds in a clean, readable format.
*   **The Daily Kindling:** A daily newspaper aggregating top headlines from world news, tech, science, and more.
*   **Reading Log & List:** Track your daily reading minutes and maintain a "To-Read" wish list with search integration.

### Knowledge & Tools
*   **Oracle AI⁺:** Chat with **Gemini 2.5**, optimized for text-based responses.
*   **Atlas:** Global maps powered by OpenStreetMap.
*   **Babel:** Text translator supporting multiple languages.
*   **Wikipedia:** Search or read random entries from the free encyclopedia.
*   **On This Day:** Discover historical events, births, and deaths for the current date.
*   **Stocks:** Track your portfolio with real-time market data.
*   **Weather:** Current conditions and 5-day forecasts.
*   **Utilities:** Calculator, Unit Converter, Dictionary, World Clock, **AirType⁺** (Phone Typewriter), and Breathing Exercises.

### Games Arcade
**Single Player:**
*   **Word Games:** Wordle, Spelling Bee, Connections, Crossword (NYT Archives), Anagrams, Hangman, Word Search.
*   **Logic & Numbers:** Sudoku, Nerdle (Math Wordle), 2048, Minesweeper, Memory, Jigsaw Puzzles, Tower of Hanoi, Lights Out, Nonograms, Codebreaker.
*   **Classic:** Solitaire, Tetris, Snake, Blackjack, Dino, Pet (Virtual Pet), Block Blast, Texas Hold'em (beta), DOOM (beta).

**Multiplayer & Local:**
*   **Words Online:** Play Scrabble-style games asynchronously against other ReKindle users.
*   **Pass-and-Play:** Local 2-player versions of Chess, Checkers, Battleships, Connect 4, Tic-Tac-Toe, and 8 Ball.

### Social & Creative
*   **KindleChat:** An exclusive chat platform for ReKindle users.
*   **Reddit:** A text-optimized Reddit client.
*   **Sketchpad & Pixel Art:** Create simple drawings or 1-bit pixel art canvases.
*   **Flipbook⁺:** Create pixel animations directly on your e-ink device.
*   **Music:** Sheet Music library and Guitar Chords/Tabs search.

*⁺ Features marked with a plus require a **ReKindle+** subscription.*

---

## ⚡ ReKindle+

Support the development of ReKindle and unlock premium features, including Gmail integration, AI-powered handwriting recognition, and advanced productivity tools.

**Pricing:**
*   **Monthly:** $2/mo
*   **Yearly:** $15/yr
*   **Lifetime:** $30 (One-time payment)

[**Subscribe at rekindle.ink/pay**](https://rekindle.ink/pay)

---

## Privacy

ReKindle is designed with privacy as a priority.

*   **Guest Mode:** By default, ReKindle uses your browser's `localStorage`. No data leaves your device.
*   **Cloud Sync:** If you choose to log in, app-specific data (notes, tasks, game states) is synced securely via Google Firebase.
*   **Google Data:** Google Tokens are stored locally on your device. ReKindle fetches Calendar/Contacts/Tasks data directly from Google APIs to your browser; this data is **never** stored on ReKindle servers.

## License

**ReKindle** is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License**.

You are free to share and adapt the work for non-commercial purposes, provided you give appropriate credit and distribute your contributions under the same license.

***

## ☁️ Cloud & API Configuration (For Developers)

To enable full functionality (cloud sync, Google integrations, and AI features), you will need to set up your own backend services.

### 1. Firebase Setup (Required for Sync & Auth)
ReKindle uses Google Firebase for user authentication and storing app data.
1.  Go to the [Firebase Console](https://console.firebase.google.com/) and create a project.
2.  Enable **Email/Password** authentication.
3.  Enable **Firestore Database** and set security rules to restrict access to owner-only.

### 2. Google API Setup (Optional for Google Sync)
Enable the **Google Tasks**, **Calendar**, and **People** APIs in the [Google Cloud Console](https://console.cloud.google.com/). Create an OAuth 2.0 Client ID for a Web Application and add your domain to the authorized origins.

### 3. Cloudflare Workers (Backend Proxies)
ReKindle uses specialized Cloudflare Workers to handle sensitive API requests and bypass CORS:
*   **Oracle AI:** Proxies requests to the Google Gemini API.
*   **Quick ToDo OCR:** Handles image processing and OCR for handwritten tasks.
*   **Watchlist (TMDB):** Securely fetches movie and show data.
*   **Chords:** Fetches song tabs and lyrics.
*   **Story (IFDB):** Serves interactive fiction stories.
*   **Stripe:** Manages supporter status and donations.
*   **Translate:** Proxies translation requests.

## 🛠️ Building & Deployment

To build the project for different devices, run:
```bash
node build-automation.js
```

This creates three optimized targets in the `_deploy` directory:

1.  **Main (`_deploy/main`):** For modern browsers (Desktop, Mobile). Minified with ES6+ features.
2.  **Lite (`_deploy/lite`):** Optimized for **Kobo** and newer **Kindle** devices (Chrome 44+). Includes local polyfills, transpiled ES5 code, and Kobo-specific fixes (e.g., window handling, WebM video fallbacks).
3.  **Legacy (`_deploy/legacy`):** Designed for very old devices (Chrome 12+ / e.g., Paperwhite 2). Features aggressive transpilation, heavy polyfills, and visual warnings for unsupported applications.

---

*Created by [Ukiyo](https://ukiyomusic.com)*
