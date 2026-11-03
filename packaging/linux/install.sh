#!/usr/bin/env bash
# Installs FlowNote on Linux from the prebuilt packages next to this script
# (the `flownote-linux` CI artifact: FlowNote-<version>-x86_64.AppImage and
# FlowNote-<version>-amd64.deb), or from --from DIR. Nothing is built.
# scripts/linux/install.sh builds those packages from source, then runs this.
#
# Two ways to install:
#   .deb      (default when apt and dpkg exist) — a normal system package in
#             /opt/FlowNote with a `flownote` command and an app-menu entry.
#             Needs sudo. Removed by uninstall.sh or `sudo apt remove flownote`.
#   AppImage  (--appimage, or when there's no apt/dpkg) — just for this user,
#             no root: ~/.local/opt/flownote, a `flownote` launcher in
#             ~/.local/bin and an app-menu entry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FROM="$SCRIPT_DIR"
MODE=auto

usage() {
  cat <<'EOF'
Usage: install.sh [--deb | --appimage] [--from DIR]

Installs FlowNote from the prebuilt .deb / .AppImage in this folder.

  --deb        Install the .deb system package (needs sudo).
  --appimage   Install the AppImage for this user only (no root needed).
  --from DIR   Look for the packages in DIR instead of next to this script.

Without --deb/--appimage: the .deb when apt and dpkg are available,
otherwise the AppImage. Uninstall with ./uninstall.sh.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) MODE=deb ;;
    --appimage) MODE=appimage ;;
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

newest() { # newest file matching a glob in $FROM, or nothing (never fails)
  { find "$FROM" -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' 2>/dev/null || true; } | sort -rn | head -n1 | cut -d' ' -f2-
}

[ -d "$FROM" ] || { echo "error: $FROM is not a folder" >&2; exit 1; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

if [ "$(uname -m)" != "x86_64" ]; then
  echo "error: these packages are built for x86_64; this machine is $(uname -m)." >&2
  exit 1
fi

if [ "$MODE" = auto ]; then
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1 && [ -n "$(newest 'FlowNote-*.deb')" ]; then
    MODE=deb
  else
    MODE=appimage
  fi
fi

if [ "$MODE" = deb ]; then
  DEB="$(newest 'FlowNote-*.deb')"
  [ -n "$DEB" ] || { echo "error: no FlowNote-*.deb in $FROM" >&2; exit 1; }
  command -v apt-get >/dev/null 2>&1 || { echo "error: --deb needs apt-get (Debian/Ubuntu); try --appimage" >&2; exit 1; }
  DEB="$(cd "$(dirname "$DEB")" && pwd)/$(basename "$DEB")"
  echo "==> Installing $(basename "$DEB") (sudo may ask for your password)"
  # apt-get (unlike dpkg -i) also installs the libraries the package needs.
  # The _apt user must be able to read the file, so install from a copy in /tmp.
  TMP_DEB="$(mktemp --suffix=.deb)"
  cp "$DEB" "$TMP_DEB"
  chmod 644 "$TMP_DEB"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$TMP_DEB"
  rm -f "$TMP_DEB"
  echo "==> FlowNote is installed. Open it from your app menu, or run: flownote"
  exit 0
fi

APPIMAGE="$(newest 'FlowNote-*.AppImage')"
[ -n "$APPIMAGE" ] || { echo "error: no FlowNote-*.AppImage in $FROM" >&2; exit 1; }

INSTALL_DIR="$HOME/.local/opt/flownote"
BIN_DIR="$HOME/.local/bin"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_FILE="$DATA_HOME/applications/flownote.desktop"
ICON_FILE="$INSTALL_DIR/flownote.png"
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$(dirname "$DESKTOP_FILE")"

echo "==> Installing $(basename "$APPIMAGE") to $INSTALL_DIR"
cp "$APPIMAGE" "$INSTALL_DIR/FlowNote.AppImage.new"
chmod 755 "$INSTALL_DIR/FlowNote.AppImage.new"
mv -f "$INSTALL_DIR/FlowNote.AppImage.new" "$INSTALL_DIR/FlowNote.AppImage"

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
FUSE_ENV=""
if ! fuse_works; then
  FUSE_ENV="APPIMAGE_EXTRACT_AND_RUN=1"
  echo "note: this system can't mount AppImages (FUSE 2), so FlowNote will unpack itself on each start."
  echo "      For faster starts: sudo apt install libfuse2t64   (Ubuntu 24.04+; libfuse2 on older), then run install.sh again."
fi

# The `flownote` command: a small launcher, not a symlink, so it can carry
# the FUSE fallback above.
cat > "$BIN_DIR/flownote" <<EOF
#!/bin/sh
# FlowNote launcher — installed by FlowNote's install.sh; removed by uninstall.sh.
${FUSE_ENV:+export $FUSE_ENV}
exec "$INSTALL_DIR/FlowNote.AppImage" "\$@"
EOF
chmod 755 "$BIN_DIR/flownote"

# The app icon, from inside the AppImage. Best effort: if anything here
# fails, the menu entry just shows a generic icon. (The top-level .png is a
# symlink into usr/share/icons, so extract both and follow the link.)
EXTRACT_DIR="$(mktemp -d)"
(
  cd "$EXTRACT_DIR" &&
    "$INSTALL_DIR/FlowNote.AppImage" --appimage-extract '*.png' >/dev/null 2>&1 &&
    "$INSTALL_DIR/FlowNote.AppImage" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1 &&
    icon="$(find squashfs-root -maxdepth 1 -name '*.png' | head -n1)" &&
    [ -n "$icon" ] && cp -L "$icon" "$ICON_FILE"
) || rm -f "$ICON_FILE"
rm -rf "$EXTRACT_DIR"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=FlowNote
Comment=Canvas note-taking app
Exec=$BIN_DIR/flownote %U
Icon=$( [ -f "$ICON_FILE" ] && echo "$ICON_FILE" || echo accessories-text-editor )
Terminal=false
Categories=Office;
StartupWMClass=FlowNote
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: $BIN_DIR isn't on your PATH; open FlowNote from the app menu, or run $BIN_DIR/flownote" ;;
esac
echo "==> FlowNote is installed for $(id -un). Open it from your app menu, or run: flownote"
