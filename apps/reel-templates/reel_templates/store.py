"""Flat-JSON storage for the downloads index and the template library."""

import json
import threading
from pathlib import Path

from .config import DOWNLOADS_DIR, TEMPLATES_DIR

_lock = threading.Lock()
DOWNLOADS_INDEX = DOWNLOADS_DIR / "index.json"


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    tmp.replace(path)


# Downloads -----------------------------------------------------------------

def list_downloads() -> list[dict]:
    with _lock:
        items = _read_json(DOWNLOADS_INDEX, [])
    return sorted(items, key=lambda item: item["created_at"], reverse=True)


def get_download(download_id: str) -> dict | None:
    return next((d for d in list_downloads() if d["id"] == download_id), None)


def upsert_download(record: dict) -> None:
    with _lock:
        items = [d for d in _read_json(DOWNLOADS_INDEX, []) if d["id"] != record["id"]]
        items.append(record)
        _write_json(DOWNLOADS_INDEX, items)


def find_download_by_url(url: str) -> dict | None:
    return next((d for d in list_downloads() if d["source_url"] == url), None)


# Templates -----------------------------------------------------------------

def _template_path(template_id: str) -> Path:
    if not template_id.replace("-", "").isalnum():
        raise ValueError("invalid template id")
    return TEMPLATES_DIR / f"{template_id}.json"


def get_template(template_id: str) -> dict | None:
    return _read_json(_template_path(template_id), None)


def save_template(template: dict) -> None:
    with _lock:
        _write_json(_template_path(template["id"]), template)


def delete_template(template_id: str) -> None:
    _template_path(template_id).unlink(missing_ok=True)


def list_templates(saved_only: bool = True) -> list[dict]:
    templates = [_read_json(path, None) for path in TEMPLATES_DIR.glob("*.json")]
    templates = [t for t in templates if t and (t.get("saved") or not saved_only)]
    return sorted(templates, key=lambda t: t["created_at"], reverse=True)


def find_template_by_url(url: str) -> dict | None:
    return next((t for t in list_templates() if t.get("source_url") == url), None)
