#!/usr/bin/env bash
# Removes FlowNote, however install.sh installed it (.deb, AppImage, or both).
# Your notes are kept unless you ask for them to be deleted too — then a
# reinstall picks them back up.
set -euo pipefail

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
# Electron's userData folder: the notes database, attachments, sync backups.
# Electron names it after package.json's `name` (apps/electron has no
# productName), hence @flownote/electron.
APP_DATA_DIR="$CONFIG_HOME/@flownote/electron"

INSTALL_DIR="$HOME/.local/opt/flownote"
BIN_FILE="$HOME/.local/bin/flownote"
DESKTOP_FILE="$DATA_HOME/applications/flownote.desktop"

REMOVE_DATA=ask
usage() {
  cat <<EOF
Usage: uninstall.sh [--remove-data | --keep-data]

Uninstalls FlowNote (the .deb package and/or the AppImage install).

  --remove-data   Also delete your notes and attachments ($APP_DATA_DIR).
  --keep-data     Keep them (the default when not asked interactively).

Without either flag, you're asked — unless there's no terminal to ask in,
in which case your notes are kept.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --remove-data) REMOVE_DATA=yes ;;
    --keep-data) REMOVE_DATA=no ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# Close FlowNote first, so it can't write to its data while that's deleted.
if pgrep -u "$(id -u)" -x flownote >/dev/null 2>&1; then
  echo "==> Closing FlowNote"
  pkill -TERM -u "$(id -u)" -x flownote || true
  for _ in $(seq 1 20); do
    pgrep -u "$(id -u)" -x flownote >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -KILL -u "$(id -u)" -x flownote 2>/dev/null || true
fi

removed=0

if command -v dpkg-query >/dev/null 2>&1 && [ "$(dpkg-query -W -f='${Status}' flownote 2>/dev/null || true)" = "install ok installed" ]; then
  echo "==> Removing the flownote package (sudo may ask for your password)"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get remove -y flownote
  removed=1
fi

if [ -e "$INSTALL_DIR" ] || [ -e "$BIN_FILE" ] || [ -L "$BIN_FILE" ] || [ -e "$DESKTOP_FILE" ]; then
  echo "==> Removing the AppImage install"
  rm -rf "$INSTALL_DIR"
  rm -f "$BIN_FILE" "$DESKTOP_FILE"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
  removed=1
fi

if [ -d "$APP_DATA_DIR" ]; then
  if [ "$REMOVE_DATA" = ask ]; then
    if [ -t 0 ]; then
      printf 'Also delete your notes and attachments in %s? This cannot be undone. [y/N] ' "$APP_DATA_DIR"
      read -r answer
      case "$answer" in [yY]|[yY][eE][sS]) REMOVE_DATA=yes ;; *) REMOVE_DATA=no ;; esac
    else
      REMOVE_DATA=no
    fi
  fi
  if [ "$REMOVE_DATA" = yes ]; then
    echo "==> Deleting your FlowNote data ($APP_DATA_DIR)"
    rm -rf "$APP_DATA_DIR"
    rmdir "$(dirname "$APP_DATA_DIR")" 2>/dev/null || true
  else
    echo "==> Your notes were kept in $APP_DATA_DIR (reinstalling picks them back up)."
  fi
fi

if [ "$removed" -eq 0 ]; then
  echo "FlowNote isn't installed (no flownote package, nothing in ~/.local)."
  [ "$REMOVE_DATA" = yes ] && exit 0
  exit 1
fi
echo "==> FlowNote is uninstalled."
