# Kutkap 🎬

**The free CapCut alternative that runs 100% on your Mac.** No cloud, no subscription, no watermark. Your footage never leaves your computer.

👉 **See a video or song you want?** Paste the link and the built-in downloader drops it straight into your project as MP4 or MP3.

👉 **Swap faces in one click.** Built-in face swapping, powered by FaceFusion running on your own machine.

👉 **Captions that hit every word.** Auto captions timed to the exact moment each word is spoken, in five scroll-stopping styles.

👉 **Steal the structure, not the content.** Paste any viral reel and Kutkap maps every cut, the hook and the pacing into a template you can drop your own clips into.

👉 **Rip the audio from anything.** Pull a clip's sound onto its own track, or export audio only.

👉 **Every format, one tap.** Switch between 9:16, 1:1, 16:9 and more right under the preview.

👉 **A real Mac app.** Its own window, Dock icon and menu bar. Double-click and edit.

Kutkap is built on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT), starting from its `pre-rewrite` snapshot, the last version with the full web editor.

## Features in detail

- **Timeline editor**: multi-track video, audio, text, stickers, effects and transitions
- **Auto captions**: faster-whisper on your machine with per-word timestamps, so each 1–4 word caption appears exactly when it's spoken (falls back to in-browser Whisper if the local service isn't running)
- **Caption styles**: Classic, Bold Pop, Boxed, Highlight and Minimal
- **Reel templates**: paste an Instagram, TikTok or YouTube link and Kutkap downloads it, finds every cut, reads on-screen text, transcribes the hook and measures pacing, then saves a reusable template. In the editor's Templates tab, pick your clips and they're laid into the same shot timings over the reel's soundtrack
- **Get media from a link**: paste a YouTube, Instagram, TikTok (or most other) link at the top of the Media panel and download it straight into the project as MP4 or MP3
- **Canvas ratio switcher**: Original, Custom, 16:9, 4:3, 2.35:1, 2:1, 1.85:1, 9:16, 3:4, 5.8-inch and 1:1 under the preview
- **Audio extraction**: split a clip's audio onto its own track, save a video's sound as an audio asset, or export audio only (M4A or WAV)
- **Face swap**: the Face swap tab runs your local [FaceFusion](https://github.com/facefusion/facefusion) install (expected at `~/facefusion`, override with `FACEFUSION_DIR`) on a video or image from Media and adds the result back to Media. Choose the main face or everyone; "Open FaceFusion" opens the full app for picking one person in a group. Only use faces of people who've agreed to it
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

This builds `~/Applications/Kutkap.app`, a standalone macOS app (Electron, in `desktop-shell/`) with its own window, Dock icon and menu bar, adds it to your Dock and puts a shortcut on your Desktop. Re-run it after pulling changes.

The app runs its own copy of the editor and media service from `~/Library/Application Support/Kutkap` (`web/`, `reel-templates/`), starts them when it opens and stops them when it quits. Projects and their media are stored in `~/Library/Application Support/Kutkap/App Data`. Logs go to `~/Library/Logs/Kutkap.log`.

## License

[MIT](LICENSE). Original work © the OpenCut contributors.
