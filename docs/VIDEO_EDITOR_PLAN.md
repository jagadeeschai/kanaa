# WideAngle Motion: Video Editor Plan

Turn Motion's single-clip editor into a browser-based, multilayer video editor that a first-time creator can use, with room to grow into professional work. This plan replaces the "Next in Motion" list in `docs/ROADMAP.md`.

**Who it's for:** someone posting to YouTube, Reels and Shorts who has never used an editor. They should get from clips to a finished post in under 5 minutes, with no manual.

**What the owner asked for:** a better UI and ease of use, multiple clips with trim, audio separation, multilayer editing, and better animation.

**Principles**
1. Simple by default, deep on demand. Advanced controls live in a side panel and never block the basic flow.
2. Non-destructive. Imported media is never changed. Projects autosave. Undo works everywhere.
3. Preview must match export. Any visible difference is a bug.
4. Local first. The browser edits and previews. The local Python and FFmpeg backend does heavy work. Nothing leaves the Mac, except AI image generation the user configures.
5. Tamil and Indic text are first-class in every text feature.

**Not in scope yet:** public hosting, accounts, collaboration, node compositing, 3D, plugins, ffmpeg.wasm rendering.

---

## Current state

Motion runs at `http://localhost:5190` with its API on `127.0.0.1:8010`. It's React, TypeScript and Vite, with FastAPI, SQLite and FFmpeg. Data lives in `backend/.data`.

**Already works, reuse it**

| Capability | Where |
|---|---|
| Studio, projects, import, media, exports, downloads | `frontend/src/App.tsx`, `backend/app/api/routes.py` |
| Autosave of a project recipe | `frontend/src/hooks/useVideoProject.ts`, `projects.recipe` |
| Render queue with cancel and restart recovery | `render_queue_service.py` |
| Export: color handling, HDR tone mapping, GPS stripping, disk check | `video_edit_service.py` |
| Tamil and Indic text: complex shaping, bundled Noto fonts | `write_lyrics()`, `backend/app/assets/fonts` |
| Beat detection, lyric sync, LRC and SRT | `beat_service.py`, `lyric_sync_service.py`, `frontend/src/utils/lyrics.ts` |
| Crossfades and Ken Burns motion on image slides | `prepare_slideshow()`, `frontend/src/utils/slides.ts` |
| AI lyric image generation | `lyric_image_service.py` |

**The gaps**
- `frontend/src/components/VideoEditor.tsx` handles one source clip. It has no timeline, split, join, layers, keyframes, undo or keyboard control.
- `frontend/src/components/LyricalVideoCreator.tsx` is separate from it.
- The preview is CSS filters, which only approximate the export.
- The UI has no animation library. `framer-motion` isn't a dependency.

**Run all tests:** `./test.sh` from the project root.

---

## Architecture

### One timeline drives everything
A single versioned JSON document describes the project. The browser evaluates it for preview, and the backend compiles it for export. Don't add a second edit format.

- `backend/app/services/timeline_service.py`: `validate()`, `normalize()` and `compile()`.
- `frontend/src/timeline/evaluate.ts`: what each layer looks like at time `t`.
- `timeline/fixtures/`: shared test projects with expected values at sampled times, run by both the Python and TypeScript tests.

Store it in the existing `projects.recipe` column as version 2. No new table is needed. `projects.media_id` is `NOT NULL`, so keep it as the project's cover, normally the first clip. Convert version 1 edit recipes on load.

```json
{
  "version": 2,
  "format": { "width": 1080, "height": 1920, "fps": 30 },
  "layers": [
    {
      "id": "l1", "kind": "video", "name": "Main", "magnetic": true, "hidden": false, "muted": false, "locked": false,
      "items": [{
        "id": "c1", "media_id": 12, "start": 0, "in": 2.0, "out": 9.5, "speed": 1,
        "transform": {
          "x": 0.5, "y": 0.5, "scale": 1, "rotation": 0, "opacity": 1,
          "keyframes": { "scale": [{ "t": 0, "v": 1, "ease": "easeOut" }, { "t": 3, "v": 1.2 }] }
        },
        "enter": { "preset": "slide-up", "duration": 0.4 }, "exit": null,
        "transition_in": null, "filter": null, "audio": { "volume": 1, "detached": false }
      }]
    },
    { "id": "l2", "kind": "text", "items": [{ "id": "t1", "start": 1, "end": 4, "text": "தமிழ்", "style": "band" }] },
    { "id": "l3", "kind": "audio", "items": [{ "id": "a1", "asset_id": "...", "start": 0, "in": 0, "out": 30, "volume": 0.6, "fade_in": 0, "fade_out": 2, "duck": true }] }
  ]
}
```

Item times are seconds on the timeline. Keyframe times are seconds within the item. Positions are 0–1 fractions of the frame, so one project can change format.

### Preview in the browser
- **Proxies:** edit on cached 720p short-GOP H.264 SDR copies, and export from originals.
- **Compositing:** a WebGL2 canvas draws each visible layer, using `<video>` elements as textures.
- **Clock:** the audio clock is the master. Use `requestVideoFrameCallback` to detect drift, and correct it beyond about 40 ms.
- **Audio:** Web Audio mixes all tracks with per-item gain and fades.
- **Text:** a transparent PNG rendered by the export's libass path, used in both preview and export.
- **Seeking:** `<video>` elements with `requestVideoFrameCallback`. Phase 1 showed this holds the targets.

Target Chrome first on an M1 Pro with 16 GB. Add Safari later.

### Export
Compile the timeline to one FFmpeg `filter_complex` graph, run through `enqueue_render`. Phase 1 chose this approach. Limit live preview to 6 layers at first.

### Audio separation means two features
1. **Detach audio:** split a clip's sound onto its own audio layer, instantly and non-destructively.
2. **Stem separation:** split a song into vocals and music with Demucs in the backend, through the queue. It takes minutes, and it needs PyTorch and a model. Make it an optional install, and check the license of the model weights before bundling them.

---

## Editor layout

Keep Studio as the home screen. The editor opens full screen:

```
┌──────────────────────────────────────────────────────────────┐
│ Project name · saved        Undo Redo        Format   Export │
├──────────┬───────────────────────────────┬───────────────────┤
│ Media    │                               │ Inspector for the │
│ Text     │        Preview canvas         │ selected item:    │
│ Audio    │                               │ Adjust, Animate,  │
│ Animate  │     ◀ ▶  0:12 / 0:45          │ Audio, Speed      │
├──────────┴───────────────────────────────┴───────────────────┤
│ Timeline: layers, filmstrips, waveforms, playhead, zoom      │
└──────────────────────────────────────────────────────────────┘
```

**Ease-of-use rules**
- First screen asks one question: "Where will you post this?" That sets the format.
- Empty timeline shows one action: drop clips here.
- Dragging from the media panel always works. The canvas supports direct drag, resize and rotate handles.
- Beginners see one main track until they add something to another layer.
- Presets come before sliders. Hovering an animation preview plays it on the canvas.
- Every failure says what to do next, in plain words.
- On phones, use a sticky preview and tabbed tools. Basic trim, text and export must work. Multilayer editing is desktop-first.

---

## Phases

Each phase must ship on its own, keep existing tests passing, and meet its "Done when" before the next starts.

### Phase 0: Make it safe to build (done)
- `wideangle-motion` has its own git repository.
- Video export, render queue, beat detection, lyric sync and database tests are ported from Photos.
- Frontend tests run with `npm test`, and `./test.sh` runs everything.

### Phase 1: Prove the risky part (done, two near-misses)
Prototype in `spike/`, on an M1 Pro with 16 GB, in Chromium 152. Rebuild its media with `spike/make_media.py`. This code is throwaway: learn from it, don't ship it.

**Tested:** 3 video layers from 720p proxies on a 1920×1080 WebGL canvas, position and scale keyframes with easing, one Tamil text layer, one song, and one FFmpeg export.

| Check | Target | Result | Status |
|---|---|---|---|
| Preview, 5 minutes | Under 5% dropped | 0 dropped of 8,851 frames per layer | Pass |
| Seek | Under 300 ms | Median 31 ms, max 49 ms, within one frame | Pass |
| Audio and video drift | Under 40 ms | Median 16 ms, 99% under 22 ms, peak 58 ms for a moment at 1:42 | **Near-miss** |
| Layer position match | Under 2 px | 0–1 px, with one edge of 80 at exactly 2 px | **Near-miss** |
| Color match | Close | Mean difference 2.9 of 255, text area 4.2 | Pass |
| Export speed, 1080p | Under 3× | 0.99× at 3 layers, 1.82× at 6, 2.24× at 8 | Pass |
| Memory | Under 4 GB | No browser process exceeded about 1.2 GB. GPU memory wasn't measured separately | Likely pass |

**Layer limit:** 6 live layers was clean, with a 31 ms peak drift. At 8, no frames dropped, but peak drift was 65 ms and 99% sat under 36 ms. Set the first limit at 6.

**Decisions from this phase**
- Export uses approach A, a compiled FFmpeg graph. Headless Chrome isn't needed.
- Keyframes compile to exact ffmpeg expressions of `t`, with the same easing math as `evaluate.js`.
- Export composites in RGB (`gbrp`) and converts to BT.709 at the end, so overlays keep their color.
- WebCodecs isn't needed. `<video>` textures with `requestVideoFrameCallback` are enough.
- **Text changes from the plan:** render each text item to a transparent PNG with the export's own libass path (`alpha=1`), and use that image in preview and export. Letters are then identical and Tamil shaping can't differ, so JASSUB isn't needed. Editing text needs a short server round trip, so measure that in Phase 5.
- Start audio first, then video on the same moment. Starting them apart caused the first drift failure.

**Not yet proven:** real iPhone footage, HEVC proxies, rotation and opacity keyframes, keyframes on many layers at once, audible sync (the output was silenced and only the clock measured), Chrome and Safari themselves, and a machine busy with other work.

### Phase 2: Timeline and media pipeline (L)
- Timeline version 2, `validate`, `normalize`, `compile`, shared fixtures, and migration of old recipes.
- Background proxies, filmstrip sprites and waveform peaks, cached by content hash, with progress visible.
- Handle mixed resolution, frame rate, rotation, HDR, and clips with no audio. Store fps, which isn't captured today.
- A disk budget for the cache with cleanup, because imports already copy media and space is limited.

**Done when:** three clips with different sizes, frame rates and orientations export in order, with correct sync, proven by frame and audio tests.

### Phase 3: Multi-clip editor and new UI (L)
This is the first version users will feel.
- The editor layout above, replacing the single-clip dialog.
- Canvas timeline with filmstrips, waveforms, playhead, zoom and snapping.
- Add clips, split, trim, reorder, delete with magnetic ripple.
- Undo and redo for everything, with autosave.
- Keyboard: Space, J/K/L, I/O, arrow keys for frames, S to split, Delete, Cmd+Z, Cmd+Shift+Z.
- Format selection, reframing per clip, platform safe areas, and export presets for YouTube, Reels, Shorts and Square.

**Done when:** a new user can join and trim 3 clips and export a Reel in under 3 minutes without help. A 60-clip project stays responsive.

### Phase 4: Audio (M)
- Detach audio, volume, fades, music tracks, and mute per clip or layer.
- Auto-ducking and loudness normalization.
- Optional stem separation: vocals and music as separate tracks.

**Done when:** a clip's audio can be moved and edited on its own, exports stay in sync, and removing vocals from a test song works from the UI.

### Phase 5: Animation presets, transitions and text (M)
- Enter and exit presets: fade, slide, zoom, pop, blur, bounce, each with a duration.
- Transitions: crossfade, wipe, slide, zoom, using `xfade` where possible.
- Text: title presets, band, shadow and outline styles, simple animations.
- Filters and speed changes.

**Done when:** every preset matches between preview and export in a golden-frame test, and Tamil text stays correctly shaped through its animations.

### Phase 6: Keyframes (M)
- Keyframe position, scale, rotation and opacity from the inspector, with a stopwatch toggle per property.
- Easing presets first, curve editing after.
- Motion paths shown on the canvas.

**Done when:** a logo can be animated across the frame by a non-expert, and the export matches the preview.

### Phase 7: Full multilayer (L)
- Picture-in-picture, overlays, image layers, and any number of layers up to the proven limit.
- Hide, lock, mute, reorder, blend modes.
- A clear message when a project exceeds what can preview live, with a preview render option.

**Done when:** a project at the layer limit previews within target and exports correctly.

### Phase 8: Easy automation and lyric videos (L)
- Auto captions, using Whisper and the letter-level aligner, with editable lines.
- Cut on the beat, remove silences.
- Templates for common posts.
- Move lyric videos onto the timeline as a template, and keep every current lyric feature, including AI image scenes, storyboard timing and LRC import.

**Done when:** an existing lyric project opens on the timeline and exports with no visible loss.

**Suggested order:** 0, 1, 2, 3, then 4 and 5 together, then 6, 7, 8. Phases 0–3 give a real multi-clip social editor. Give time estimates only after Phase 1, since its measurements decide how hard the later phases are.

---

## Rules for the implementing agent

**Protect the user**
- Never modify imported media. Exports go to `.data/exports`.
- Tell the owner before heavy renders, or before changing code while they're using the app. The Mac has 16 GB of memory and limited disk.
- Check disk space before large jobs.

**Keep output honest**
- Every export feature needs a test that inspects the output: dimensions, color tags, audio sync, frames. Counting changed pixels isn't enough, and that once let broken Tamil text pass.
- Tests must use a temporary data directory. Never write to the real `motion.db`.
- Test with real iPhone footage before calling HDR, VFR or rotation done. Only synthetic clips have been used so far.
- Look at real output frames before reporting success, and say what wasn't checked, such as audio by ear.

**Keep the code clean**
- Run long jobs through `enqueue_render`, and honor `should_cancel`.
- Pass ffmpeg arguments as lists, never through a shell.
- Keep timeline, playback, audio, rendering and UI in separate modules. Keep per-frame state out of React renders.
- Motion stays independent of Photos, with no shared database or required process.

---

## Open decisions for the owner

1. Are the Phase 1 near-misses acceptable? Peak drift was 58 ms against 40 ms, and one edge was 2 px against under 2 px. The suggestion is to accept both, and require 99.9% of drift under 45 ms and no peak over 80 ms.
2. Which is the target: desktop Chrome only, or phones too? This plan assumes desktop first, with basic phone support.
3. Should stem separation be included? It adds a large optional download.
4. Should stickers, emoji and licensed music be included? Emoji doesn't render in exports today, and music needs a licensed source.
