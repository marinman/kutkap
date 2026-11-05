# Kutkap

Local CapCut-style video editor for macOS, built on OpenCut's `pre-rewrite` snapshot (MIT). Owner: Marin (GitHub `marinman`). Work happens on branch `my-capcut`, pushed to `github.com/marinman/kutkap` `main` (`git push origin my-capcut:main`; `upstream` is OpenCut). Commits use the repo-local identity `Marin <6826608+marinman@users.noreply.github.com>`.

## Layout

| Path | What |
|---|---|
| `apps/web` | The editor: Next.js 16, React, Tailwind 4, bun. Runs at `localhost:3000` in dev, `localhost:3517` in the app. |
| `apps/reel-templates` | Local FastAPI service on `127.0.0.1:3518` (Python 3.12 venv): Reel Templates UI, word-timed captions (`/api/transcribe`, faster-whisper), link downloads (`/api/capture`, yt-dlp, MP4/MP3), face swap (`/api/faceswap`, runs FaceFusion), optional Ollama shot labeling. Data in `~/Kutkap/` (`downloads`, `captures`, `faceswap`, `frames`, `templates`). |
| `desktop-shell` | Electron 37 app (Dock icon, menu bar, splash). Starts both servers from `~/Library/Application Support/Kutkap/{web,reel-templates}` and stops them on quit. Browser storage (projects/media) in `.../Kutkap/App Data`. |
| `scripts/mac/install-app.sh` | Builds everything and installs `~/Applications/Kutkap.app`, Dock entry and Desktop alias. Re-run after changes. |
| `apps/desktop`, `rust/` | Upstream OpenCut experiments; not used. |

## Kutkap features added on top of OpenCut (where to look)

- Captions: `apps/web/src/transcription/word-captions.ts`, `subtitles/caption-presets.ts`, `subtitles/components/assets-view.tsx`
- Reel templates: service `reel_templates/{downloader,analyze,store,export,llm}.py` + static UI; editor tab `apps/web/src/templates/`
- Media from link: `apps/web/src/media/components/url-capture.tsx`, `services/media-capture.ts`
- Audio extraction / audio-only export: `apps/web/src/media/extract-audio.ts`, `components/editor/export-button.tsx`
- Canvas ratio menu: `apps/web/src/canvas/sizes.ts`, `preview/components/ratio-select.tsx`
- Face swap: service `reel_templates/faceswap.py`; editor `apps/web/src/faceswap/` (tab + header "Swap face" button)
- Desktop title bar: `.kutkap-titlebar` in `apps/web/src/app/globals.css`, set by `desktop-shell/preload.js`

## External dependencies on this Mac

- FaceFusion at `~/facefusion` (own venv, user-customized UI; `~/Applications/FaceFusion.app` launches its UI on 7870). Don't modify it.
- Ollama at `localhost:11434` (default model `qwen3:8b`) for optional labeling.
- Homebrew: `python@3.12`, `ffmpeg`, `tesseract`, `bun`, `node`, `yt-dlp` (venv copy is used).
- `gh` CLI logged in as `marinman`.

## Conventions and gotchas

- Match existing style: object parameters (`fn({ a, b })`), tabs. Some upstream files use **CRLF** line endings (e.g. `export-button.tsx`, `editor-header.tsx`, `next.config.ts`): preserve them. Don't run prettier over whole files.
- Typecheck: `cd apps/web && bunx tsc --noEmit -p .` (should be 0 errors). Tests: `bun test`.
- macOS blocks Finder-launched apps from reading `~/Downloads`; that's why the installer copies the built editor and service into Application Support.
- The service binds to 127.0.0.1 only; `/files/*` serves media folders only (never `settings.json`).
- In the browser-pane test tool, Radix `Select` items need keyboard selection (Enter); real clicks work.
- Projects made before the Electron app (in a Chrome window at `localhost:3517`) live in Chrome's profile; a migration/import task was in progress.
