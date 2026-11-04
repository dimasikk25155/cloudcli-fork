#!/bin/sh
# Builds the «Safari вживую» helper into a stable path (macOS keys the
# «Запись экрана» grant to it). Rebuilds only when a source is newer than the binary.
# Usage: scripts/safari-capture/build.sh [--force]
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${NEO3_SAFARI_CAPTURE_BIN:-$HOME/.cloudcli/bin/neo3-safari-capture}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "neo3-safari-capture: only macOS" >&2
  exit 0
fi

if [ "${1:-}" != "--force" ] && [ -x "$OUT" ] \
  && [ ! "$DIR/main.swift" -nt "$OUT" ] && [ ! "$DIR/CGVirtualDisplay.h" -nt "$OUT" ]; then
  echo "neo3-safari-capture: up to date ($OUT)"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
TMP="$OUT.build.$$"
trap 'rm -f "$TMP"' EXIT
swiftc -O -swift-version 5 -import-objc-header "$DIR/CGVirtualDisplay.h" "$DIR/main.swift" -o "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT
echo "neo3-safari-capture: built $OUT"
