# WideAngle Motion

A video editor and lyric video creator that runs on your own Mac.

## Mac app

Run `desktop/build.sh` once. It installs `WideAngle Motion.app` in Applications.
The app runs this folder's code and keeps projects in `backend/.data`, so keep the
folder where it is. Run `desktop/build.sh` again after pulling new code.

## Start from a terminal

Install Python 3.12+, Node 22+, FFmpeg and ffprobe. Then run:

```sh
./start.sh
```

Open **http://localhost:5190**. The API runs on **127.0.0.1:8010**. Both bind to the
local computer. First launch installs dependencies if needed. Ctrl+C stops them.

## Workflow

1. Choose Video Editor or Lyric Video from Studio.
2. Name a project and drop in your media. Import copies stay in Motion's own store.
3. Edit and preview. Each project autosaves independently, even with the same source.
4. Export to MP4. Progress and cancellation are available in Exports.
5. Open the result and download it. Projects can be renamed, duplicated, or deleted.

Video editing currently supports one source clip: trim, rotate, flip, picture
adjustments, mute and volume. Multi-clip timeline editing remains on the roadmap.

Lyric projects support image slideshows or a video background, song uploads,
automatic local lyric synchronization, manual/LRC/SRT timings, image and lyric
animations, crossfades, beat timing, text styles, and output formats. Review
singing-based automatic timings before export. Image/video browser color previews
remain approximate; review exported colors for critical work.

## Data and independence

- `backend/.data/motion.db`: media records, project recipes, render-job history.
- `backend/.data/media`: imported originals (never modified by editing).
- `backend/.data/video_audio`: uploaded songs.
- `backend/.data/exports`: rendered MP4s.
- `backend/.models`: local Whisper model cache. First sync downloads the model if absent.
- `backend/app/assets/fonts`: bundled Noto fonts for Tamil and other Indic scripts.

Deleting a project removes its recipe, not its media or exports. Files are not
silently migrated from Photos. Import any source media you want to use here.

Environment overrides: `WIDEANGLE_MOTION_DATA_DIR`, `WIDEANGLE_MOTION_MODEL_CACHE`,
`WIDEANGLE_MOTION_LYRIC_MODEL` (default `small`).

The Photos shortcut points to `http://localhost:5188/wideangle/`; it is a navigation
link, not a runtime dependency. Motion works when Photos is stopped or removed.

## Development and checks

```sh
npm --prefix frontend run build
PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

Tests additionally require `httpx` (`backend/.venv/bin/python -m pip install httpx`).
Browser checks used disposable imported media, not a personal library.

## Images inspired by lyrics

Choose **Lyric Video → Start with AI images**, or open an existing lyric project.
Paste lyrics and open **Create images from lyrics**:

1. Choose a shared style, creative direction, and 1–8 scenes.
2. Build scene prompts. Lyric sections are grouped locally; the image model
   interprets their meaning and imagery, including lyrics in their original language.
3. Review and edit each visual prompt; prompt edits autosave with the scene plan.
4. Configure a provider in **AI settings** (the top-bar settings button, or the
   editor's AI connection panel), then choose Generate images.
5. Select the finished images and choose Use generated images. When lyric timings
   are available and unchanged, scene changes follow their saved start times.

The provider uses [OpenAI's Images generation API](https://developers.openai.com/api/reference/resources/images/methods/generate).
The default model is `gpt-image-2.5-flare`; model and compatible API URL are editable.
`OPENAI_API_KEY` can be supplied to the server, or a key can be saved in Motion's
local `.data/ai-settings.json` (owner-only permissions). Keys are never returned by
settings reads or stored in project recipes. Environment keys take precedence.

Generation sends included lyrics/prompts to the chosen provider and uses its API
credits. This is the optional online part of Motion. Each scene is submitted once;
retrying failures does not regenerate successful images. Cancellation stops remaining
scenes and closes an in-flight local request; a request already accepted by the
provider may still be charged. Generated images remain in Media and in the saved
scene plan, even when the editor is closed. Interrupted jobs require an explicit retry.

Provider-contract and browser tests use a local fake provider. No paid live-provider
check was performed without a configured API key; generated artistic quality still
needs review against the real provider.
