"""Tiny in-memory background job tracker for downloads and analysis."""

import threading
import traceback
import uuid
from typing import Callable

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


class UserFacingError(Exception):
    """An error whose message is safe and meaningful to show in the UI."""


def get_job(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def update_job(job_id: str, **fields) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def start_job(kind: str, work: Callable[[str], dict]) -> str:
    """Run work(job_id) in a thread. Its return value becomes job["result"]."""
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "kind": kind,
            "status": "running",
            "progress": 0.0,
            "message": "Starting…",
            "result": None,
            "error": None,
        }

    def run() -> None:
        try:
            result = work(job_id)
            update_job(job_id, status="done", progress=100.0, message="Done", result=result)
        except UserFacingError as error:
            update_job(job_id, status="error", error=str(error))
        except Exception:  # noqa: BLE001 - never surface a raw stack trace to the UI
            traceback.print_exc()
            update_job(job_id, status="error", error="Something went wrong. Check the server log for details.")

    threading.Thread(target=run, daemon=True).start()
    return job_id
