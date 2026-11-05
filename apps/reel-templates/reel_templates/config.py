"""Paths and user settings. All app data lives under one folder."""

import json
import os
import threading
from pathlib import Path

DATA_DIR = Path(os.environ.get("KUTKAP_DATA", Path.home() / "Kutkap")).expanduser()
DOWNLOADS_DIR = DATA_DIR / "downloads"
# Media captured from links in the Kutkap editor's Media panel.
CAPTURES_DIR = DATA_DIR / "captures"
FRAMES_DIR = DATA_DIR / "frames"
TEMPLATES_DIR = DATA_DIR / "templates"
SETTINGS_FILE = DATA_DIR / "settings.json"

LONG_VIDEO_SECONDS = 180

DEFAULT_SETTINGS = {
    # yt-dlp cookies-from-browser, e.g. "chrome", "safari", "firefox". Empty = off.
    "cookies_browser": "",
    # faster-whisper model size: tiny, base, small, medium.
    "whisper_model": "small",
    # Model for Kutkap editor captions: accuracy matters more than speed here.
    "caption_model": "small",
    # Optional shot labeling with a local Ollama model. Off by default; the app works fully without it.
    "llm_enabled": False,
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen3:8b",
}

_settings_lock = threading.Lock()


def ensure_dirs() -> None:
    for directory in (DOWNLOADS_DIR, CAPTURES_DIR, FRAMES_DIR, TEMPLATES_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict:
    with _settings_lock:
        try:
            stored = json.loads(SETTINGS_FILE.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            stored = {}
        return {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS}}


def save_settings(updates: dict) -> dict:
    current = load_settings()
    current.update({k: v for k, v in updates.items() if k in DEFAULT_SETTINGS})
    with _settings_lock:
        SETTINGS_FILE.write_text(json.dumps(current, indent=2))
    return current


def relative_to_data(path: Path) -> str:
    return path.relative_to(DATA_DIR).as_posix()
