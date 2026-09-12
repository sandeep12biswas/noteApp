#!/usr/bin/env bash
# Reverses whichever install path scripts/linux/install.sh used — tries the
# apt/dpkg package first (the default install.sh takes when available),
# then cleans up the ~/.local AppImage install if present. Safe to run even
# if only one of the two was ever installed, or neither.
set -euo pipefail

removed_something=0

if command -v dpkg >/dev/null 2>&1 && dpkg -s flownote >/dev/null 2>&1; then
  echo "==> Removing the flownote apt package (sudo required)"
  sudo apt remove -y flownote
  removed_something=1
fi

INSTALL_DIR="$HOME/.local/opt/flownote"
BIN_LINK="$HOME/.local/bin/flownote"
DESKTOP_FILE="$HOME/.local/share/applications/flownote.desktop"

if [ -d "$INSTALL_DIR" ] || [ -L "$BIN_LINK" ] || [ -f "$DESKTOP_FILE" ]; then
  echo "==> Removing the AppImage install under \$HOME/.local"
  rm -rf "$INSTALL_DIR"
  rm -f "$BIN_LINK" "$DESKTOP_FILE"
  removed_something=1
fi

if [ "$removed_something" -eq 0 ]; then
  echo "FlowNote doesn't appear to be installed (checked apt and \$HOME/.local)."
  exit 1
fi

echo "==> FlowNote uninstalled. Your notes (SQLite DB under your user data dir) were not touched."
