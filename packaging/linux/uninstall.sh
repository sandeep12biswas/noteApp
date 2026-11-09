#!/usr/bin/env bash
# FlowNote uninstaller for Linux.
#
# Removes FlowNote however install.sh installed it (.deb, AppImage, or
# both). Your notes are kept unless you ask for them to be deleted too —
# then a reinstall picks them back up.
#
# Ships in the release bundle and, for the AppImage install, inside the
# install itself (~/.local/opt/flownote/uninstall.sh). Guided in a
# terminal, graphical when double-clicked, no questions with --silent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ui.sh
. "$SCRIPT_DIR/lib/ui.sh"

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
# Electron's userData folder: the notes database, attachments, sync backups.
# Electron names it after package.json's `name` (apps/electron has no
# productName), hence @flownote/electron.
APP_DATA_DIR="$CONFIG_HOME/@flownote/electron"

INSTALL_DIR="$HOME/.local/opt/flownote"
BIN_FILE="$HOME/.local/bin/flownote"
DESKTOP_FILE="$DATA_HOME/applications/flownote.desktop"
HICOLOR_ICON="$DATA_HOME/icons/hicolor/512x512/apps/flownote.png"

REMOVE_DATA=ask
UI_WANT=auto
usage() {
  cat <<EOF
Usage: uninstall.sh [--remove-data | --keep-data] [--silent] [--gui | --cli]

Uninstalls FlowNote (the .deb package and/or the AppImage install).

  --remove-data   Also delete your notes and attachments ($APP_DATA_DIR).
  --keep-data     Keep them.
  -y, --silent    Don't ask anything (notes are kept unless --remove-data).
  --gui / --cli   Force graphical dialogs / terminal prompts.

Without --remove-data/--keep-data you're asked; with nobody to ask (no
terminal, no desktop) your notes are kept.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --remove-data) REMOVE_DATA=yes ;;
    --keep-data) REMOVE_DATA=no ;;
    -y|--silent|--yes) UI_WANT=silent ;;
    --gui) UI_WANT=gui ;;
    --cli|--no-gui) UI_WANT=tty ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# Told what to do with the notes, without a terminal: a script — don't open dialogs.
if [ "$UI_WANT" = auto ] && [ "$REMOVE_DATA" != ask ]; then UI_WANT=script; fi
ui_init "$UI_WANT"
UI_TITLE="Uninstall FlowNote"

deb_installed() {
  command -v dpkg-query >/dev/null 2>&1 &&
    [ "$(dpkg-query -W -f='${Status}' flownote 2>/dev/null || true)" = "install ok installed" ]
}
appimage_installed() {
  [ -e "$INSTALL_DIR" ] || [ -e "$BIN_FILE" ] || [ -L "$BIN_FILE" ] || [ -e "$DESKTOP_FILE" ]
}

found=()
deb_installed && found+=("the system package (/opt/FlowNote)")
appimage_installed && found+=("the install for $(id -un) ($INSTALL_DIR)")

if [ "${#found[@]}" -eq 0 ]; then
  if [ "$REMOVE_DATA" = yes ] && [ -d "$APP_DATA_DIR" ]; then
    say "FlowNote isn't installed; deleting its leftover data ($APP_DATA_DIR)"
    rm -rf "$APP_DATA_DIR"
    rmdir "$(dirname "$APP_DATA_DIR")" 2>/dev/null || true
    exit 0
  fi
  [ "$UI_MODE" = gui ] && ui_info "FlowNote isn't installed (no flownote package, nothing in ~/.local)."
  echo "FlowNote isn't installed (no flownote package, nothing in ~/.local)."
  [ "$REMOVE_DATA" = yes ] && exit 0
  exit 1
fi

what="$(printf '  • %s\n' "${found[@]}")"
ui_confirm "Remove FlowNote from this computer?

This removes:
$what" yes || ui_cancelled

if [ -d "$APP_DATA_DIR" ] && [ "$REMOVE_DATA" = ask ]; then
  if [ "$UI_MODE" = silent ]; then
    REMOVE_DATA=no
  elif ui_confirm "Also delete your notes and attachments?

They're in $APP_DATA_DIR.
This cannot be undone. Keep them if you might reinstall FlowNote later." no; then
    REMOVE_DATA=yes
  else
    REMOVE_DATA=no
  fi
fi

# Close FlowNote first, so it can't write to its data while that's deleted.
stop_flownote

if deb_installed; then
  [ "$UI_MODE" = tty ] && note "sudo may ask for your password."
  ui_run "Removing the flownote package" as_root env DEBIAN_FRONTEND=noninteractive apt-get remove -y flownote ||
    die "Removing the flownote system package failed (wrong password, or apt is busy?)."
fi

remove_appimage() {
  rm -rf "$INSTALL_DIR"
  rm -f "$BIN_FILE" "$DESKTOP_FILE" "$HICOLOR_ICON"
  refresh_desktop_caches
}
if appimage_installed; then
  ui_run "Removing the install for $(id -un)" remove_appimage
fi

if [ -d "$APP_DATA_DIR" ]; then
  if [ "$REMOVE_DATA" = yes ]; then
    say "Deleting your FlowNote data ($APP_DATA_DIR)"
    rm -rf "$APP_DATA_DIR"
    rmdir "$(dirname "$APP_DATA_DIR")" 2>/dev/null || true
    kept=""
  else
    say "Your notes were kept in $APP_DATA_DIR (reinstalling picks them back up)."
    kept=$'\n\n'"Your notes were kept in $APP_DATA_DIR — reinstalling FlowNote picks them back up."
  fi
else
  kept=""
fi

say "FlowNote is uninstalled."
[ "$UI_MODE" = gui ] && ui_info "FlowNote is uninstalled.${kept}"
exit 0
