#!/usr/bin/env bash
# Uninstalls FlowNote, however scripts/linux/install.sh (or the prebuilt
# package's install.sh) installed it. The work is done by packaging/linux/
# uninstall.sh — the uninstaller shipped with the prebuilt packages — so
# both stay identical. Flags pass through (--remove-data, --keep-data;
# see --help).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../../packaging/linux/uninstall.sh" "$@"
