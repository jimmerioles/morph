# Architecture

Morph is a static Vite + TypeScript app. There is no server, no framework, and no runtime dependency beyond the browser APIs it uses. `npm run build` emits plain HTML, CSS, and JavaScript for GitHub Pages.

## Modules

| File | Responsibility |
| --- | --- |
| `src/main.ts` | UI state machine (`idle`, `working`, `done`), file intake from drop, picker, and clipboard, result panel, focus handling, reduced-motion response, and canvas visibility. |
| `src/convert.ts` | Real conversions and labelled demo artifacts. |
| `src/chamber.ts` | Canvas2D ring, glyph vortex, sparks, progress arc, idle dust, and visibility pausing. |
| `src/audio.ts` | Web Audio synthesis for shred, forge, ding, and error cues. No audio files. |
| `src/style.css` | Layout, palette, responsive rules, and reduced-motion styles. |
| `case-study/index.html` | The long-form case study: problem, machine, film, conversion routes, performance, accessibility, limits, and next. |
| `src/case-study.css` | Case study layout, palette, figures, tables, and responsive rules. |
| `src/case-study.ts` | Reading progress and the sticky top bar's scrolled state. |
| `public/case-study/morph-explainer.vtt` | English captions for the embedded explainer. |

## Conversion path

`convertFile(file, target)` returns a `Blob`, a filename, a `kind` of `real` or `demo`, and a note. The UI renders that `kind` as a `REAL` or `DEMO` badge and repeats the note under the result.

Real paths:

- **Image to WebP or PNG.** `createImageBitmap` (with an `<img>` fallback for formats it cannot decode), draw to Canvas2D, then `canvas.toBlob`. Original dimensions are preserved up to a 7000 px side or 45 MP, whichever comes first. WebP uses quality 0.9.
- **CSV, TSV, or JSON to JSON.** Delimited text goes through delimiter detection, a quote-aware parser, duplicate-header suffixing, and number/boolean coercion. JSON is parsed and re-serialized with two-space indentation.

Demo paths:

- PDF output is a generated one-page record, not a rendering of the source.
- JSON output from a non-tabular file is a metadata record.
- WebP or PNG output from a non-image, or from an image the browser cannot decode, is a rendered seal image.

The demo paths produce valid files. They are never presented as a successful content conversion.

## Case study

`npm run build` has two HTML entries: `index.html` for the app and `case-study/index.html` for the long-form page. The case study is static HTML and CSS with a small progress script. It embeds the explainer from its GitHub attachment and ships local captions in `public/case-study/morph-explainer.vtt`; the MP4 is not committed. The page follows the app's palette and type but keeps its own layout, so the app stays a single-screen experience.

The case study has its own skip link, landmarks, heading order, table captions, and visible focus. Its only external media is the explainer video, requested on load as metadata or when the visitor presses play.

## Motion and sound

The chamber runs a single `requestAnimationFrame` loop. It pauses when the tab is hidden or the stage leaves the viewport, using `visibilitychange` and `IntersectionObserver`. With `prefers-reduced-motion: reduce`, particle work is skipped, the canvas is static, and progress transitions are shorter. The result still arrives.

Audio is synthesized after a user gesture. The mute preference is stored in `localStorage` under `morph-muted`. The audio context is created lazily, so a page load makes no sound and no audio request.

## Accessibility

The drop target is a real button. Format chips are `aria-pressed` buttons. The hidden file input is removed from the tab order. The result panel receives focus after completion, and status changes are announced through an `aria-live` region at start, completion, and error. The download is an anchor with a `download` attribute.

## Limits

- One file at a time. No batch queue and no history.
- Conversion runs on the main thread. Very large images can block the UI.
- The input cap is 60 MB.
- The app's only network request is Google Fonts. Instrument Serif and Inter both have system fallbacks. The case study also loads the explainer from a GitHub attachment.
