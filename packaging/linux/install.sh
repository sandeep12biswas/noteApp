#!/usr/bin/env bash
# FlowNote installer for Linux.
#
# Installs FlowNote from the prebuilt packages next to this script (the
# release bundle: FlowNote-<version>-amd64.deb and FlowNote-<version>-
# x86_64.AppImage), or from --from DIR. Nothing is built here;
# scripts/linux/package.sh builds the bundle from source.
#
# Two ways to install:
#   System (.deb)       a normal system package in /opt/FlowNote with a
#                       `flownote` command and an app-menu entry, for every
#                       user. Needs an administrator password. Default on
#                       Debian/Ubuntu.
#   Just me (AppImage)  no root: ~/.local/opt/flownote, a `flownote`
#                       launcher in ~/.local/bin and an app-menu entry.
#                       Works on any distro.
#
# Run it from a terminal for a guided text install, double-click it (or
# the .run installer) for a graphical one (zenity or kdialog), or pass
# --silent to install with no questions. See --help.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ui.sh
. "$SCRIPT_DIR/lib/ui.sh"

FROM="$SCRIPT_DIR"
MODE=auto
UI_WANT=auto
LAUNCH=ask

usage() {
  cat <<'EOF'
Usage: install.sh [--deb | --appimage] [--silent] [--gui | --cli] [--from DIR]

Installs FlowNote from the prebuilt .deb / .AppImage in this folder.

  --deb          System install: the .deb package (needs sudo/admin password).
  --appimage     Install the AppImage for this user only (no root needed).
  -y, --silent   Don't ask anything; use the defaults (and the flags above).
  --gui          Use graphical dialogs (zenity or kdialog) even in a terminal.
  --cli          Use terminal prompts only.
  --launch       Start FlowNote when the install finishes.
  --no-launch    Don't offer to start it.
  --from DIR     Look for the packages in DIR instead of next to this script.

Without --deb/--appimage you're asked; the default (and the --silent
choice) is the .deb when apt and dpkg are available, otherwise the
AppImage. Remove FlowNote again with ./uninstall.sh.
A log of every install is kept in ~/.cache/flownote-install.log.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) MODE=deb ;;
    --appimage) MODE=appimage ;;
    -y|--silent|--yes) UI_WANT=silent ;;
    --gui) UI_WANT=gui ;;
    --cli|--no-gui) UI_WANT=tty ;;
    --launch) LAUNCH=yes ;;
    --no-launch) LAUNCH=no ;;
    --from)
      [ $# -ge 2 ] || { echo "error: --from needs a directory" >&2; exit 2; }
      FROM="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# Told how to install, without a terminal: a script — don't open dialogs.
if [ "$UI_WANT" = auto ] && [ "$MODE" != auto ]; then UI_WANT=script; fi
ui_init "$UI_WANT"

newest() { # newest file matching a glob in $FROM, or nothing (never fails)
  { find "$FROM" -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' 2>/dev/null || true; } | sort -rn | head -n1 | cut -d' ' -f2-
}

[ -d "$FROM" ] || die "$FROM is not a folder."
[ "$(uname -m)" = "x86_64" ] || die "These packages are built for 64-bit PCs (x86_64); this machine is $(uname -m)."

DEB="$(newest 'FlowNote-*.deb')"
APPIMAGE="$(newest 'FlowNote-*.AppImage')"
[ -n "$DEB$APPIMAGE" ] || die "No FlowNote-*.deb or FlowNote-*.AppImage found in $FROM."

# The version being installed: the bundle's VERSION file, else the file name.
if [ -f "$FROM/VERSION" ]; then
  NEW_VERSION="$(tr -d '[:space:]' <"$FROM/VERSION")"
else
  NEW_VERSION="$(basename "${APPIMAGE:-$DEB}" | sed -E 's/^FlowNote-([0-9][^-_]*)[-_].*/\1/')"
fi

has_apt() { command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; }

INSTALL_DIR="$HOME/.local/opt/flownote"
BIN_DIR="$HOME/.local/bin"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_FILE="$DATA_HOME/applications/flownote.desktop"
ICON_FILE="$INSTALL_DIR/flownote.png"
HICOLOR_ICON="$DATA_HOME/icons/hicolor/512x512/apps/flownote.png"

installed_deb_version() {
  command -v dpkg-query >/dev/null 2>&1 || return 0
  [ "$(dpkg-query -W -f='${Status}' flownote 2>/dev/null || true)" = "install ok installed" ] || return 0
  dpkg-query -W -f='${Version}' flownote 2>/dev/null || true
}
installed_appimage_version() {
  [ -e "$INSTALL_DIR/FlowNote.AppImage" ] || return 0
  if [ -f "$INSTALL_DIR/VERSION" ]; then cat "$INSTALL_DIR/VERSION"; else echo "unknown"; fi
}

# ---------------------------------------------------------------- welcome
ui_info "Welcome to the FlowNote $NEW_VERSION installer.

FlowNote is a note-taking app with a free-form canvas: click anywhere on the page and start writing.

This will install FlowNote on this computer. Your existing notes, if any, are kept."

ui_text_page "$FROM/RELEASE-NOTICE.txt" "Continue"

# ---------------------------------------------------------- install type
if [ "$MODE" = auto ]; then
  default=appimage
  if has_apt && [ -n "$DEB" ]; then default=deb; fi
  options=()
  if [ -n "$DEB" ] && has_apt; then
    options+=(deb "For everyone on this computer (system package, needs your password)")
  fi
  if [ -n "$APPIMAGE" ]; then
    options+=(appimage "Just for me ($(id -un)), no password needed")
  fi
  if [ "${#options[@]}" -eq 2 ]; then
    MODE="$default"
  else
    MODE="$(ui_choose "How do you want to install FlowNote?" "$default" "${options[@]}")"
  fi
fi

case "$MODE" in
  deb)
    [ -n "$DEB" ] || die "No FlowNote-*.deb in $FROM; install with --appimage instead."
    has_apt || die "The system install needs apt (Debian, Ubuntu, Mint, ...). Use the 'just for me' (AppImage) install instead."
    ;;
  appimage)
    [ -n "$APPIMAGE" ] || die "No FlowNote-*.AppImage in $FROM."
    ;;
  *) die "unknown install type '$MODE'" ;;
esac

# --------------------------------------------------- upgrade / reinstall
if [ "$MODE" = deb ]; then CURRENT="$(installed_deb_version)"; else CURRENT="$(installed_appimage_version)"; fi
if [ -n "$CURRENT" ]; then
  if [ "$CURRENT" = "$NEW_VERSION" ]; then
    ui_confirm "FlowNote $CURRENT is already installed. Reinstall (repair) it?" yes || ui_cancelled
  else
    ui_confirm "FlowNote $CURRENT is installed. Upgrade it to $NEW_VERSION? Your notes are kept." yes || ui_cancelled
  fi
  log "existing install: $CURRENT -> $NEW_VERSION"
fi

stop_flownote

# ------------------------------------------------------------------- .deb
install_deb() {
  local deb tmp_deb
  deb="$(cd "$(dirname "$DEB")" && pwd)/$(basename "$DEB")"
  # apt-get (unlike dpkg -i) also installs the libraries the package needs.
  # The _apt user must be able to read the file, so install from a copy in /tmp.
  tmp_deb="$(mktemp --suffix=.deb)"
  cp "$deb" "$tmp_deb"
  chmod 644 "$tmp_deb"
  [ "$UI_MODE" = tty ] && note "sudo may ask for your password."
  if ! ui_run "Installing $(basename "$deb")" as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$tmp_deb"; then
    rm -f "$tmp_deb"
    die "Installing the system package failed (wrong password, or apt is busy?)."
  fi
  rm -f "$tmp_deb"
  LAUNCHER="flownote"
}

# --------------------------------------------------------------- AppImage
# AppImages mount themselves with FUSE 2. Where that doesn't work — no
# libfuse2 (newer distros don't install it), no /dev/fuse (containers,
# sandboxes) — the AppImage can still run by unpacking itself to a temporary
# folder first: slower to start, same app. Rather than guess from what's
# installed, try mounting it: --appimage-mount stays up while mounted and
# exits at once when it can't mount.
fuse_works() {
  local pid
  "$INSTALL_DIR/FlowNote.AppImage" --appimage-mount >/dev/null 2>&1 &
  pid=$!
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null || true
    return 0
  fi
  wait "$pid" 2>/dev/null || true
  return 1
}

# (Called through ui_run, where `set -e` doesn't apply: every step is
# checked explicitly.)
copy_appimage() {
  mkdir -p "$INSTALL_DIR/lib" "$BIN_DIR" "$(dirname "$DESKTOP_FILE")" || return 1
  cp "$APPIMAGE" "$INSTALL_DIR/FlowNote.AppImage.new" || return 1
  chmod 755 "$INSTALL_DIR/FlowNote.AppImage.new" || return 1
  mv -f "$INSTALL_DIR/FlowNote.AppImage.new" "$INSTALL_DIR/FlowNote.AppImage" || return 1
  echo "$NEW_VERSION" >"$INSTALL_DIR/VERSION" || return 1
  # Ship the uninstaller with the install, so it can be removed later
  # without the original download.
  if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
    cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh" || return 1
    cp "$SCRIPT_DIR/lib/ui.sh" "$INSTALL_DIR/lib/ui.sh" || return 1
  fi
  chmod 755 "$INSTALL_DIR/uninstall.sh"
}

# The app icon, from inside the AppImage. Best effort: if anything here
# fails, the menu entry just shows a generic icon. (The top-level .png is a
# symlink into usr/share/icons, so extract both and follow the link.)
extract_icon() {
  local dir icon
  dir="$(mktemp -d)"
  (
    cd "$dir" &&
      "$INSTALL_DIR/FlowNote.AppImage" --appimage-extract '*.png' >/dev/null 2>&1 &&
      "$INSTALL_DIR/FlowNote.AppImage" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1 &&
      icon="$(find squashfs-root -maxdepth 1 -name '*.png' | head -n1)" &&
      [ -n "$icon" ] && cp -L "$icon" "$ICON_FILE"
  ) || rm -f "$ICON_FILE"
  rm -rf "$dir"
  if [ -f "$ICON_FILE" ]; then
    mkdir -p "$(dirname "$HICOLOR_ICON")"
    cp "$ICON_FILE" "$HICOLOR_ICON"
  fi
}

install_appimage() {
  ui_run "Copying FlowNote to $INSTALL_DIR" copy_appimage || die "Copying FlowNote to $INSTALL_DIR failed."

  local fuse_env=""
  if ! fuse_works; then
    fuse_env="APPIMAGE_EXTRACT_AND_RUN=1"
    note "this system can't mount AppImages (FUSE 2), so FlowNote will unpack itself on each start."
    note "For faster starts: sudo apt install libfuse2t64   (Ubuntu 24.04+; libfuse2 on older), then run install.sh again."
  fi

  # The `flownote` command: a small launcher, not a symlink, so it can carry
  # the FUSE fallback above and the sandbox fallback below.
  #
  # Chromium's sandbox needs unprivileged user namespaces, or else a
  # setuid-root chrome-sandbox helper. An AppImage can't ship a setuid
  # helper, so where user namespaces are blocked — Ubuntu 24.04+ (AppArmor's
  # kernel.apparmor_restrict_unprivileged_userns), or kernels with them
  # turned off — Electron aborts at launch ("The SUID sandbox helper binary
  # was found, but is not configured correctly"). There, and only there,
  # start it with --no-sandbox. Checked on every start, so it follows the
  # system's current setting. (The .deb doesn't need this: it installs the
  # helper setuid root.)
  cat >"$BIN_DIR/flownote" <<EOF
#!/bin/sh
# FlowNote launcher — installed by FlowNote's install.sh; removed by uninstall.sh.
${fuse_env:+export $fuse_env}
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] ||
   [ "\$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] ||
   [ "\$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ]; then
  set -- --no-sandbox "\$@"
fi
exec "$INSTALL_DIR/FlowNote.AppImage" "\$@"
EOF
  chmod 755 "$BIN_DIR/flownote"

  ui_run "Adding FlowNote to the app menu" extract_icon || true

  cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=FlowNote
Comment=Canvas note-taking app
Exec=$BIN_DIR/flownote %U
Icon=$([ -f "$ICON_FILE" ] && echo flownote || echo accessories-text-editor)
Terminal=false
Categories=Office;TextEditor;
Keywords=notes;notebook;canvas;writing;
StartupWMClass=FlowNote
X-FlowNote-Version=$NEW_VERSION
EOF
  refresh_desktop_caches

  case ":$PATH:" in
    *":$BIN_DIR:"*) LAUNCHER="flownote" ;;
    *)
      note "$BIN_DIR isn't on your PATH; open FlowNote from the app menu, or run $BIN_DIR/flownote"
      LAUNCHER="$BIN_DIR/flownote"
      ;;
  esac
}

LAUNCHER=flownote
if [ "$MODE" = deb ]; then install_deb; else install_appimage; fi

if [ "$MODE" = deb ]; then
  WHERE="for everyone on this computer (in /opt/FlowNote)"
  HOW_TO_REMOVE="./uninstall.sh  (or: sudo apt remove flownote)"
else
  WHERE="for $(id -un) (in $INSTALL_DIR)"
  HOW_TO_REMOVE="$INSTALL_DIR/uninstall.sh"
fi
say "FlowNote $NEW_VERSION is installed $WHERE. Open it from your app menu, or run: flownote"

# ------------------------------------------------------------------ finish
DONE_TEXT="FlowNote $NEW_VERSION is installed $WHERE.

Open it any time from your app menu, or run: flownote
To uninstall: $HOW_TO_REMOVE"
if [ "$UI_MODE" != silent ] && [ "$LAUNCH" = ask ]; then
  if ui_confirm "$DONE_TEXT

Start FlowNote now?" yes; then LAUNCH=yes; else LAUNCH=no; fi
elif [ "$UI_MODE" = gui ]; then
  ui_info "$DONE_TEXT"
fi

if [ "$LAUNCH" = yes ]; then
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    note "not starting FlowNote as root; open it from your app menu."
  else
    log "launching $LAUNCHER"
    (setsid "$LAUNCHER" >/dev/null 2>&1 &) || true
  fi
fi
exit 0
