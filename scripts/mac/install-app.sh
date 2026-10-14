#!/bin/bash
# Builds Kutkap.app in ~/Applications and puts a shortcut on the Desktop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP="$HOME/Applications/Kutkap.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Python service for Reel Templates and word-timed captions. It is copied out of the
# repo because macOS blocks apps launched from Finder from reading ~/Downloads,
# ~/Desktop and ~/Documents, where the repo may live.
REELS_DIR="$HOME/Library/Application Support/Kutkap/reel-templates"
mkdir -p "$REELS_DIR"
rsync -a --delete --exclude .venv --exclude __pycache__ "$REPO_DIR/apps/reel-templates/" "$REELS_DIR/app/"
for tool in python3.12 ffmpeg tesseract; do
	command -v "$tool" >/dev/null || { echo "Missing $tool. Install it with: brew install ${tool/python3.12/python@3.12}"; exit 1; }
done
if [ ! -x "$REELS_DIR/.venv/bin/uvicorn" ]; then
	echo "Setting up the Reel Templates service (one time)…"
	python3.12 -m venv "$REELS_DIR/.venv"
fi
"$REELS_DIR/.venv/bin/pip" install -q --upgrade pip
"$REELS_DIR/.venv/bin/pip" install -q -r "$REELS_DIR/app/requirements.txt"

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
# A Finder alias (unlike a symlink) shows the app icon on the Desktop.
rm -f "$HOME/Desktop/Kutkap"
osascript \
	-e "tell application \"Finder\" to make alias file to (POSIX file \"$APP\" as alias) at (path to desktop folder)" \
	-e 'tell application "Finder" to set name of result to "Kutkap"' >/dev/null
echo "Installed $APP (Desktop shortcut: ~/Desktop/Kutkap)"
