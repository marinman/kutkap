"""Reel Template Maker API + static UI. Run: uvicorn reel_templates.main:app --port 3518"""

import re
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analyze, downloader, export, faceswap, insights, llm, store
from .config import DATA_DIR, LONG_VIDEO_SECONDS, ensure_dirs, load_settings, save_settings
from .jobs import UserFacingError, get_job, start_job

ensure_dirs()
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Reel Template Maker")
# The Kutkap editor (another localhost port) reads the library and soundtracks.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error(status: int, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"message": message, **extra})


# Downloads ---------------------------------------------------------------------

class DownloadRequest(BaseModel):
    url: str
    format: str = "video"


@app.post("/api/downloads")
def create_download(body: DownloadRequest):
    if body.format not in ("video", "audio"):
        raise _error(400, "Format must be Video or Audio only.")
    try:
        url = downloader.validate_url(body.url)
    except UserFacingError as error:
        raise _error(400, str(error)) from error

    existing_template = store.find_template_by_url(url)
    if existing_template:
        raise _error(409, "This link is already in your library.", template_id=existing_template["id"])
    existing_download = store.find_download_by_url(url)
    if existing_download and (DATA_DIR / existing_download["file"]).exists():
        raise _error(409, "You've already downloaded this link.", download_id=existing_download["id"])

    job_id = start_job("download", lambda jid: downloader.download(jid, url, body.format))
    return {"job_id": job_id}


class CaptureRequest(BaseModel):
    url: str
    format: str = "mp4"


@app.post("/api/capture")
def capture_media(body: CaptureRequest):
    """Used by the editor's Media panel: download any link as MP4 or MP3."""
    if body.format not in ("mp4", "mp3"):
        raise _error(400, "Format must be MP4 or MP3.")
    try:
        url = downloader.validate_capture_url(body.url)
    except UserFacingError as error:
        raise _error(400, str(error)) from error
    job_id = start_job("capture", lambda jid: downloader.capture(jid, url, body.format))
    return {"job_id": job_id}


@app.get("/api/downloads")
def list_downloads():
    return store.list_downloads()


@app.get("/api/downloads/{download_id}")
def get_download(download_id: str):
    record = store.get_download(download_id)
    if not record:
        raise _error(404, "Download not found.")
    return record


class AnalyzeRequest(BaseModel):
    confirm_long: bool = False


@app.post("/api/downloads/{download_id}/analyze")
def analyze_download(download_id: str, body: AnalyzeRequest):
    record = store.get_download(download_id)
    if not record:
        raise _error(404, "Download not found.")
    duration = record.get("duration_s") or 0
    if duration > LONG_VIDEO_SECONDS and not body.confirm_long:
        raise _error(
            412,
            f"This video is {round(duration / 60, 1)} minutes long. Analysis will take a while. Continue?",
            needs_confirmation=True,
        )
    job_id = start_job("analyze", lambda jid: analyze.analyze(jid, download_id))
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise _error(404, "Job not found.")
    return job


# Templates ---------------------------------------------------------------------

@app.get("/api/templates")
def list_templates(q: str = ""):
    templates = store.list_templates()
    if q.strip():
        needle = q.strip().lower()
        templates = [t for t in templates if needle in _search_text(t)]
    return [_summary(t) for t in templates]


def _search_text(template: dict) -> str:
    parts = [
        template.get("title", ""), template["hook"].get("type", ""), template["hook"].get("spoken_hook", ""),
        template["hook"].get("first_3s_text", ""), template["audio"].get("transcript", ""),
        template.get("reuse_notes", ""),
        *(s.get("role", "") for s in template["shots"]),
        *(b["text"] for s in template["shots"] for b in s.get("on_screen_text", [])),
    ]
    return " ".join(parts).lower()


def _summary(template: dict) -> dict:
    return {
        "id": template["id"],
        "title": template["title"],
        "created_at": template["created_at"],
        "hook_type": template["hook"]["type"],
        "format": template["format"],
        "pacing": template["pacing"],
        "audio_type": template["audio"]["type"],
        "views": (template.get("stats") or {}).get("views"),
        "soundtrack_file": template.get("soundtrack_file"),
        "keyframes": [s.get("keyframe") for s in template["shots"]],
        "shots": [{"n": s["n"], "start": s["start"], "duration": s["duration"], "role": s.get("role", "")}
                  for s in template["shots"]],
    }


@app.get("/api/templates/{template_id}")
def get_template(template_id: str):
    template = _load(template_id)
    # Ratios depend on today's date, so they're computed on read rather than stored.
    return {**template, "stats_derived": insights.derived_stats(template.get("stats"))}


@app.put("/api/templates/{template_id}")
def update_template(template_id: str, body: dict):
    template = _load(template_id)
    protected = {"id", "download_id", "source_file", "soundtrack_file", "created_at", "source_url", "stats_derived"}
    template.update({k: v for k, v in body.items() if k not in protected})
    store.save_template(template)
    return template


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: str):
    template = _load(template_id)
    store.delete_template(template_id)
    record = store.get_download(template.get("download_id", ""))
    if record and record.get("template_id") == template_id:
        store.upsert_download({**record, "template_id": None})
    return {"ok": True}


@app.post("/api/templates/{template_id}/reanalyze")
def reanalyze_template(template_id: str):
    """Re-runs the analysis on the same download, keeping the template's id, title and saved state."""
    template = _load(template_id)
    download_id = template.get("download_id", "")
    if not store.get_download(download_id):
        raise _error(404, "The original download is gone, so this template can't be re-analyzed.")
    job_id = start_job("analyze", lambda jid: analyze.analyze(jid, download_id, template_id))
    return {"job_id": job_id}


@app.post("/api/templates/{template_id}/stats")
def refresh_template_stats(template_id: str):
    """Fetches the post's current views, likes and comments."""
    template = _load(template_id)
    try:
        stats = downloader.fetch_stats(template["source_url"])
    except UserFacingError as error:
        raise _error(502, str(error)) from error
    template["stats"] = stats
    store.save_template(template)
    record = store.get_download(template.get("download_id", ""))
    if record:
        store.upsert_download({**record, "stats": stats})
    return template


@app.get("/api/templates/{template_id}/export.{kind}")
def export_template(template_id: str, kind: str):
    template = _load(template_id)
    slug = re.sub(r"[^\w-]+", "-", template["title"].lower()).strip("-")[:60] or "template"
    if kind == "md":
        return PlainTextResponse(
            export.to_markdown(template),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{slug}.md"'},
        )
    if kind == "json":
        return Response(
            export.to_json(template),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{slug}.json"'},
        )
    raise _error(404, "Export format must be md or json.")


def _load(template_id: str) -> dict:
    try:
        template = store.get_template(template_id)
    except ValueError:
        template = None
    if not template:
        raise _error(404, "Template not found.")
    return template


# Face swap (used by the Kutkap editor, runs the local FaceFusion) -----------

FACESWAP_IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".webp"}
FACESWAP_TARGET_TYPES = FACESWAP_IMAGE_TYPES | {".mp4", ".mov", ".m4v", ".webm"}


def _save_upload(upload: UploadFile, folder: Path, stem: str, allowed: set[str]) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in allowed:
        raise _error(400, f"Unsupported file type: {suffix or 'unknown'}")
    path = folder / f"{stem}{suffix}"
    with path.open("wb") as handle:
        shutil.copyfileobj(upload.file, handle)
    return path


@app.get("/api/faceswap/status")
def faceswap_status():
    return faceswap.status()


@app.post("/api/faceswap")
def start_faceswap(
    source: UploadFile = File(...),
    target: UploadFile = File(...),
    mode: str = Form("main"),
    enhance: bool = Form(True),
):
    if mode not in ("main", "everyone"):
        raise _error(400, "Choose who to replace: the main face or everyone.")
    if faceswap.status()["busy"]:
        raise _error(409, "Another face swap is still running. Wait for it to finish.")
    folder = faceswap.FACESWAP_DIR / uuid.uuid4().hex
    folder.mkdir(parents=True)
    source_path = _save_upload(source, folder, "face", FACESWAP_IMAGE_TYPES)
    target_stem = re.sub(r"[^\w .-]+", "", Path(target.filename or "target").stem)[:60] or "target"
    target_path = _save_upload(target, folder, target_stem, FACESWAP_TARGET_TYPES)
    job_id = start_job(
        "faceswap",
        lambda jid: faceswap.run(jid, source_path, target_path, mode=mode, enhance=enhance),
    )
    return {"job_id": job_id}


@app.post("/api/faceswap/open")
def open_facefusion():
    if not faceswap.open_ui():
        raise _error(404, "FaceFusion.app wasn't found in ~/Applications.")
    return {"url": faceswap.FACEFUSION_UI_URL}


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    return {"cancelled": faceswap.cancel(job_id)}


# Captions (used by the Kutkap editor) -------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/transcribe")
async def transcribe_audio(request: Request, language: str = ""):
    """Body: any audio file ffmpeg can read. Returns per-word timestamps."""
    body = await request.body()
    if not body:
        raise _error(400, "No audio was sent.")
    with tempfile.NamedTemporaryFile(suffix=".audio") as handle:
        handle.write(body)
        handle.flush()
        samples = analyze.load_audio(Path(handle.name))
    segments = await run_in_threadpool(
        analyze.transcribe, samples, load_settings()["caption_model"], language or None
    )
    words = [w for s in segments for w in s["words"] if w["word"]]
    return {"words": words, "segments": [{k: s[k] for k in ("start", "end", "text")} for s in segments]}


# Settings ----------------------------------------------------------------------

@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def update_settings(body: dict):
    return save_settings(body)


@app.get("/api/ollama/models")
def ollama_models():
    try:
        return {"models": llm.list_models(load_settings()["ollama_url"])}
    except llm.OllamaUnavailable as error:
        raise _error(503, str(error)) from error


# Files + UI --------------------------------------------------------------------

# Only media folders are served, never settings.json or the downloads index.
for _folder in ("downloads", "captures", "faceswap", "frames", "templates/audio"):
    (DATA_DIR / _folder).mkdir(parents=True, exist_ok=True)
    app.mount(f"/files/{_folder}", StaticFiles(directory=DATA_DIR / _folder), name=f"files-{_folder}")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
