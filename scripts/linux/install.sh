#!/usr/bin/env bash
# Builds FlowNote from this source tree and installs it on the current
# Linux machine. Two install paths, matching electron-builder.yml's two
# `linux.target` outputs:
#   1. .deb via apt/dpkg (default, when both are on PATH) — registers a
#      normal system package: shows up in the software center / `apt list
#      --installed`, and `scripts/linux/uninstall.sh` removes it with
#      `apt remove`.
#   2. .AppImage under ~/.local (--appimage, or automatic fallback when
#      apt/dpkg aren't available) — no root needed; installs a desktop
#      entry + launcher symlink under the current user's home directory.
#
# Either way this rebuilds all three pieces electron-builder.yml's own
# comment describes (frontend, Electron main process, Rust sidecar) before
# packaging — see that file and apps/electron/package.json's "package"
# script, which this mirrors instead of replaces.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FORCE_APPIMAGE=0
for arg in "$@"; do
  case "$arg" in
    --appimage)
      FORCE_APPIMAGE=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/linux/install.sh [--appimage]

Builds FlowNote and installs it for this machine/user.

  --appimage   Install the AppImage under ~/.local instead of building/
               installing the .deb, even if apt/dpkg are available.

Requires pnpm, node, and cargo on PATH. The .deb path additionally needs
sudo (installing a system package + desktop entry); the AppImage path
needs neither root nor apt/dpkg.
EOF
      exit 0
      ;;
    *)
      echo "error: unknown argument '$arg' (see --help)" >&2
      exit 1
      ;;
  esac
done

for tool in pnpm node cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required but not found on PATH" >&2
    exit 1
  fi
done

echo "==> Installing workspace dependencies"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile)

echo "==> Building frontend"
pnpm --dir "$REPO_ROOT" --filter @flownote/frontend run build

echo "==> Building Electron main process"
pnpm --dir "$REPO_ROOT" --filter @flownote/electron run build

echo "==> Building the flownote-electron sidecar (release)"
(cd "$REPO_ROOT" && cargo build --release -p flownote-electron)

echo "==> Packaging (.deb + .AppImage)"
(cd "$REPO_ROOT/apps/electron" && pnpm exec electron-builder --linux)

RELEASE_DIR="$REPO_ROOT/apps/electron/release"
DEB_FILE="$(find "$RELEASE_DIR" -maxdepth 1 -name '*.deb' | head -n1)"
APPIMAGE_FILE="$(find "$RELEASE_DIR" -maxdepth 1 -name '*.AppImage' | head -n1)"

use_appimage=0
if [ "$FORCE_APPIMAGE" -eq 1 ]; then
  use_appimage=1
elif ! command -v dpkg >/dev/null 2>&1 || ! command -v apt >/dev/null 2>&1; then
  use_appimage=1
fi

if [ "$use_appimage" -eq 0 ]; then
  if [ -z "$DEB_FILE" ]; then
    echo "error: expected a .deb under $RELEASE_DIR, none found" >&2
    exit 1
  fi
  echo "==> Installing $DEB_FILE via apt (sudo required)"
  # `apt install ./file.deb` (not `dpkg -i`) also resolves/installs the
  # runtime deps electron-builder.yml declares (libgtk-3-0, libnss3, ...).
  sudo apt install -y "$DEB_FILE"
  echo "==> Installed. Launch FlowNote from your app menu, or run: flownote"
else
  if [ -z "$APPIMAGE_FILE" ]; then
    echo "error: expected an .AppImage under $RELEASE_DIR, none found" >&2
    exit 1
  fi
  INSTALL_DIR="$HOME/.local/opt/flownote"
  BIN_DIR="$HOME/.local/bin"
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

  echo "==> Installing AppImage to $INSTALL_DIR (no root needed)"
  cp "$APPIMAGE_FILE" "$INSTALL_DIR/FlowNote.AppImage"
  chmod +x "$INSTALL_DIR/FlowNote.AppImage"
  ln -sf "$INSTALL_DIR/FlowNote.AppImage" "$BIN_DIR/flownote"

  cat > "$DESKTOP_DIR/flownote.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=FlowNote
Comment=Canvas note-taking app
Exec=$INSTALL_DIR/FlowNote.AppImage %U
Terminal=false
Categories=Office;
EOF

  if [ ":$PATH:" != *":$BIN_DIR:"* ]; then
    echo "note: $BIN_DIR isn't on your PATH — add it to your shell profile to run 'flownote' directly,"
    echo "      or launch FlowNote from your app menu (desktop entry installed at $DESKTOP_DIR/flownote.desktop)."
  fi
  echo "==> Installed. Launch FlowNote from your app menu, or run: $BIN_DIR/flownote"
fi
