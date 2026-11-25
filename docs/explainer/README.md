# Morph, explained

A short explainer in the visual language of 3Blue1Brown, made for
[Morph](https://jimmerioles.github.io/morph/).

The argument fits in one sentence: a file is not a thing, it is a sequence of
bytes, and a format is an agreement about how to read them. Once you see that,
conversion stops looking like magic. It is translation, and the translation can
happen in the tab you already have open.

## The published cut

- 1920 x 1080, 60 fps, 2 minutes 28 seconds.
- H.264 High profile at level 4.1, AAC 48 kHz stereo.
- The first frame is a 1920 x 1080 screenshot of the live demo, showing the
  idle chamber. It holds for 2.5 seconds, then crossfades for 0.5 seconds into
  the film at 2.5 seconds.
- The original audio starts at zero. Duration, narration, music, and cue timing
  are unchanged.
- The MP4 is not committed to the repository. The README uses the uploaded
  attachment; the [release asset](https://github.com/jimmerioles/morph/releases/tag/explainer-v1)
  is the same file.

[`morph-explainer.srt`](morph-explainer.srt) in this folder is the narration,
timed to the picture.

## The beats

| Time | Beat |
| --- | --- |
| 0:00 | Here is a file. It feels like a thing. |
| 0:02 | It is not. It is bytes, and a format is an agreement about how to read them. |
| 0:14 | The same bytes read under the wrong agreement become noise. |
| 0:22 | Conversion is translation: decode one agreement, hold the meaning, encode the next. |
| 0:33 | PNG and WebP disagree about almost everything except what a pixel is. CSV and JSON disagree about punctuation, but agree on what a row is. |
| 0:50 | Morph is a machine built around that middle. |
| 0:54 | A real PNG becomes WebP in the tab: 1.1 MB to 26 KB, a 98 percent reduction. |
| 1:14 | A real CSV becomes JSON: keys, quoted commas, typed numbers, labels that cost bytes. |
| 1:31 | PDF output is a labelled demo, not a fake success. |
| 1:40 | The browser already carries the translators. Morph conducts them. |
| 1:52 | Nothing leaves the tab. |
| 2:00 | A file converter used to mean someone else's computer. Now it can be a tab. |
| 2:11 | A file was never the thing. It was the agreement. |
| 2:17 | The link, and an invitation. |

## What is real

The video uses the prototype's own output, not mock-ups:

- The PNG to WebP result card, the CSV to JSON card, and the PDF demo card are
  screenshots of the live build at 1600 x 1000, captured at 3x and cropped.
- The idle chamber is the live build.
- The 1.1 MB to 26 KB and 553 B to 1.4 KB figures come from those runs.

The conversions themselves are the ones the prototype performs: Canvas2D
re-encoding for images, a quote-aware parser for delimited text, and a clearly
labelled demo artifact for PDF.

## How it is made

- [Manim Community](https://www.manim.community/) 0.22.1, Cairo renderer. No
  LaTeX install. Every label is a Pango `Text` or `MarkupText`.
- Type: Instrument Serif for the display voice, Inter for labels and interface
  copy, Noto Sans Mono for hex and JSON. The same type family the prototype uses.
- Palette: ink `#090604`, cream `#F3E8D3`, copper `#CE8448`, amber `#F0BC78`,
  muted `#A6957C`.
- Narration: Kokoro `af_heart`, speed 0.95, 48 kHz mono, trimmed and
  peak-normalised per line. The voice is not a clone.
- Score: synthesized from scratch with numpy and scipy. Four chords (Dm9,
  Bbmaj7, Fmaj9, Cadd9), a sub, sparse bells, air, and a synthetic plate
  reverb. No samples.
- Sound design: the shred, forge, ding, whoosh, click, and thump are rendered
  from the same recipes the browser uses, then placed on the exact cue frames.
- Mix: ffmpeg. Voice high-passed and lightly compressed, score ducked under the
  voice, a whisper of film grain on the picture, and a final -14 LUFS master at
  -1 dBTP.

## Rebuild

The Manim scene, voice build, score, sound effects, and mix scripts live in the
local `video/` workspace. From that folder:

```sh
uv venv --python 3.12 .venv
uv pip install -r requirements.txt

# narration, score, sound effects, backdrop
.venv/bin/python build_voice.py
.venv/bin/python make_music.py
.venv/bin/python make_sfx.py
.venv/bin/python make_assets.py

# 1080p60 render, then the final mix
.venv/bin/manim -qh scene.py MorphExplainer
./mix_audio.sh media/videos/scene/1080p60/MorphExplainer.mp4 audio/music.wav morph-explainer.mp4

# subtitles
.venv/bin/python make_srt.py
```

Use `-ql` for a 480p draft. The scene writes `audio/cues.json` during the
render, so the subtitles follow the actual voice timing.

## A note on the prototype

Morph is a prototype, and the film says so. Image conversion and CSV/TSV to
JSON run locally in the browser. PDF output, and image targets from non-images,
are labelled demo artifacts. The video's honesty beat exists because the
prototype already marks that boundary clearly.
