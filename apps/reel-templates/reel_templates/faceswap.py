"""Face swapping by running the user's local FaceFusion install headless.

FaceFusion keeps its own settings (facefusion.ini), models and content check;
this module only starts it, reports progress, and returns the output file.
"""

import os
import re
import subprocess
import threading
from pathlib import Path

from .config import DATA_DIR, relative_to_data
from .jobs import UserFacingError, update_job

FACEFUSION_DIR = Path(os.environ.get("FACEFUSION_DIR", Path.home() / "facefusion")).expanduser()
FACEFUSION_PYTHON = FACEFUSION_DIR / ".venv" / "bin" / "python"
FACEFUSION_UI_URL = "http://127.0.0.1:7870"
FACESWAP_DIR = DATA_DIR / "faceswap"

# Swaps are CPU/GPU heavy: run one at a time.
_run_lock = threading.Lock()
_processes: dict[str, subprocess.Popen] = {}

STAGE_PATTERN = re.compile(r"(analysing|processing):\s+(\d+)%\|.*?\|\s*(\d+)/(\d+)")

ERROR_MESSAGES = [
    ("no source face detected", "No face was found in the face photo. Use a clear, front-facing photo."),
    ("add a face photo first", "Add a face photo first."),
    ("stream", "FaceFusion couldn't read one of the files."),
    ("extracting frames failed", "FaceFusion couldn't read frames from this video."),
]


def status() -> dict:
    return {
        "available": FACEFUSION_PYTHON.exists() and (FACEFUSION_DIR / "facefusion.py").exists(),
        "busy": _run_lock.locked(),
        "ui_url": FACEFUSION_UI_URL,
    }


FACEFUSION_APP = Path.home() / "Applications" / "FaceFusion.app"


def open_ui() -> bool:
    """Opens the full FaceFusion app (its launcher starts the UI if needed)."""
    if not FACEFUSION_APP.exists():
        return False
    subprocess.Popen(["open", str(FACEFUSION_APP)])
    return True


def cancel(job_id: str) -> bool:
    process = _processes.get(job_id)
    if not process or process.poll() is not None:
        return False
    process.terminate()
    return True


def _read_progress(job_id: str, process: subprocess.Popen) -> list[str]:
    """Streams tqdm output (split on \\r) into job progress; returns the last lines."""
    tail: list[str] = []
    buffer = ""
    assert process.stdout
    while True:
        chunk = process.stdout.read(256)
        if not chunk:
            break
        buffer += chunk
        *lines, buffer = re.split(r"[\r\n]", buffer)
        for line in lines:
            if not line.strip():
                continue
            tail = (tail + [line])[-20:]
            match = STAGE_PATTERN.search(line)
            if not match:
                continue
            stage, percent, done, total = match.groups()
            if stage == "analysing":
                update_job(job_id, progress=round(int(percent) * 0.1, 1), message="Checking the video…")
            else:
                update_job(
                    job_id,
                    progress=round(10 + int(percent) * 0.88, 1),
                    message=f"Swapping faces… frame {done} of {total}",
                )
    return tail


def run(job_id: str, source: Path, target: Path, *, mode: str, enhance: bool) -> dict:
    if not status()["available"]:
        raise UserFacingError(f"FaceFusion isn't installed at {FACEFUSION_DIR}.")
    if not _run_lock.acquire(blocking=False):
        raise UserFacingError("Another face swap is still running. Wait for it to finish.")

    try:
        output = target.with_name(f"{target.stem} (face swap){target.suffix}")
        processors = ["face_swapper", *(["face_enhancer"] if enhance else [])]
        args = [
            str(FACEFUSION_PYTHON), "facefusion.py", "headless-run",
            "-s", str(source), "-t", str(target), "-o", str(output),
            "--processors", *processors,
            "--face-selector-mode", "many" if mode == "everyone" else "one",
            "--face-selector-order", "large-small",
            # Measured on Apple silicon: CPU is as fast as CoreML overall and skips
            # CoreML's ~75 s model compile at the start of every run.
            "--execution-providers", "cpu",
            "--output-video-encoder", "libx264",
            "--output-audio-encoder", "aac",
            "--temp-path", str(FACESWAP_DIR / "tmp"),
        ]
        update_job(job_id, message="Starting FaceFusion…")
        process = subprocess.Popen(
            args, cwd=FACEFUSION_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        _processes[job_id] = process
        tail = _read_progress(job_id, process)
        code = process.wait()
    finally:
        _processes.pop(job_id, None)
        _run_lock.release()

    if code != 0 or not output.exists():
        if code < 0:
            raise UserFacingError("Face swap cancelled.")
        text = "\n".join(tail).lower()
        for needle, message in ERROR_MESSAGES:
            if needle in text:
                raise UserFacingError(message)
        raise UserFacingError(
            "FaceFusion stopped without a result. No face may have been found in the video, "
            "or its content check blocked this file."
        )
    return {"file": relative_to_data(output), "filename": output.name}
