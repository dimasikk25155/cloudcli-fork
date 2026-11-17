#!/bin/sh
# Собирает «Пульт моста.app» (окно без ИИ и терминала) и кладёт ссылку на рабочий стол.
# В имени нет «ИИ» нарочно: off.sh убирает с рабочего стола старый пульт `*мост*ИИ*`.
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app="${1:-$HOME/Applications/Пульт моста.app}"
build_dir=$(mktemp -d /tmp/neo3-bridge-pult.XXXXXX)
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
swiftc -O "$source_dir/BridgePult.swift" -framework AppKit -o "$build_dir/BridgePult"
swiftc "$source_dir/make-icon.swift" -framework AppKit -o "$build_dir/make-icon"
"$build_dir/make-icon" "$build_dir/icon.png"
iconset="$build_dir/AppIcon.iconset"
mkdir -p "$iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$build_dir/icon.png" --out "$iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d "$build_dir/icon.png" --out "$iconset/icon_${s}x${s}@2x.png" >/dev/null
done
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"
install -m 755 "$build_dir/BridgePult" "$app/Contents/MacOS/BridgePult"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BridgePult</string>
<key>CFBundleIdentifier</key><string>ru.neo3.bridge-pult</string>
<key>CFBundleName</key><string>Пульт моста</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>2.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$app"
if [ -z "${1:-}" ]; then
  ln -sfn "$app" "$HOME/Desktop/Пульт моста.app"
fi
printf '%s\n' "$app"
