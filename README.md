# Kutkap

A local, CapCut-style video editor that runs entirely on your machine: multi-track timeline, automatic captions, caption style templates, and one-click export.

Kutkap is built on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT), starting from its `pre-rewrite` snapshot, the last version with the full web editor.

## Features

- **Timeline editor**: multi-track video, audio, text, stickers, effects and transitions
- **Auto captions**: faster-whisper on your machine with per-word timestamps, so each 1–4 word caption appears exactly when it's spoken (falls back to in-browser Whisper if the local service isn't running)
- **Caption styles**: Classic, Bold Pop, Boxed, Highlight and Minimal
- **Reel templates**: paste an Instagram, TikTok or YouTube link and Kutkap downloads it, finds every cut, reads on-screen text, transcribes the hook and measures pacing, then saves a reusable template. In the editor's Templates tab, pick your clips and they're laid into the same shot timings over the reel's soundtrack
- **Get media from a link**: paste a YouTube, Instagram, TikTok (or most other) link at the top of the Media panel and download it straight into the project as MP4 or MP3
- **Canvas ratio switcher**: Original, Custom, 16:9, 4:3, 2.35:1, 2:1, 1.85:1, 9:16, 3:4, 5.8-inch and 1:1 under the preview
- **Audio extraction**: split a clip's audio onto its own track, save a video's sound as an audio asset, or export audio only (M4A or WAV)
- **Subtitle import**: `.srt` and `.ass`
- **Export**: MP4 at the project's canvas size (9:16, 16:9, 1:1 and more)
- **Mac app**: a launcher with its own icon that opens Kutkap in a standalone window

## Run it

Requires [Bun](https://bun.sh).

```sh
bun install
cp apps/web/.env.example apps/web/.env.local   # placeholder values are fine for local use
cd apps/web && bun run dev                      # http://localhost:3000
```

### Reel Templates service

`apps/reel-templates` is a FastAPI app (Python 3.12, yt-dlp, ffmpeg, faster-whisper, tesseract) on port 3518. It also powers word-timed captions in the editor.

```sh
brew install python@3.12 ffmpeg tesseract
cd apps/reel-templates
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn reel_templates.main:app --port 3518   # http://localhost:3518
```

Downloads, captured media, keyframes and templates are stored in `~/Kutkap` (`downloads/`, `captures/`, `frames/`, `templates/`). Optional AI shot labeling (off by default) runs on your local [Ollama](https://ollama.com) (default model `qwen3:8b`, pick any installed model in Settings), so nothing leaves your computer.

### Install the Mac app

```sh
scripts/mac/install-app.sh
```

This creates `~/Applications/Kutkap.app` and a Kutkap shortcut on your Desktop, and installs the Reel Templates service into `~/Library/Application Support/Kutkap` (outside `~/Downloads`, which macOS blocks Finder-launched apps from reading). Re-run it after pulling changes. On first launch the app builds the editor (about a minute), then starts both servers (editor on 3517, Reel Templates on 3518) and opens the editor in a Chrome app window. Server logs go to `~/Library/Logs/Kutkap.log`.

Projects are stored in your browser's IndexedDB for `localhost:3517`.

## License

[MIT](LICENSE). Original work © the OpenCut contributors.
