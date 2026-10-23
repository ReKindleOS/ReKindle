#!/bin/sh
# KPM install hook. Runs from the unpacked package directory.
# Keep this POSIX sh: KPM executes hooks with sh, not bash.

set -e

mkdir -p /mnt/us/documents
cp -f ./ReKindle.sh "/mnt/us/documents/ReKindle Launcher.sh"
cp -f ./ReKindleCover.png /mnt/us/documents/ReKindleCover.png
rm -f /mnt/us/documents/ReKindle.sh /mnt/us/documents/ReKindleStop.sh
chmod 755 "/mnt/us/documents/ReKindle Launcher.sh"
chmod 644 /mnt/us/documents/ReKindleCover.png

echo "ReKindle installed to /mnt/us/documents"
exit 0
