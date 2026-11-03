#!/bin/sh
# Build a local, model-independent AppKit recovery utility.
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app="${1:-$HOME/Applications/Резервный мост ИИ.app}"
mkdir -p "$app/Contents/MacOS"
build_dir=$(mktemp -d /tmp/neo3-switcher.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
swiftc "$source_dir/ProxySwitch.swift" -framework AppKit -o "$build_dir/ProxySwitch"
install -m 755 "$build_dir/ProxySwitch" "$app/Contents/MacOS/ProxySwitch"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ProxySwitch</string>
<key>CFBundleIdentifier</key><string>ru.neo3.proxy-switcher</string>
<key>CFBundleName</key><string>Резервный мост ИИ</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$app"
printf '%s\n' "$app"
