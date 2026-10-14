# Kutkap

A local, CapCut-style video editor that runs entirely on your machine: multi-track timeline, automatic captions, caption style templates, and one-click export.

Kutkap is built on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT), starting from its `pre-rewrite` snapshot, the last version with the full web editor.

## Features

- **Timeline editor**: multi-track video, audio, text, stickers, effects and transitions
- **Auto captions**: Whisper speech-to-text running locally in the browser; nothing is uploaded
- **Caption styles**: Classic, Bold Pop, Boxed, Highlight and Minimal, with 1 to 8 words per caption (1 = word by word)
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

### Install the Mac app

```sh
scripts/mac/install-app.sh
```

This creates `~/Applications/Kutkap.app` and a Kutkap shortcut on your Desktop. On first launch it builds the app (about a minute), then starts the local server on port 3517 and opens the editor in a Chrome app window. Server logs go to `~/Library/Logs/Kutkap.log`.

Projects are stored in your browser's IndexedDB for `localhost:3517`.

## License

[MIT](LICENSE). Original work © the OpenCut contributors.
