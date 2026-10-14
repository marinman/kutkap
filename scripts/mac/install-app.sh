#!/bin/bash
# Builds Kutkap.app in ~/Applications and puts a shortcut on the Desktop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP="$HOME/Applications/Kutkap.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$HOME/.kutkap"
echo "$REPO_DIR" >"$HOME/.kutkap/repo-path"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$SCRIPT_DIR/launch.sh" "$APP/Contents/MacOS/Kutkap"
chmod +x "$APP/Contents/MacOS/Kutkap"

python3 -I "$SCRIPT_DIR/make-icon.py" "$WORK/icon.png"
ICONSET="$WORK/Kutkap.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
	sips -z $size $size "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
	double=$((size * 2))
	sips -z $double $double "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Kutkap.icns"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Kutkap</string>
	<key>CFBundleDisplayName</key><string>Kutkap</string>
	<key>CFBundleIdentifier</key><string>com.marinman.kutkap</string>
	<key>CFBundleExecutable</key><string>Kutkap</string>
	<key>CFBundleIconFile</key><string>Kutkap</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.1.0</string>
	<key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

touch "$APP"
ln -sfn "$APP" "$HOME/Desktop/Kutkap"
echo "Installed $APP (Desktop shortcut: ~/Desktop/Kutkap)"
