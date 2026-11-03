#!/usr/bin/env bash
# Builds FlowNote from this source tree and installs it on the current
# Linux machine. Building is done here; installing is packaging/linux/
# install.sh — the same script shipped with the prebuilt packages — run on
# the fresh build. Two install paths, matching electron-builder.yml's two
# `linux.target` outputs:
#   1. .deb via apt/dpkg (default, when both are on PATH) — registers a
#      normal system package: shows up in the software center / `apt list
#      --installed`, and `scripts/linux/uninstall.sh` removes it with
#      `apt remove`.
#   2. .AppImage under ~/.local (--appimage, or automatic fallback when
#      apt/dpkg aren't available) — no root needed; installs a desktop
#      entry + `flownote` launcher under the current user's home directory.
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
INSTALL_ARGS=(--from "$RELEASE_DIR")
[ "$FORCE_APPIMAGE" -eq 1 ] && INSTALL_ARGS+=(--appimage)
exec "$REPO_ROOT/packaging/linux/install.sh" "${INSTALL_ARGS[@]}"
