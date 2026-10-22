#!/bin/sh
# KPM uninstall hook. KPM deletes the package files; remove the scriptlets
# that install.sh copied into the user's documents folder.

rm -f /mnt/us/documents/ReKindle.sh
rm -f /mnt/us/documents/ReKindleStop.sh
rm -f /mnt/us/documents/ReKindleCover.png

echo "ReKindle Fullscreen scriptlets removed"
exit 0
