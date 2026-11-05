"""Link downloads via the yt-dlp Python API."""

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp

from . import store
from .config import CAPTURES_DIR, DOWNLOADS_DIR, load_settings, relative_to_data
from .jobs import UserFacingError, update_job

SUPPORTED_HOSTS = ("instagram.com", "tiktok.com", "youtube.com", "youtu.be")

# Prefer H.264 (avc1): AV1/VP9 MP4s don't play in QuickTime and many other apps.
VIDEO_FORMAT = (
    "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/"
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/"
    "b[height<=1080][ext=mp4]/"
    "bv*[height<=1080]+ba/b[height<=1080]/b"
)
AUDIO_FORMAT = "ba[ext=m4a]/ba/b"

# yt-dlp error text -> plain-language message. First match wins.
ERROR_MESSAGES = [
    (r"private", "This post is private. If you follow the account, turn on Instagram cookies in Settings."),
    (r"log ?in|sign in|cookies|authenticat|rate-limit", "This site needs you to be logged in to download this. Turn on browser cookies in Settings and try again."),
    (r"unavailable|removed|not available|does not exist|404", "This video is unavailable. It may have been deleted or restricted."),
    (r"unsupported url|no video formats|no media", "That link doesn't point to a video we can download."),
    (r"age", "This video is age-restricted. Turn on browser cookies in Settings and try again."),
]


def normalize_url(url: str) -> str:
    """Strip tracking params so the same post is recognized as a duplicate."""
    parsed = urlparse(url.strip())
    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
    path = parsed.path.rstrip("/")
    if host in ("youtube.com", "music.youtube.com") and parsed.query:
        video_id = re.search(r"(?:^|&)v=([\w-]+)", parsed.query)
        if video_id:
            return f"https://youtube.com/watch?v={video_id.group(1)}"
    return f"https://{host}{path}"


def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise UserFacingError("That doesn't look like a link. Paste a full URL starting with https://")
    host = parsed.netloc.lower()
    if not any(host == h or host.endswith("." + h) for h in SUPPORTED_HOSTS):
        raise UserFacingError("Unsupported link. Paste an Instagram, TikTok, or YouTube video URL.")
    return normalize_url(url)


def _friendly_error(error: Exception) -> str:
    text = str(error).lower()
    for pattern, message in ERROR_MESSAGES:
        if re.search(pattern, text):
            return message
    return "The download failed. Check the link and try again."


def _base_options(job_id: str) -> dict:
    def on_progress(status: dict) -> None:
        if status.get("status") != "downloading":
            if status.get("status") == "finished":
                update_job(job_id, message="Processing file…")
            return
        total = status.get("total_bytes") or status.get("total_bytes_estimate")
        percent = (status.get("downloaded_bytes", 0) / total * 100) if total else 0
        speed = status.get("speed")
        eta = status.get("eta")
        update_job(
            job_id,
            progress=round(min(percent, 99), 1),
            speed=f"{speed / 1_000_000:.1f} MB/s" if speed else None,
            eta=f"{int(eta)}s" if eta is not None else None,
            message="Downloading…",
        )

    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [on_progress],
        "windowsfilenames": True,
        "paths": {"home": str(DOWNLOADS_DIR)},
        "outtmpl": "%(title).70B [%(id)s].%(ext)s",
    }
    browser = load_settings().get("cookies_browser")
    if browser:
        options["cookiesfrombrowser"] = (browser,)
    return options


def download(job_id: str, url: str, media_format: str) -> dict:
    options = _base_options(job_id)
    if media_format == "audio":
        options["format"] = AUDIO_FORMAT
        options["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
    else:
        options["format"] = VIDEO_FORMAT
        options["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                raise UserFacingError("That link is a playlist or profile. Paste a link to a single video.")
            if media_format == "video" and not _has_video(info):
                raise UserFacingError("That link doesn't contain a video. Try Audio only, or check the link.")
            update_job(job_id, message=f"Downloading “{info.get('title') or 'video'}”…")
            info = ydl.process_ie_result(info, download=True)
    except UserFacingError:
        raise
    except yt_dlp.utils.DownloadError as error:
        raise UserFacingError(_friendly_error(error)) from error

    file_path = _final_path(info, media_format)
    record = {
        "id": uuid.uuid4().hex,
        "source_url": url,
        "title": info.get("title") or file_path.stem,
        "uploader": info.get("uploader") or info.get("channel") or "",
        "format": media_format,
        "file": relative_to_data(file_path),
        "duration_s": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "template_id": None,
    }
    store.upsert_download(record)
    return {"download_id": record["id"]}


def validate_capture_url(url: str) -> str:
    """Media capture accepts any web link yt-dlp can read, not just reel sites."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise UserFacingError("That doesn't look like a link. Paste a full URL starting with https://")
    return url.strip()


def capture(job_id: str, url: str, media_format: str) -> dict:
    """Downloads a link as .mp4 video or .mp3 audio for the editor's Media panel."""
    options = _base_options(job_id)
    options["paths"] = {"home": str(CAPTURES_DIR)}
    if media_format == "mp3":
        options["format"] = AUDIO_FORMAT
        options["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
    else:
        options["format"] = VIDEO_FORMAT
        options["merge_output_format"] = "mp4"
        # Single-file sources (e.g. a .webm or .mov link) are rewrapped as .mp4 too.
        options["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                raise UserFacingError("That link is a playlist or profile. Paste a link to a single video.")
            if media_format == "mp4" and not _has_video(info):
                raise UserFacingError("That link doesn't contain a video. Try MP3 instead.")
            update_job(job_id, message=f"Downloading “{info.get('title') or 'media'}”…")
            info = ydl.process_ie_result(info, download=True)
    except UserFacingError:
        raise
    except yt_dlp.utils.DownloadError as error:
        raise UserFacingError(_friendly_error(error)) from error

    requested = info.get("requested_downloads") or []
    path = Path(requested[-1]["filepath"]) if requested else Path(info["_filename"])
    path = path.with_suffix(f".{media_format}")
    if not path.exists():
        raise UserFacingError("The download finished but the file is missing. Try again.")
    return {"file": relative_to_data(path), "filename": path.name, "title": info.get("title") or path.stem}


def _has_video(info: dict) -> bool:
    formats = info.get("formats") or [info]
    return any((f.get("vcodec") or "none") != "none" for f in formats)


def _final_path(info: dict, media_format: str) -> Path:
    requested = info.get("requested_downloads") or []
    path = Path(requested[-1]["filepath"]) if requested else Path(info["_filename"])
    if media_format == "audio":
        path = path.with_suffix(".m4a")
    if not path.exists():
        raise UserFacingError("The download finished but the file is missing. Try again.")
    return path
