# ReKindle

**Your E-Ink Device, Upgraded.**

ReKindle is a free, web-based dashboard and operating system designed specifically for E-ink devices (Kindle Scribe, Paperwhite, Boox, etc.). It transforms your simple e-reader into a powerful productivity tool, gaming console, and news hub—all running directly in the browser.

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
* **Quick ToDo:** A unique task manager that uses **OCR (Optical Character Recognition)** to convert your handwriting into digital, sync-able tasks.
* **Google Integration:** Full read/write sync for **Google Tasks**, **Google Calendar**, and **Google Contacts**.
* **Universal Sync:** Supports **CalDAV** and **CardDAV** for non-Google users.
* **Note Pad:** A clean, distraction-free writing environment.
* **Habit Tracker:** Keep your streaks alive with a visual weekly tracker.
* **Focus Timer:** A Pomodoro-style timer to boost productivity.

### Reading & News
* **Reader:** A fully functional EPUB reader powered by `epub.js` with library management.
* **Project Gutenberg & Standard Ebooks:** Integrated search and download for thousands of free, high-quality public domain books.
* **NetLite:** A lightweight, text-only web browser powered by **FrogFind**, optimizing the web for E-ink screens.
* **RSS Reader:** Follow your favorite feeds in a clean, readable format.
* **The Daily Kindling:** A generated newspaper aggregating top headlines from world news, tech, science, and more.
* **Reading Log & List:** Track your daily reading minutes and maintain a "To-Read" wish list with search integration.

### Knowledge & Tools
* **Oracle AI:** Chat with **Gemini 2.5**, optimized for text-based responses.
* **Atlas:** Global maps powered by OpenStreetMap.
* **Babel:** Text translator supporting multiple languages.
* **Wikipedia:** Search or read random entries from the free encyclopedia.
* **On This Day:** Discover historical events, births, and deaths for the current date.
* **Stocks:** Track your portfolio with real-time market data.
* **Weather:** Current conditions and 5-day forecasts.
* **Utilities:** Calculator, Unit Converter, Dictionary, and World Clock.

### Games Arcade
**Single Player:**
* **Word Games:** Wordle, Spellbound (Spelling Bee), Bindings (Connections), Crossword (NYT Archives), Anagrams, Hangman, Word Search.
* **Logic & Numbers:** Sudoku, Nerdle (Math Wordle), 2048, Minesweeper, Memory, Jigsaw Puzzles.
* **Classic:** Solitaire, Tetris (Blocks), Snake, Blackjack.

**Multiplayer & Local:**
* **Words Online:** Play Scrabble-style games asynchronously against other ReKindle users.
* **Pass-and-Play:** Local 2-player versions of Chess, Battleships, Connect 4, and Ultimate Tic-Tac-Toe.

### Social
* **KindleChat:** An exclusive chat platform for ReKindle users.
* **Reddit:** A text-optimized Reddit client.

## Setup & Installation

ReKindle is a Progressive Web App (PWA). No "installation" or jailbreak is required.

1.  Open the web browser on your E-ink device.
2.  Navigate to `[Your URL Here]`.
3.  **Recommended:** Bookmark the page or add it to your device's home screen if supported.

## Privacy

ReKindle is designed with privacy as a priority.

* **Guest Mode:** By default, ReKindle uses your browser's `localStorage`. No data leaves your device.
* **Cloud Sync:** If you choose to log in, app-specific data (notes, tasks, game states) is synced securely via Google Firebase.
* **Google Data:** Google Tokens are stored locally on your device. ReKindle fetches Calendar/Contacts/Tasks data directly from Google APIs to your browser; this data is **never** stored on ReKindle servers.

## License

**ReKindle** is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License**.

You are free to share and adapt the work for non-commercial purposes, provided you give appropriate credit and distribute your contributions under the same license.


Based on the code files provided, the ReKindle project relies on three distinct cloud services: **Firebase** (for general data sync and authentication), **Google Cloud APIs** (for Tasks, Calendar, and Contacts integration), and **Cloudflare Workers** (for AI chat and OCR features).

***

## ☁️ Cloud & API Configuration (For Developers)

To enable full functionality (cloud sync, Google integrations, and AI features), you will need to set up your own backend services.

### 1. Firebase Setup (Required for Sync & Auth)
ReKindle uses Google Firebase for user authentication and storing app data (like notes, game stats, and settings) across devices.

1.  Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2.  **Authentication:** Go to **Build > Authentication** and enable the **Email/Password** sign-in method.
3.  **Database:** Go to **Build > Firestore Database** and create a database. Set the security rules to allow authenticated users to read/write their own data.
4.  **Web App:** In Project Overview, click the Web icon (`</>`) to register an app. Copy the `firebaseConfig` object provided.
5.  **Update Code:** Replace the `const firebaseConfig = { ... }` block in **all** app HTML files (e.g., `index.html`, `notes.html`, `todo.html`, etc.) with your own configuration.

### 2. Google API Setup (Optional for Google Sync)
To sync with Google Tasks, Calendar, and Contacts, you need a Google Cloud Project with the appropriate APIs enabled.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  **Enable APIs:** Search for and enable the following APIs:
    * Google Tasks API
    * Google Calendar API
    * Google People API (for Contacts)
3.  **Credentials:** Create an **OAuth 2.0 Client ID** for a Web Application.
    * Add your hosting URL (e.g., `https://your-app.com`) to **Authorized JavaScript origins**.
    * Add your URL to **Authorized redirect URIs**.
4.  **Update Code:** Copy your **Client ID**. Open `tasks.html`, `calendar.html`, and `contacts.html` and replace the `CLIENT_ID` constant with your new ID.

### 3. Cloudflare Workers (Optional for AI & OCR)
The **Oracle AI** (Chat) and **Quick ToDo** (Handwriting OCR) apps use serverless functions to proxy requests to AI providers securely.

* **Oracle AI:** Requires a worker to proxy requests to the Google Gemini API. Update `WORKER_URL` in `chat.html`.
* **Quick ToDo:** Requires a worker to handle image processing for OCR. Update `WORKER_URL` in `quicktodo.html`.

*> **Note:** If you do not configure these, the app will default to **Guest Mode** (local storage only), and AI/Google features will be disabled.*

---

*Created by Ukiyo*
