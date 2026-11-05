#!/bin/bash
# Builds and installs Kutkap.app: a standalone macOS app with its own window,
# Dock icon and menu bar. Re-run it after pulling changes.
#
# Everything the app runs is copied to ~/Library/Application Support/Kutkap,
# so it doesn't depend on this repo staying where it is (and macOS doesn't
# block it from reading ~/Downloads, ~/Desktop or ~/Documents).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHELL_DIR="$REPO_DIR/desktop-shell"
SUPPORT_DIR="$HOME/Library/Application Support/Kutkap"
APP="$HOME/Applications/Kutkap.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for tool in python3.12 ffmpeg tesseract node bun; do
	if ! command -v "$tool" >/dev/null; then
		case "$tool" in
			python3.12) formula="python@3.12" ;;
			bun) formula="oven-sh/bun/bun" ;;
			*) formula="$tool" ;;
		esac
		echo "Missing $tool. Install it with: brew install $formula"
		exit 1
	fi
done

echo "1/5 Media service (Reel Templates, captions, downloads, face swap)…"
REELS_DIR="$SUPPORT_DIR/reel-templates"
mkdir -p "$REELS_DIR"
rsync -a --delete --exclude .venv --exclude __pycache__ "$REPO_DIR/apps/reel-templates/" "$REELS_DIR/app/"
if [ ! -x "$REELS_DIR/.venv/bin/uvicorn" ]; then
	python3.12 -m venv "$REELS_DIR/.venv"
fi
"$REELS_DIR/.venv/bin/pip" install -q --upgrade pip
"$REELS_DIR/.venv/bin/pip" install -q -r "$REELS_DIR/app/requirements.txt"

echo "2/5 Editor (production build, about a minute)…"
(cd "$REPO_DIR" && bun install --silent)
(cd "$REPO_DIR/apps/web" && NEXT_TELEMETRY_DISABLED=1 bun run build >"$WORK/build.log" 2>&1) || {
	tail -30 "$WORK/build.log"
	echo "Editor build failed."
	exit 1
}
WEB_DIR="$SUPPORT_DIR/web"
rsync -a --delete "$REPO_DIR/apps/web/.next/standalone/" "$WEB_DIR/"
rsync -a "$REPO_DIR/apps/web/.next/static" "$WEB_DIR/apps/web/.next/"
rsync -a "$REPO_DIR/apps/web/public" "$WEB_DIR/apps/web/"
cp "$REPO_DIR/apps/web/.env.local" "$WEB_DIR/apps/web/.env.local"

echo "3/5 App icon…"
mkdir -p "$SHELL_DIR/assets" "$SHELL_DIR/build"
python3 -I "$SCRIPT_DIR/make-icon.py" "$SHELL_DIR/assets/icon.png"
ICONSET="$WORK/Kutkap.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
	sips -z $size $size "$SHELL_DIR/assets/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
	double=$((size * 2))
	sips -z $double $double "$SHELL_DIR/assets/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$SHELL_DIR/build/Kutkap.icns"

echo "4/5 Kutkap.app…"
(cd "$SHELL_DIR" && bun install --silent && bun run package >"$WORK/package.log" 2>&1) || {
	cat "$WORK/package.log"
	echo "Packaging failed."
	exit 1
}
BUILT_APP="$(find "$SHELL_DIR/dist" -maxdepth 2 -name Kutkap.app -type d | head -1)"

# Close a running copy (and any servers from the old launcher) before replacing it.
osascript -e 'tell application id "com.marinman.kutkap" to quit' >/dev/null 2>&1 || true
for port in 3517 3518; do
	lsof -t -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
done
sleep 1
mkdir -p "$HOME/Applications"
rm -rf "$APP"
ditto "$BUILT_APP" "$APP"
touch "$APP"

echo "5/5 Desktop shortcut and Dock…"
# A Finder alias (unlike a symlink) shows the app icon on the Desktop.
rm -f "$HOME/Desktop/Kutkap"
osascript \
	-e "tell application \"Finder\" to make alias file to (POSIX file \"$APP\" as alias) at (path to desktop folder)" \
	-e 'tell application "Finder" to set name of result to "Kutkap"' >/dev/null
if ! defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Applications/Kutkap.app"; then
	defaults write com.apple.dock persistent-apps -array-add \
		"<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$APP/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
	killall Dock
fi

echo "Installed $APP (in your Dock and on your Desktop)."
