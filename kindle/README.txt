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

INSTALL (ON DEVICE, KPM)
------------------------
KPM is included with current WinterBreak / SpringBreak jailbreaks. In the
Kindle search bar, run these one at a time:

  ;kpm add-repo https://repo.rekindle.ink
  ;kpm update
  ;kpm install rekindle

KPM downloads with the shell, so Amazon's browser file-type filter is not
involved. The scriptlets are copied into documents; open the library and tap
"ReKindle Fullscreen".

Do not use the direct download links on a stock Kindle browser: it reports
"Invalid file type" for .sh and .txt. The ZIP below is the fallback.

USE
---
Tap "ReKindle Fullscreen" in your library. ReKindle opens after a few seconds.
Press the power button once to close it and return to the Kindle library.

ReKindle keeps its normal framed layout. The launcher only removes the Kindle
interface and browser chrome; it does not stretch the apps.

If the Kindle is stuck, run "ReKindle Stop" from your library. If the library
is not visible, hold the power button until the Kindle reboots.

FILES
-----
documents/ReKindle.sh               launcher
documents/ReKindleStop.sh           emergency exit
documents/ReKindleCover.png         library cover
rekindle-fullscreen.conf.example    optional URL / display / position settings

The launcher does not change the root filesystem. It stops the Kindle GUI,
runs the stock Chromium browser, and restarts the GUI when you exit.

LOG
---
/mnt/us/rekindle-fullscreen.log

More help: https://rekindle.ink/kindle
