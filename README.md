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

    *Example `firestore.rules` configuration:*
    ```
    rules_version = '2';

    service cloud.firestore {
      match /databases/{database}/documents {

        // --- Helper Functions ---
        function isValidUsername(username) {
          // Username must be a string between 1 and 30 characters
          // and must not contain characters that can be used for XSS.
          return username is string &&
                 username.size() > 0 &&
                 username.size() <= 30 &&
                 !username.matches('.*[<>&\'"].*');
        }

        function isValidText(text) {
          // A basic check for message content to prevent HTML injection.
          return text is string &&
                 text.size() > 0 &&
                 text.size() <= 1000 && // Limit message length
                 !text.matches('.*[<>].*'); // Block basic HTML tags
        }

        // --- Collection Rules ---

        // 1. USER PRIVATE DATA (e.g., settings, notes)
        match /users/{userId}/{document=**} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }

        // 2. KINDLECHAT
        match /rooms/{roomId} {
          allow read: if request.auth != null;

          match /messages/{messageId} {
            allow read: if request.auth != null;
            // Secure create: Validate username and message text for safety.
            // Note: For anonymous users, email might be null, so check before accessing.
            allow create: if request.auth != null &&
                            (request.auth.token.email == null || request.resource.data.user == request.auth.token.email.split('@')[0]) &&
                            isValidText(request.resource.data.text);
            allow update: if request.auth != null && 
                             request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions']);
            allow delete: if false;
          }
          
          // Allow creating and updating rooms (needed for DMs)
          allow create, update: if request.auth != null;
        }

        // 3. TETRIS LEADERBOARD
        match /leaderboard_tetris/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null &&
                          request.auth.uid == userId &&
                          isValidUsername(request.resource.data.username) &&
                          request.resource.data.score is number;
        }

        // 4. SNAKE LEADERBOARD
        match /leaderboard_snake/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null &&
                          request.auth.uid == userId &&
                          isValidUsername(request.resource.data.username) &&
                          request.resource.data.score is number;
        }

        // 5. WORDS (Multiplayer Game)
        match /word_games/{gameId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null &&
                          (request.resource.data.p1_uid == request.auth.uid ||
                           request.resource.data.p2_uid == request.auth.uid) &&
                          isValidUsername(request.resource.data.p1_name) &&
                          (request.resource.data.p2_name == null || isValidUsername(request.resource.data.p2_name));
        }

        // 6. FREEWRITE
        match /freewrite_sessions/{sessionId} {
          allow read: if true;
          allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
          allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
        }

        // 7. HANOI LEADERBOARD
        match /leaderboard_hanoi_3/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_hanoi_4/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_hanoi_5/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_hanoi_6/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_hanoi_7/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }

        // 8. LIGHTS OUT LEADERBOARD
        match /leaderboard_lightsout_3/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_lightsout_4/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }
        match /leaderboard_lightsout_5/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null && request.auth.uid == userId && isValidUsername(request.resource.data.username) && request.resource.data.moves is number;
        }

        // 9. TRIVIA LEADERBOARD
        match /leaderboard_trivia/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null &&
                          request.auth.uid == userId &&
                          isValidUsername(request.resource.data.username) &&
                          request.resource.data.totalPercent is number &&
                          request.resource.data.gameCount is number;
        }

        // 10. SOLITAIRE LEADERBOARD
        match /leaderboard_solitaire/{userId} {
          allow read: if request.auth != null;
          allow write: if request.auth != null &&
                          request.auth.uid == userId &&
                          isValidUsername(request.resource.data.username) &&
                          request.resource.data.moves is number;
        }

        // 11. INTERACTIVE BLACKLIST
        match /interactive_blacklist/{gameId} {
          allow read: if true;
          allow write: if request.auth != null;
        }

        // 12. USER UPLOADS
        match /interactive_uploads/{uploadId} {
          allow read: if true;
          allow create: if request.auth != null &&
                          request.resource.data.uploaderUid == request.auth.uid &&
                          isValidText(request.resource.data.title);
          allow delete: if request.auth != null && resource.data.uploaderUid == request.auth.uid;
        }

        // 13. SHEET MUSIC UPLOADS
        match /sheet_music_uploads/{uploadId} {
          allow read: if true;
          allow create: if request.auth != null &&
                          request.resource.data.uploaderUid == request.auth.uid &&
                          isValidText(request.resource.data.title);
          allow delete: if request.auth != null && resource.data.uploaderUid == request.auth.uid;
        }

        // 14. SUGGESTIONS APP
        match /suggestions/{suggestionId} {
          allow read: if true;
          allow create: if request.auth != null &&
                          isValidText(request.resource.data.title) &&
                          isValidText(request.resource.data.description) &&
                          (request.resource.data.category == null || isValidText(request.resource.data.category)) &&
                          (request.resource.data.device == null || isValidText(request.resource.data.device));
          
          // Update: 
          // 1. Author can edit their own suggestion (title/desc).
          // 2. ANY authenticated user can update 'upvotes' (toggle their UID in the array).
          // 3. Admin (ukiyo) can update 'status'.
          allow update: if request.auth != null && (
              (resource.data.authorUid == request.auth.uid && 
               request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title', 'description'])) 
              ||
              (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['upvotes']))
              ||
              (request.auth.token.email.matches('ukiyo@.*') && 
               request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'type', 'category']))
          );

          match /comments/{commentId} {
            allow read: if true;
            allow create: if request.auth != null && isValidText(request.resource.data.text);
            allow delete: if request.auth != null && resource.data.authorUid == request.auth.uid;
          }
        }
      }
    }
    ```

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
* **Watchlist:** Requires a worker to proxy TMDB API requests securely. Update `PROXY_BASE` or logic in `watchlist.html`.
* **Chords:** Requires a worker to fetch song tabs/lyrics to avoid CORS issues. Update `WORKER_URL` in `chords.html`.
* **Interactive:** Requires a worker provided by the Interactive Fiction DB to serve stories. Update `STORY_SERVER_URL` in `interactive.html`.

*> **Note:** If you do not configure these, the app will default to **Guest Mode** (local storage only), and AI/Google features will be disabled.*

---

## 🛠️ Building the Project

To build the project for different devices (Standard, Lite, and Legacy), run the build script:

```bash
node build-automation.js
```

This will create a `_deploy` directory with three targets:

*   **Main (`_deploy/main`):** The standard version for modern browsers (Desktop, Mobile, Tablets). Minified but fully featured.
*   **Lite (`_deploy/lite`):** Optimized for **Kobo** and newer **Kindle** devices (Chrome 44+). Includes polyfills, transpiled ES5 code, and Kobo-specific fixes (e.g., proper window handling, WebM video replacement).
*   **Legacy (`_deploy/legacy`):** Designed for very old devices (Chrome 12+). Features aggressive transpilation, heavy polyfills, and visual badges/warnings for unsupported apps.

---

*Created by [Ukiyo](https://ukiyomusic.com)*
