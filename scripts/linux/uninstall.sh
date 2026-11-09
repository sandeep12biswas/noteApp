#!/usr/bin/env bash
# Uninstalls FlowNote, however it was installed. The work is done by
# packaging/linux/uninstall.sh — the uninstaller shipped to users — so both
# stay identical. Flags pass through (--remove-data, --keep-data, --silent;
# see --help).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../../packaging/linux/uninstall.sh" "$@"
