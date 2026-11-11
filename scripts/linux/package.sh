#!/usr/bin/env bash
# Builds FlowNote's Linux release bundle from this source tree, from a clean
# slate:
#
#   dist-release/FlowNote-<ver>-linux-x86_64/       the bundle folder
#     FlowNote-<ver>-amd64.deb                      system package
#     FlowNote-<ver>-x86_64.AppImage                runs anywhere, no root
#     install.sh  uninstall.sh  lib/ui.sh           (packaging/linux/)
#     README.txt  RELEASE-NOTICE.txt  VERSION
#     docs/FlowNote-Guide.{pdf,docx}
#     SHA256SUMS
#   dist-release/FlowNote-<ver>-linux-x86_64.tar.gz the bundle, archived
#   dist-release/FlowNote-<ver>-linux-x86_64.run    self-extracting installer
#
# Steps: clean old outputs -> sync VERSION into the manifests -> pnpm
# install -> build frontend, Electron main, Rust sidecar -> electron-builder
# -> assemble -> checksum -> archive. See --help.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CLEAN=1
INSTALL_DEPS=1
usage() {
  cat <<'EOF'
Usage: scripts/linux/package.sh [--no-clean] [--skip-install]

Builds the FlowNote Linux release bundle into dist-release/.

  --no-clean       Keep previous build outputs (faster incremental rebuild).
                   By default every build output is deleted first, so the
                   bundle is built from a clean slate.
  --skip-install   Don't run `pnpm install --frozen-lockfile` first.

Requires pnpm, node and cargo on PATH. The guide (FlowNote-Guide.pdf/.docx)
is taken from docs/ (regenerate it with `pnpm docs`).
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) CLEAN=1 ;;
    --no-clean) CLEAN=0 ;;
    --skip-install) INSTALL_DEPS=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }

for tool in pnpm node cargo tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: '$tool' is required but not found on PATH" >&2; exit 1; }
done

# Everything below uses paths relative to the repo root.
cd "$REPO_ROOT"
[ -f VERSION ] && [ -f pnpm-workspace.yaml ] || { echo "error: $REPO_ROOT doesn't look like the FlowNote repo" >&2; exit 1; }
VERSION="$(tr -d '[:space:]' <VERSION)"
[ -n "$VERSION" ] || { echo "error: VERSION is empty" >&2; exit 1; }
NAME="FlowNote-${VERSION}-linux-x86_64"
BUNDLE="dist-release/${NAME:?}"

if [ "$CLEAN" -eq 1 ]; then
  step "Cleaning previous build outputs"
  rm -rf packages/frontend/dist apps/electron/dist apps/electron/release dist-release
  rm -f target/release/flownote-electron
fi

step "Setting version $VERSION"
node scripts/sync-version.mjs

if [ "$INSTALL_DEPS" -eq 1 ]; then
  step "Installing workspace dependencies"
  pnpm install --frozen-lockfile
fi

step "Building the frontend"
pnpm --filter @flownote/frontend run build

step "Building the Electron main process"
pnpm --filter @flownote/electron run build

step "Building the flownote-electron sidecar (release)"
cargo build --release -p flownote-electron

step "Packaging (.deb + AppImage)"
(cd apps/electron && pnpm exec electron-builder --linux --publish never)

step "Assembling $NAME"
if [ -d "$BUNDLE" ]; then rm -r "$BUNDLE"; fi
mkdir -p "$BUNDLE/lib" "$BUNDLE/docs"
deb="$(ls -t apps/electron/release/FlowNote-"$VERSION"-*.deb | head -n1)"
appimage="$(ls -t apps/electron/release/FlowNote-"$VERSION"-*.AppImage | head -n1)"
cp "$deb" "$appimage" "$BUNDLE/"
cp packaging/linux/install.sh packaging/linux/uninstall.sh packaging/linux/README.txt "$BUNDLE/"
cp packaging/linux/lib/ui.sh "$BUNDLE/lib/"
cp packaging/RELEASE-NOTICE.txt "$BUNDLE/"
echo "$VERSION" >"$BUNDLE/VERSION"
for guide in FlowNote-Guide.{pdf,docx}; do
  if [ -f "docs/$guide" ]; then cp "docs/$guide" "$BUNDLE/docs/"
  else echo "warning: docs/$guide is missing (run: pnpm docs); the bundle won't include it" >&2
  fi
done
chmod 755 "$BUNDLE/install.sh" "$BUNDLE/uninstall.sh" "$BUNDLE"/*.AppImage
chmod 644 "$BUNDLE"/*.deb "$BUNDLE"/*.txt "$BUNDLE/VERSION" "$BUNDLE/lib/ui.sh"
chmod 644 "$BUNDLE"/docs/* 2>/dev/null || true

step "Writing SHA256SUMS"
(cd "$BUNDLE" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs -d '\n' sha256sum >SHA256SUMS)

step "Archiving"
tar -C dist-release --owner=0 --group=0 -czf "dist-release/$NAME.tar.gz" "$NAME"
cat packaging/linux/run-stub.sh "dist-release/$NAME.tar.gz" >"dist-release/$NAME.run"
chmod 755 "dist-release/$NAME.run"
(cd dist-release && sha256sum "$NAME.tar.gz" "$NAME.run" >"$NAME.sha256")

step "Done"
ls -lh dist-release
cat <<EOF

Install:    $REPO_ROOT/dist-release/$NAME.run   (double-click, or run in a terminal)
  or:       tar xzf $NAME.tar.gz && $NAME/install.sh
Uninstall:  $NAME/uninstall.sh
EOF
