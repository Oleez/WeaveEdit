# Weave Edit Premiere Panel

This project builds as an Adobe CEP panel for Premiere Pro so you can place image or video coverage against a transcript directly inside an edit.

## Local development

```sh
npm install
npm run dev
```

## Cloud deploy (Railway / Docker)

This repository can be deployed as a web preview using Docker. Note that Premiere CEP host features (timeline writes, host evalScript, local filesystem bridge) only work inside Premiere, not in cloud preview.

### Deploy steps

1. Push this repository to your GitHub repo.
2. In Railway, create a new project from the repo.
3. Railway will detect the `Dockerfile` and build the app.
4. Set any environment variables in Railway if needed (for example `GEMINI_API_KEY` for hybrid fallback testing in web preview builds).
5. Deploy.

If Railway still uses Nixpacks in your service settings, switch builder/runtime to Docker so it uses this repo `Dockerfile`.

## Build the Premiere extension

```sh
npm run build
```

That produces:

- `dist/web` - the normal Vite production build
- `dist/cep/com.soragenie.panel` - a Premiere-ready CEP extension bundle

## Install into Premiere Pro on Windows

```sh
npm run install:premiere
```

The installer:

- builds the web app
- wraps it in a CEP extension bundle
- copies it into `%APPDATA%\Adobe\CEP\extensions\com.soragenie.panel`
- enables `PlayerDebugMode` for common `CSXS` versions so unsigned local builds can load

After install, restart Premiere Pro and open:

`Window > Extensions > Weave Edit`

## Transcript sources

Weave Edit can build placements from:

- Premiere sequence markers/comments
- uploaded SRT files
- uploaded timestamped text files

If Premiere markers are available, they can be loaded directly into the panel and used as the transcript source before falling back to a manual upload.

## Timestamp formats

Weave Edit accepts:

- SRT timecode like `00:00:05,000 --> 00:00:10,000`
- Millisecond timecode like `00:00:05.250`
- Frame timecode like `00:00:45:02`

For `HH:MM:SS:FF`, the last field is parsed against the active Premiere sequence FPS.

## Media library scanning and picker behavior

The library can scan:

- images only
- videos only
- mixed images and videos

If a subfolder cannot be read, Weave Edit now skips that folder and shows a scan warning instead of failing the entire scan.

Inside Premiere, `Choose folder` should open a native folder picker and write the selected path back into the source field. If the native bridge is unavailable, paste the path manually and use `Scan folder`.

## AI setup (Ollama E4B primary)

Weave Edit can run deterministic timeline placement without AI. AI is optional but intended to drive visual choice, duration suggestion, and overlap suggestions.

### 1) Install Ollama

Install Ollama and confirm the local server is running.

### 2) Pull Gemma 4 E4B

```sh
ollama pull gemma4:e4b
```

### 3) Optional: install local video tools

For video analysis, install both `ffmpeg` and `ffprobe` and make sure they are available on your `PATH`.

Without them, Weave Edit can still rank videos by filename and duration hints, but extracted frame analysis will be limited.

### 4) Configure Weave Edit panel

In the panel:

- set AI mode to `Local (Ollama)` or `Hybrid (Ollama + Gemini fallback)`
- set Ollama endpoint (default): `http://127.0.0.1:11434`
- set model: `gemma4:e4b`
- choose library type: `Images only`, `Videos only`, or `Mixed images and videos`
- add any `Custom instructions` to steer tone, repetition rules, overlap behavior, and pacing
- click `Check providers`, then `Analyze with AI`

If Ollama is unavailable, Weave Edit can fall back to Gemini when Hybrid mode is enabled.
If `ffmpeg`/`ffprobe` are available, Weave Edit extracts representative video frames and uses those samples for timestamp-aware scoring.

## Editorial behavior

- AI chooses the best matching visual candidates first.
- Low-confidence segments can still place media, but they are explicitly flagged in preview so you can review them.
- AI proposes sentence-aware durations, while min/max duration fields act only as safety rails.
- AI can suggest up to two overlapping visual layers on adjacent tracks when the transcript segment benefits from simultaneous coverage.

## Gemini fallback (optional)

Hybrid mode can use Gemini only when local Ollama fails.

Set your key in the environment before launching Premiere:

```powershell
$env:GEMINI_API_KEY="your_key_here"
```

Notes:

- No hardcoded API keys are used.
- Core timeline placement does not require Gemini.
- Fallback model default: `gemma-4-26b-a4b-it`.

## Validation checklist

- With Ollama running: provider check passes and AI-assisted matches appear.
- With frame-style script timecode like `00:00:45:02`, the parser succeeds when a Premiere sequence is active.
- With Premiere markers present: `Load Premiere markers` populates the transcript panel.
- With a mixed media folder, scan warnings are shown only for unreadable folders and the rest of the media still loads.
- With Ollama down and no Gemini key: panel shows provider warning and deterministic matching still works.
- With Ollama down and Gemini key set: Hybrid mode can still return AI rankings.
- Low-confidence placements are flagged instead of silently appearing as normal AI picks.
- Overlap layers place on adjacent tracks and skip when the overlap track is already occupied.
- In/Out range, append mode, blank handling, and placement execution all remain deterministic.

## Key files

- `cep/com.soragenie.panel/CSXS/manifest.xml`
- `scripts/prepare-cep.mjs`
- `scripts/install-premiere-extension.mjs`
- `vite.config.ts`