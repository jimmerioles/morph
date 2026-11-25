# Morph

File alchemy in the browser: drop a file into the chamber, get another format out.

**Live demo:** https://jimmerioles.github.io/morph/

https://github.com/user-attachments/assets/9080c3d3-c0e2-44bb-b816-9a8f5256eacb

Morph is a local file converter built around one interaction: drop a file on the transmuter, watch it shred into glyphs, and collect the result from the other side. The chamber is the product demo, not a video of one, and it is for anyone who wants a quick conversion without uploading a file or creating an account. It is a prototype, and it says so: images, tables, and JSON convert for real in the tab, while unsupported pairs return a valid, clearly labelled demo artifact.

The [case study](https://jimmerioles.github.io/morph/case-study/) goes deeper on the problem, the real/demo boundary, the explainer film, and the build.

## What it does

- **Images to WebP or PNG.** Canvas2D re-encodes the file in the tab. Original dimensions are preserved up to a 7000 px side or 45 MP.
- **CSV, TSV, or JSON to JSON.** Quote-aware parsing, delimiter detection, duplicate-header handling, and typed numbers and booleans.
- **PDF output is a demo.** The result is a valid one-page transmutation record, marked `DEMO`, not a rendering of the source.
- **Everything else is labelled.** Image targets from unsupported sources and JSON from arbitrary files return a valid demo artifact, never a fake success.
- **Local by default.** One file at a time, up to 60 MB. Nothing is uploaded.
- **Sound after a gesture.** Shred, forge, and ding are synthesized with Web Audio. The mute toggle persists.
- **Reduced motion and keyboard access.** Particles are skipped, the canvas goes static, and the result still arrives. The file picker, format chips, and download are keyboard accessible.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build the app and case study
npm run preview  # serve the production build
```

Node 22 or newer. The app's only network request is Google Fonts (Instrument Serif and Inter); both have system fallbacks, so the page works offline. The case study embeds the explainer from GitHub.

## Use it

- Drop a file on the chamber, click the chamber or the main button, or paste from the clipboard.
- Pick a target with the format chips: WebP, PNG, JSON, PDF.
- Download the result. **Convert another** resets the chamber.
- **Try a sample** builds a target-appropriate file. **How it works** explains the real/demo boundary.
- Changing the target after a result requires **Convert another** first.

## How it works

Morph is a static Vite + TypeScript app. `convert.ts` does the real work in the tab: Canvas2D for images, a small parser for delimited text, and the built-in JSON parser for JSON. `chamber.ts` draws the ring and particles with Canvas2D, `audio.ts` synthesizes the sound, and `main.ts` holds the state machine, file intake, focus handling, and reduced-motion path. See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and data flow.

## Tests

No automated suite yet. `npm run build` runs `tsc` and the production build; the conversion paths are checked by hand in the browser.

## Limits

- One file at a time. No batch queue or conversion history.
- Conversion runs on the main thread. Very large images can block the UI.
- No video, audio, archive, or HEIC conversion.

## Credits

Built with Vite, TypeScript, Canvas2D, and Web Audio. Type is Instrument Serif and Inter from Google Fonts.

The 2:28 explainer at the top has production notes and subtitles in [docs/explainer](docs/explainer/README.md).

License: none declared yet.
