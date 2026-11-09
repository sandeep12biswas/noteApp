#!/usr/bin/env bash
# Builds FlowNote from this source tree (scripts/linux/package.sh, a clean
# release build) and installs the result with the bundle's own installer —
# the same install.sh shipped to users. Installer flags pass through, e.g.
#   scripts/linux/install.sh --appimage --silent
# Build flags: --no-clean (incremental build), --skip-install. See
# packaging/linux/install.sh --help for the installer's options.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BUILD_ARGS=()
INSTALL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-clean|--skip-install) BUILD_ARGS+=("$arg") ;;
    -h|--help)
      echo "Usage: scripts/linux/install.sh [--no-clean] [--skip-install] [installer options]"
      echo "Builds the release bundle (scripts/linux/package.sh), then runs its install.sh."
      echo "Installer options:"
      echo
      exec "$REPO_ROOT/packaging/linux/install.sh" --help
      ;;
    *) INSTALL_ARGS+=("$arg") ;;
  esac
done

"$SCRIPT_DIR/package.sh" ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}
VERSION="$(tr -d '[:space:]' <"$REPO_ROOT/VERSION")"
exec "$REPO_ROOT/dist-release/FlowNote-$VERSION-linux-x86_64/install.sh" ${INSTALL_ARGS[@]+"${INSTALL_ARGS[@]}"}
