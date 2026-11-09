#!/bin/sh
# FlowNote self-extracting installer.
#
# This file is a small shell script with the FlowNote release bundle (a
# .tar.gz) appended after the __FLOWNOTE_PAYLOAD__ line. Running it unpacks
# the bundle to a temporary folder and starts the installer in it; every
# argument is passed through (try --help). Built by scripts/linux/package.sh.
#
#   --extract DIR   Just unpack the bundle into DIR (nothing is installed).
set -eu

if [ "${1:-}" = "--extract" ]; then
  [ $# -ge 2 ] || { echo "usage: $0 --extract DIR" >&2; exit 2; }
  mkdir -p "$2"
  line=$(awk '/^__FLOWNOTE_PAYLOAD__$/ { print NR + 1; exit }' "$0")
  tail -n +"$line" "$0" | tar -xzf - -C "$2" --strip-components=1
  echo "Unpacked to $2"
  exit 0
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/flownote-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM
line=$(awk '/^__FLOWNOTE_PAYLOAD__$/ { print NR + 1; exit }' "$0")
tail -n +"$line" "$0" | tar -xzf - -C "$tmp" --strip-components=1

# Double-clicked from a file manager (no terminal): use graphical dialogs.
if [ -t 0 ]; then
  bash "$tmp/install.sh" "$@"
else
  bash "$tmp/install.sh" --gui "$@"
fi
exit $?
__FLOWNOTE_PAYLOAD__
