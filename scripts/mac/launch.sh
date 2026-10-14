#!/bin/bash
# Kutkap launcher: start the local server if it isn't running, then open the editor.
set -u

PORT="${KUTKAP_PORT:-3517}"
URL="http://localhost:${PORT}/projects"
REPO_DIR="$(cat "$HOME/.kutkap/repo-path" 2>/dev/null)"
WEB_DIR="${REPO_DIR}/apps/web"
LOG="$HOME/Library/Logs/Kutkap.log"

# Apps launched from Finder get a minimal PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

notify() {
	osascript -e "display notification \"$1\" with title \"Kutkap\"" >/dev/null 2>&1
}

is_up() {
	curl -s -o /dev/null --max-time 1 "$URL"
}

if [ ! -d "$WEB_DIR" ]; then
	osascript -e 'display alert "Kutkap" message "Could not find the Kutkap folder. Re-run scripts/mac/install-app.sh."' >/dev/null
	exit 1
fi

if ! is_up; then
	cd "$WEB_DIR" || exit 1
	if [ ! -f .next/BUILD_ID ]; then
		notify "Building Kutkap for the first time (about a minute)…"
		bun run build >>"$LOG" 2>&1 || {
			osascript -e "display alert \"Kutkap\" message \"Build failed. See $LOG\"" >/dev/null
			exit 1
		}
	fi
	nohup bun run start -p "$PORT" >>"$LOG" 2>&1 &
	for _ in $(seq 1 60); do
		is_up && break
		sleep 0.5
	done
fi

CHROME="/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
	open -na "$CHROME" --args --app="$URL"
else
	open "$URL"
fi
