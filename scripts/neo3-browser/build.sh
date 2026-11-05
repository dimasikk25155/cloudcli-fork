#!/bin/sh
# Builds the invisible Neo3 browser helper into a stable path. The bundle id
# `ru.neo3.browser` is embedded (Info.plist in __TEXT,__info_plist): WebKit keys the
# persistent login store (~/Library/WebKit/ru.neo3.browser, ~/Library/HTTPStorages) to it.
# Rebuilds only when a source is newer than the binary.
# Usage: scripts/neo3-browser/build.sh [--force]
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${NEO3_BROWSER_BIN:-$HOME/.cloudcli/bin/neo3-browser}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "neo3-browser: only macOS" >&2
  exit 0
fi

if [ "${1:-}" != "--force" ] && [ -x "$OUT" ] \
  && [ ! "$DIR/main.swift" -nt "$OUT" ] && [ ! "$DIR/Info.plist" -nt "$OUT" ]; then
  echo "neo3-browser: up to date ($OUT)"
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
TMP="$OUT.build.$$"
trap 'rm -f "$TMP"' EXIT
swiftc -O -swift-version 5 "$DIR/main.swift" \
  -framework AppKit -framework WebKit \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$DIR/Info.plist" \
  -o "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT
echo "neo3-browser: built $OUT"
