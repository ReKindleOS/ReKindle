ReKindle Fullscreen for jailbroken Kindles
==========================================

Runs rekindle.ink without the Kindle interface or browser chrome.

REQUIREMENTS
------------
* A jailbroken Kindle on firmware 5.16.4 or newer (Chromium browser).
* Scriptlet support from the Universal Hotfix. If other .sh scriptlets in
  your library work, you are ready.
* Wi-Fi.

INSTALL (USB)
-------------
1. Unzip ReKindle-Fullscreen.zip on your computer.
2. Connect the Kindle over USB and open its drive.
3. Copy the "documents" folder from the zip into the Kindle's root folder,
   merging it with the existing "documents" folder. Do not copy the zip.
4. Eject the Kindle.
5. Open the library and tap "ReKindle Fullscreen". It may be under Docs or
   Recent.

INSTALL (ON DEVICE)
-------------------
Open rekindle.ink/kindle.sh (or rekindle.ink/kindle) on the Kindle browser and
tap "Download ReKindle.sh". The stock browser may refuse .sh downloads; use
"Download as .txt" in that case. It is the same script and should save as
ReKindle.sh. If it saves as .txt, rename it to ReKindle.sh on a computer.
The ZIP is the reliable fallback.

USE
---
Tap "ReKindle Fullscreen" in your library. ReKindle opens after a few seconds.
Press the power button once to close it and return to the Kindle library.

To go back to the normal framed layout later, open ReKindle Settings and turn
off "Kindle Fullscreen", or visit https://rekindle.ink/?kiosk=0.

If the Kindle is stuck, run "ReKindle Stop" from your library. If the library
is not visible, hold the power button until the Kindle reboots.

FILES
-----
documents/ReKindle.sh               launcher
documents/ReKindleStop.sh           emergency exit
rekindle-fullscreen.conf.example    optional URL / display / position settings

The launcher does not change the root filesystem. It stops the Kindle GUI,
runs the stock Chromium browser, and restarts the GUI when you exit.

LOG
---
/mnt/us/rekindle-fullscreen.log

More help: https://rekindle.ink/kindle
