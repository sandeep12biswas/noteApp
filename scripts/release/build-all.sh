#!/usr/bin/env bash
# Builds FlowNote's Linux and Windows release bundles in parallel:
#
#   Linux    scripts/linux/package.sh, here on this machine
#   Windows  .github/workflows/windows-installer.yml on GitHub Actions
#            (Tauri's NSIS/MSI bundles need Windows), dispatched on the
#            current branch, watched, and its `flownote-windows` artifact
#            downloaded into dist-release/ once it passes
#
# Both bundles ship docs/FlowNote-Guide.{pdf,docx}, so regenerate the guide
# (`pnpm docs`) and commit it BEFORE running this: CI builds from the pushed
# commit, not from your working tree. The script refuses to start when the
# tree is dirty or the branch isn't pushed, so both bundles always come from
# the same commit.
#
# Output (dist-release/):
#   FlowNote-<ver>-linux-x86_64.run / .tar.gz / .sha256   (Linux, local)
#   FlowNote-<ver>-windows-x64.zip / .zip.sha256          (Windows, from CI)
# Logs: build-logs/<timestamp>/{linux.log,windows.log}
#
# gh: on this machine plain `gh` (/snap/bin/gh) silently does nothing, so
# this uses $GH, else /snap/gh/current/gh, else the binary git's credential
# helper points at, else `gh` on PATH. Run it outside the sandbox.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKFLOW=windows-installer.yml
ARTIFACT=flownote-windows

LINUX_ARGS=()
DO_WINDOWS=1
DO_LINUX=1
usage() {
  cat <<'EOF'
Usage: scripts/release/build-all.sh [options]

Builds the Linux bundle locally and the Windows bundle on GitHub Actions,
at the same time, from the current (committed and pushed) commit.

  --no-clean       Pass --no-clean to scripts/linux/package.sh (incremental).
  --skip-install   Pass --skip-install to scripts/linux/package.sh.
  --linux-only     Only build Linux (no CI run).
  --windows-only   Only run the Windows CI build and download it.
  -h, --help       This help.

Environment: GH=/path/to/gh to choose the GitHub CLI binary.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --no-clean) LINUX_ARGS+=(--no-clean) ;;
    --skip-install) LINUX_ARGS+=(--skip-install) ;;
    --linux-only) DO_WINDOWS=0 ;;
    --windows-only) DO_LINUX=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

cd "$REPO_ROOT"
VERSION="$(tr -d '[:space:]' <VERSION)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse HEAD)"
LOGS="build-logs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOGS"

# ------------------------------------------------------------- preflight
step "Preflight: FlowNote $VERSION, $BRANCH @ ${SHA:0:7}"
[ "$BRANCH" != HEAD ] || die "detached HEAD; check out a branch first"
[ -z "$(git status --porcelain)" ] || die "uncommitted changes; commit them (the regenerated guide included) so both bundles come from one commit"
for f in docs/FlowNote-Guide.pdf docs/FlowNote-Guide.docx; do
  [ -s "$f" ] || die "$f is missing; run: pnpm docs"
done
# The guide must be at least as new as its sources.
guide_time="$(git log -1 --format=%ct -- docs/FlowNote-Guide.pdf)"
src_time="$(git log -1 --format=%ct -- docs/guides/flownote-guide.html docs/guides/screenshots)"
[ "${guide_time:-0}" -ge "${src_time:-0}" ] || die "docs/FlowNote-Guide.pdf is older than docs/guides/; run pnpm docs and commit"

GH_BIN=""
if [ "$DO_WINDOWS" -eq 1 ]; then
  if [ -n "${GH:-}" ]; then GH_BIN="$GH"
  elif [ -x /snap/gh/current/gh ]; then GH_BIN=/snap/gh/current/gh
  else
    helper="$(git config --get-regexp 'credential\..*helper' | sed -n 's/.*!\([^ ]*gh\) auth git-credential.*/\1/p' | head -n1)"
    if [ -n "$helper" ] && [ -x "$helper" ]; then GH_BIN="$helper"; else GH_BIN="$(command -v gh || true)"; fi
  fi
  [ -n "$GH_BIN" ] || die "GitHub CLI not found (set GH=/path/to/gh)"
  "$GH_BIN" auth status >/dev/null 2>&1 || die "$GH_BIN is not logged in (or printed nothing: run outside the sandbox)"
  git fetch -q origin "$BRANCH" 2>/dev/null || die "branch $BRANCH isn't on origin; push it first: git push -u origin $BRANCH"
  [ "$(git rev-parse "origin/$BRANCH")" = "$SHA" ] || die "origin/$BRANCH isn't at ${SHA:0:7}; push first"
fi

# ------------------------------------------------------------- windows (CI)
RUN_ID=""
if [ "$DO_WINDOWS" -eq 1 ]; then
  step "Dispatching $WORKFLOW on $BRANCH"
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "$GH_BIN" workflow run "$WORKFLOW" --ref "$BRANCH"
  # The run takes a few seconds to appear; pick the dispatch run for this
  # exact commit created after we asked for it.
  for _ in $(seq 1 30); do
    RUN_ID="$("$GH_BIN" run list --workflow "$WORKFLOW" --branch "$BRANCH" --event workflow_dispatch --limit 10 \
      --json databaseId,headSha,createdAt \
      --jq "[.[] | select(.headSha == \"$SHA\" and .createdAt >= \"$since\")][0].databaseId // empty")"
    [ -n "$RUN_ID" ] && break
    sleep 4
  done
  [ -n "$RUN_ID" ] || die "the dispatched run didn't show up; check: $GH_BIN run list --workflow $WORKFLOW"
  echo "Windows run: $("$GH_BIN" run view "$RUN_ID" --json url --jq .url)"
  ( "$GH_BIN" run watch "$RUN_ID" --exit-status --interval 30 >"$LOGS/windows.log" 2>&1 ) &
  WIN_PID=$!
fi

# ------------------------------------------------------------- linux (local)
if [ "$DO_LINUX" -eq 1 ]; then
  step "Building the Linux bundle locally (log: $LOGS/linux.log)"
  ( ./scripts/linux/package.sh "${LINUX_ARGS[@]}" >"$LOGS/linux.log" 2>&1 ) &
  LINUX_PID=$!
fi

# ------------------------------------------------------------- wait for both
LINUX_OK=1; WIN_OK=1
if [ "$DO_LINUX" -eq 1 ]; then
  if wait "$LINUX_PID"; then echo "Linux bundle: OK"; else LINUX_OK=0; echo "Linux bundle: FAILED (tail of $LOGS/linux.log):"; tail -n 30 "$LOGS/linux.log"; fi
fi
if [ "$DO_WINDOWS" -eq 1 ]; then
  if wait "$WIN_PID"; then
    echo "Windows run $RUN_ID: OK"
  else
    WIN_OK=0
    echo "Windows run $RUN_ID: FAILED. Failed steps:"
    "$GH_BIN" run view "$RUN_ID" --log-failed 2>/dev/null | tail -n 40 || true
  fi
fi

# package.sh (clean mode) deletes dist-release/ first, so download after it.
if [ "$DO_WINDOWS" -eq 1 ] && [ "$WIN_OK" -eq 1 ]; then
  step "Downloading $ARTIFACT into dist-release/"
  mkdir -p dist-release
  dl="$(mktemp -d)"
  "$GH_BIN" run download "$RUN_ID" -n "$ARTIFACT" -D "$dl"
  cp "$dl"/* dist-release/
  rm -rf "$dl"
  (cd dist-release && for s in FlowNote-"$VERSION"-windows-x64.zip.sha256; do sha256sum -c "$s"; done) || WIN_OK=0
fi

step "Summary"
ls -lh dist-release 2>/dev/null || true
[ "$DO_LINUX" -eq 0 ] || echo "Linux:   $([ $LINUX_OK -eq 1 ] && echo OK || echo FAILED)"
[ "$DO_WINDOWS" -eq 0 ] || echo "Windows: $([ $WIN_OK -eq 1 ] && echo OK || echo FAILED)  (run $RUN_ID)"
echo "Logs:    $LOGS/"
[ "$LINUX_OK" -eq 1 ] && [ "$WIN_OK" -eq 1 ]
