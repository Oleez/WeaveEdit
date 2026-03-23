# Sora Genie Premiere Panel

This project now builds as an Adobe CEP panel for Premiere Pro instead of only as a standalone Vite app.

## Local development

```sh
npm install
npm run dev
```

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

`Window > Extensions > Sora Genie`

## Key files

- `cep/com.soragenie.panel/CSXS/manifest.xml`
- `scripts/prepare-cep.mjs`
- `scripts/install-premiere-extension.mjs`
- `vite.config.ts`