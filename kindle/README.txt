ReKindle for jailbroken Kindles
==========================================

STATUS: HIGHLY EXPERIMENTAL
---------------------------
This is a community experiment, not a supported ReKindle feature. It changes
how the Kindle starts its browser, it has very little real-device testing, and
a failed launch can leave the Kindle stuck until you reboot it. Do not install
it on a Kindle you depend on.

Nothing in ReKindle requires it: a bookmark in the normal browser works on
every supported device.

Stops the Kindle interface and runs the stock Chromium browser on rekindle.ink.
v1.0.4 mounts chromium.sqsh and runs Chromium as the framework user, matching
Amazon's own browser launcher. The GUI is restored when you exit.

REQUIREMENTS
------------
* A jailbroken Kindle on firmware 5.16.4 or newer (stock Chromium browser).
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
5. Open the library and tap "ReKindle". It may be under Docs or
   Recent.

INSTALL (ON DEVICE, KPM)
------------------------
KPM is included with current WinterBreak / SpringBreak jailbreaks. The search
bar cannot pass a URL to KPM: Amazon's scriptExecutor rejects "." and ":" in
";" commands. Install kterm with ";kpm install kterm", open kterm, then run:

  kpm add-repo https://rekindle.ink/downloads/kpm/repo.json
  kpm update
  kpm install rekindle

Alternatively, copy the scriptlets over USB; that is the reliable route.
Whichever method you use, the scriptlets are copied into documents; open the
library and tap "ReKindle".

Do not use the direct download links on a stock Kindle browser: it reports
"Invalid file type" for .sh and .txt. The ZIP below is the fallback.

USE
---
Tap "ReKindle" in your library. The screen goes blank for a few seconds while
the Kindle interface stops, then Chromium opens ReKindle.

ReKindle keeps its normal framed layout; the apps are not stretched. Press the
power button once to close the browser and restart the Kindle interface. If the
screen does not come back, hold power until the Kindle reboots; that is the
normal recovery for this experimental launcher.

If anything looks wrong, open "ReKindle Log" or "ReKindle Error" from the
library. The launcher changes no boot files, so a reboot is always safe.

EXPERIMENTAL SOFTWARE
---------------------
Expect this to break. ReKindle cannot support it, and a future firmware update
can stop it working with no notice. Uninstall with ";kpm uninstall rekindle" or
by deleting the two files from documents.

FILES
-----
documents/ReKindle.sh               launcher
documents/ReKindleCover.png         library cover
rekindle-fullscreen.conf.example    optional URL override

The launcher does not change the root filesystem. It mounts chromium.sqsh
temporarily, stops the Kindle GUI, runs Chromium as framework, and restarts the
GUI when you exit.

LOG
---
/mnt/us/rekindle-fullscreen.log

More help: https://rekindle.ink/kindle
