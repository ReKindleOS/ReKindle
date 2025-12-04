# ReKindle

**Your E-Ink Device, Upgraded.**

ReKindle is a free, web-based dashboard and operating system designed specifically for E-ink devices (Kindle Scribe, Paperwhite, Boox, etc.). It transforms your simple e-reader into a powerful productivity tool, gaming console, and news hub—all running directly in the browser.

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

---

*Created by Ukiyo*
