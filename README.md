# Weave Edit Premiere Panel

This project builds as an Adobe CEP panel for Premiere Pro so you can place still-image coverage against a timestamped script directly inside an edit.

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

## AI setup (Ollama E4B primary)

Weave Edit can run deterministic timeline placement without AI. AI is optional and used only to rank asset relevance.

### 1) Install Ollama

Install Ollama and confirm the local server is running.

### 2) Pull Gemma 4 E4B

```sh
ollama pull gemma4:e4b
```

### 3) Configure Weave Edit panel

In the panel:

- set AI mode to `Local (Ollama)` or `Hybrid (Ollama + Gemini fallback)`
- set Ollama endpoint (default): `http://127.0.0.1:11434`
- set model: `gemma4:e4b`
- click `Check providers`, then `Analyze with AI`

If Ollama is unavailable, Weave Edit automatically falls back to deterministic matching.

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
- With Ollama down and no Gemini key: panel shows provider warning and deterministic matching still works.
- With Ollama down and Gemini key set: Hybrid mode can still return AI rankings.
- In/Out range, append mode, blank handling, and placement execution all remain deterministic.

## Key files

- `cep/com.soragenie.panel/CSXS/manifest.xml`
- `scripts/prepare-cep.mjs`
- `scripts/install-premiere-extension.mjs`
- `vite.config.ts`