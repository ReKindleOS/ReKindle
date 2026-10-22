#!/bin/sh
# KPM install hook. Runs from the unpacked package directory, as root.
# Keep this POSIX sh: KPM executes hooks with sh, not bash.

set -e

cp -f ./ReKindle.sh /mnt/us/documents/ReKindle.sh
cp -f ./ReKindleStop.sh /mnt/us/documents/ReKindleStop.sh
cp -f ./ReKindleCover.png /mnt/us/documents/ReKindleCover.png
chmod 755 /mnt/us/documents/ReKindle.sh /mnt/us/documents/ReKindleStop.sh
chmod 644 /mnt/us/documents/ReKindleCover.png

echo "ReKindle Fullscreen installed to /mnt/us/documents"
exit 0
