#!/bin/sh
# KPM uninstall hook. Runs as root.

set -e

rm -f /mnt/us/documents/ReKindle.sh "/mnt/us/documents/ReKindle Launcher.sh"
rm -f /mnt/us/documents/ReKindleStop.sh
rm -f /mnt/us/documents/ReKindleCover.png
rm -rf /var/local/rekindle

echo "ReKindle scriptlet and root launcher removed"
exit 0
