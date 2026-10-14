"""Local analysis: ffprobe, scene detection, keyframes, transcription, OCR, pacing."""

import csv
import io
import json
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

import numpy as np

from . import store
from .config import DATA_DIR, FRAMES_DIR, TEMPLATES_DIR, load_settings, relative_to_data
from .jobs import UserFacingError, update_job

SCENE_THRESHOLD = 0.4
HOOK_SECONDS = 3.0
OCR_MIN_CONFIDENCE = 60
SAMPLE_RATE = 16000

_whisper_models: dict = {}
_whisper_lock = threading.Lock()


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=False)


# Metadata ---------------------------------------------------------------------

def probe(path: Path) -> dict:
    result = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ])
    if result.returncode != 0:
        raise UserFacingError("This file couldn't be read. It may be corrupt or an unsupported format.")
    data = json.loads(result.stdout)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    duration = float(data["format"].get("duration") or 0)

    info = {"duration_s": round(duration, 2), "has_audio": audio is not None, "has_video": video is not None}
    if video:
        width, height = int(video["width"]), int(video["height"])
        rotation = _rotation(video)
        if rotation in (90, 270):
            width, height = height, width
        fps = float(Fraction(video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1")) \
            if (video.get("avg_frame_rate") or "0/0") != "0/0" else 0.0
        info.update({
            "width": width,
            "height": height,
            "resolution": f"{width}x{height}",
            "aspect_ratio": _aspect_ratio(width, height),
            "fps": round(fps, 2),
        })
    return info


def _rotation(stream: dict) -> int:
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            return abs(int(side["rotation"])) % 360
    return abs(int(stream.get("tags", {}).get("rotate", 0))) % 360


def _aspect_ratio(width: int, height: int) -> str:
    known = {"9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1.0, "4:5": 4 / 5, "3:4": 3 / 4, "4:3": 4 / 3}
    ratio = width / height
    name, value = min(known.items(), key=lambda item: abs(item[1] - ratio))
    return name if abs(value - ratio) < 0.03 else str(Fraction(width, height).limit_denominator(32)).replace("/", ":")


# Shots ------------------------------------------------------------------------

def detect_shots(path: Path, duration: float) -> list[dict]:
    result = _run([
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
        "-filter:v", f"select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-an", "-f", "null", "-",
    ])
    cuts = sorted({round(float(t), 3) for t in re.findall(r"pts_time:([\d.]+)", result.stderr)})
    boundaries = [0.0] + [c for c in cuts if 0.2 < c < duration - 0.2] + [duration]
    shots = []
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:]), start=1):
        shots.append({"n": index, "start": round(start, 2), "end": round(end, 2), "duration": round(end - start, 2)})
    return shots


def extract_keyframes(path: Path, shots: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for shot in shots:
        midpoint = shot["start"] + shot["duration"] / 2
        target = out_dir / f"shot{shot['n']:02d}.jpg"
        _run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{midpoint:.3f}", "-i", str(path),
            "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "3", str(target),
        ])
        shot["keyframe"] = relative_to_data(target) if target.exists() else ""


def extract_soundtrack(path: Path, target: Path) -> str | None:
    """Saves the audio as m4a so the Kutkap editor can drop it on a timeline."""
    target.parent.mkdir(parents=True, exist_ok=True)
    copy = _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
                 "-vn", "-c:a", "copy", str(target)])
    if copy.returncode != 0:
        _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
              "-vn", "-c:a", "aac", "-b:a", "192k", str(target)])
    return relative_to_data(target) if target.exists() else None


# Audio ------------------------------------------------------------------------

def load_audio(path: Path) -> np.ndarray:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=False,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


def _whisper(model_size: str):
    from faster_whisper import WhisperModel

    with _whisper_lock:
        if model_size not in _whisper_models:
            _whisper_models[model_size] = WhisperModel(model_size, device="cpu", compute_type="int8")
        return _whisper_models[model_size]


def transcribe(samples: np.ndarray, model_size: str | None = None, language: str | None = None) -> list[dict]:
    if samples.size == 0:
        return []
    model = _whisper(model_size or load_settings()["whisper_model"])
    segments, _ = model.transcribe(
        samples,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        # Stops one misheard phrase from snowballing into the next.
        condition_on_previous_text=False,
    )
    result = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        result.append({
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": text,
            "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
                      for w in (segment.words or [])],
        })
    return result


def classify_audio(samples: np.ndarray, segments: list[dict]) -> str:
    """voice, music, or both: checks for sustained sound in the gaps between speech."""
    if not segments:
        return "music"
    speech = np.zeros(samples.size, dtype=bool)
    for segment in segments:
        speech[int(segment["start"] * SAMPLE_RATE):int(segment["end"] * SAMPLE_RATE)] = True
    gaps = samples[~speech]
    if gaps.size < SAMPLE_RATE:  # under a second of non-speech: can't tell
        return "voice"
    window = SAMPLE_RATE // 2
    usable = gaps[: gaps.size // window * window].reshape(-1, window)
    rms_db = 20 * np.log10(np.sqrt((usable ** 2).mean(axis=1)) + 1e-9)
    # Music keeps the gaps loud; a voice-only track drops to near silence between phrases.
    return "both" if np.median(rms_db) > -38 else "voice"


def speech_pacing(segments: list[dict], duration: float) -> dict:
    words = [w for s in segments for w in s["words"]]
    if not words:
        return {"words_per_min": 0, "speech_ratio": 0, "pauses_over_1s": 0}
    spoken = sum(s["end"] - s["start"] for s in segments)
    pauses = sum(1 for a, b in zip(segments, segments[1:]) if b["start"] - a["end"] > 1.0)
    return {
        "words_per_min": round(len(words) / max(spoken, 0.1) * 60),
        "speech_ratio": round(spoken / max(duration, 0.1), 2),
        "pauses_over_1s": pauses,
    }


# OCR --------------------------------------------------------------------------

def ocr_keyframe(image: Path) -> list[dict]:
    """Text blocks with a rough screen position, e.g. 'bottom-center'."""
    if not shutil.which("tesseract") or not image.exists():
        return []
    result = _run(["tesseract", str(image), "stdout", "--psm", "11", "tsv"])
    if result.returncode != 0:
        return []
    rows = list(csv.DictReader(io.StringIO(result.stdout), delimiter="\t", quoting=csv.QUOTE_NONE))
    if not rows:
        return []
    page = next((r for r in rows if r["level"] == "1"), None)
    page_w = float(page["width"]) if page else 1
    page_h = float(page["height"]) if page else 1

    lines: dict[tuple, list[dict]] = {}
    for row in rows:
        text = (row.get("text") or "").strip()
        if row["level"] != "5" or not text or float(row["conf"]) < OCR_MIN_CONFIDENCE:
            continue
        if not re.search(r"[A-Za-z0-9]", text):  # punctuation-only noise
            continue
        lines.setdefault((row["block_num"], row["par_num"], row["line_num"]), []).append(row)

    blocks: dict[str, list[dict]] = {}
    for key, words in lines.items():
        blocks.setdefault(key[0], []).extend(words)

    found = []
    for words in blocks.values():
        left = min(float(w["left"]) for w in words)
        top = min(float(w["top"]) for w in words)
        right = max(float(w["left"]) + float(w["width"]) for w in words)
        bottom = max(float(w["top"]) + float(w["height"]) for w in words)
        text = " ".join(w["text"].strip() for w in words)
        if len(text) < 3:
            continue
        found.append({"text": text, "position": _position((left + right) / 2 / page_w, (top + bottom) / 2 / page_h)})
    return found


def _position(x: float, y: float) -> str:
    vertical = "top" if y < 1 / 3 else "middle" if y < 2 / 3 else "bottom"
    horizontal = "left" if x < 1 / 3 else "center" if x < 2 / 3 else "right"
    return f"{vertical}-{horizontal}"


# Template ---------------------------------------------------------------------

def analyze(job_id: str, download_id: str) -> dict:
    record = store.get_download(download_id)
    if not record:
        raise UserFacingError("That download no longer exists.")
    source = DATA_DIR / record["file"]
    if not source.exists():
        raise UserFacingError("The downloaded file is missing from the downloads folder.")

    template_id = str(uuid.uuid4())
    frames_dir = FRAMES_DIR / template_id

    update_job(job_id, progress=5, message="Reading video info…")
    meta = probe(source)
    duration = meta["duration_s"]
    is_video = meta["has_video"] and record["format"] == "video"

    shots: list[dict] = []
    if is_video:
        update_job(job_id, progress=15, message="Finding cuts…")
        shots = detect_shots(source, duration)
        update_job(job_id, progress=35, message="Saving keyframes…")
        extract_keyframes(source, shots, frames_dir)
        update_job(job_id, progress=45, message="Reading on-screen text…")
        for shot in shots:
            shot["on_screen_text"] = ocr_keyframe(DATA_DIR / shot["keyframe"]) if shot["keyframe"] else []
            shot.update({"role": "", "notes": ""})

    segments: list[dict] = []
    audio_type = "music"
    soundtrack = None
    if meta["has_audio"]:
        update_job(job_id, progress=55, message="Transcribing speech (first run downloads the model)…")
        samples = load_audio(source)
        segments = transcribe(samples)
        audio_type = classify_audio(samples, segments)
        update_job(job_id, progress=88, message="Saving soundtrack…")
        soundtrack = extract_soundtrack(source, TEMPLATES_DIR / "audio" / f"{template_id}.m4a")

    spoken_hook = " ".join(w["word"] for s in segments for w in s["words"] if w["start"] < HOOK_SECONDS).strip()
    first_3s_text = " / ".join(
        block["text"] for shot in shots if shot["start"] < HOOK_SECONDS for block in shot["on_screen_text"]
    )
    cut_count = max(len(shots) - 1, 0)
    pacing = {
        "shots": len(shots),
        "cuts_per_min": round(cut_count / duration * 60, 1) if duration else 0,
        "avg_shot_s": round(duration / len(shots), 2) if shots else 0,
        "hook_window_s": shots[0]["duration"] if shots else round(min(duration, HOOK_SECONDS), 2),
        **speech_pacing(segments, duration),
    }
    caption_positions = sorted({b["position"] for s in shots for b in s["on_screen_text"]})

    template = {
        "id": template_id,
        "saved": False,
        "download_id": download_id,
        "source_url": record["source_url"],
        "source_file": record["file"],
        "soundtrack_file": soundtrack,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": record["title"],
        "format": {
            "duration_s": duration,
            "aspect_ratio": meta.get("aspect_ratio", ""),
            "resolution": meta.get("resolution", ""),
            "fps": meta.get("fps", 0),
        },
        "hook": {"type": "", "first_3s_text": first_3s_text, "spoken_hook": spoken_hook},
        "pacing": pacing,
        "shots": shots,
        "audio": {
            "type": audio_type,
            "transcript": " ".join(s["text"] for s in segments),
            "segments": [{k: s[k] for k in ("start", "end", "text")} for s in segments],
        },
        "caption_style": {"position": ", ".join(caption_positions), "notes": ""},
        "reuse_notes": "",
    }

    settings = load_settings()
    if settings["llm_enabled"]:
        update_job(job_id, progress=92, message=f"Labeling shots with {settings['ollama_model']}…")
        from .llm import label_template

        label_template(template, settings["ollama_url"], settings["ollama_model"])

    store.save_template(template)
    store.upsert_download({**record, "template_id": template_id})
    return {"template_id": template_id}
