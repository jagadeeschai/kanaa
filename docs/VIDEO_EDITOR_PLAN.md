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

### Phase 2: Timeline and media pipeline (done)
No UI yet. The editor screen still uses version 1 recipes until Phase 3.

**Built**
- `timeline_schema.py`: the version 2 format and its rules, including 6 video layers at most, no overlaps on a layer, and unique ids.
- `timeline_service.py`: compiles any timeline to ffmpeg, and upgrades version 1 recipes when read. Stored recipes aren't rewritten.
- `asset_service.py`: proxies, filmstrips and waveform peaks, built automatically on import at background priority, cached by content, limited to 5 GB by default (`WIDEANGLE_MOTION_CACHE_GB`).
- API: `GET /projects/{id}/timeline`, `POST /projects/{id}/export`, `GET /photos/{id}/assets`, `/proxy`, `/filmstrip`, `/peaks`.
- `frontend/src/timeline/evaluate.ts`, with `timeline/fixtures/` shared by the Python and TypeScript tests.
- `photos` gained `fps`, `rotation` and `has_audio`. Media imported earlier keeps default values, so read facts with `probe_video` until a backfill exists.

**Tested with real footage:** 60 clips from 5 sources, covering 4K variable frame rate, 29.97, 25, a 10 fps portrait clip, and 720p.

| Check | Result |
|---|---|
| Length | Exactly 5,400 frames for 180 seconds |
| Export at 1080p | 120 seconds, 0.67× length, peak 2.3 GB |
| Proxy, filmstrip and peaks for 60 seconds of 4K | 22 seconds, 0.37× length, 27 MB |

**Decisions from this phase**
- **Audio is mixed in its own pass** to a WAV file, then muxed. In a shared graph, ffmpeg lost the end of a clip's sound. Don't merge the two passes.
- Clips join with `concat` per layer, and each clip is forced to an exact frame count, so rounding can't build up.
- Text renders once per item through `render_text_image`.

**Not yet proven:** real iPhone HDR, rotated or HEVC footage (only synthetic rotated, VFR and HDR clips were tested), audio sync by ear on real speech, and a layer limit test with many animated layers.

### Phase 3: Multi-clip editor and new UI (done, one check open)
**Built**
- `frontend/src/editor/`: `Editor.tsx` (screen, format chooser, inspector, export dialog), `playback.ts` (WebGL preview with a virtual clock), `TimelineView.tsx` (canvas timeline), `editor-shell.css`. Replaces `VideoEditor.tsx`. Lyric projects are unchanged.
- `frontend/src/timeline/`: `model.ts` (pure editing rules, `normalizeTimeline` fills fields the server omits) and `history.ts` (undo and redo, grouped per drag).
- Add, split, trim, reorder and delete with magnetic ripple, snapping, zoom, autosave, Fit, Fill, drag to reposition, rotate, flip, picture adjustments, speed, volume and mute per clip, a 9:16 safe-area guide, and 720p, 1080p and 4K export.
- Keys: Space, K, L (1×, 2×, 4×), J, I, O, arrows (Shift for 10 frames), S, Delete, Cmd+Z, Cmd+Shift+Z.

**Tested in the app's built-in browser with generated clips**

| Check | Result |
|---|---|
| Export of the edited 4-clip project | Exactly 510 frames, 17.000 seconds, with sound |
| 60-clip project export at 1080p, including photos | Exactly 2,700 frames, 90.000 seconds, 38 seconds, 0.42× length |
| Right clip on screen during playback | 0 wrong of 596 sampled frames |
| Clip switch cost | 0 long tasks in a 40-second run through 26 cuts |
| Split on 60 clips, until the next frames are drawn | 14 to 17 ms |
| Play to first movement | About 50 ms |
| Phone width, 375 px | Preview, tools and timeline stay on screen, no sideways scroll |

**Fixed along the way**
- SD-tagged video and photos exported with wrong colors, and SD-tagged proxies previewed with wrong colors. Green measured 221 in export and 161 in preview against 189 in the source. Export now 187, preview 189. Covered by `tests/test_timeline.py`, which fails on the old code. `ASSET_REVISION` rebuilds old proxies, so existing clips prepare again once.
- Timelines from the server omitted clip fields, which produced `NaN` durations.

**Decisions from this phase**
- Screenshots on a Mac are in Display P3. Compare preview colors by reading the canvas, not from a screenshot.
- J steps back one second. Reverse playback isn't possible with `<video>` elements.
- Clips are added by clicking in Media. Dragging from Media to the timeline isn't built.
- Only working panels are shown.
- No platform length limits are shown, because they change and haven't been confirmed.

**Not yet proven**
- The "done when" user test: a new person trims 3 clips and exports a Reel in under 3 minutes without help. It hasn't been run with a real person.
- About one 1-second freeze in playback appeared in each of three short runs early in testing, with no long tasks. A blank page showed none in 20 seconds, and a clean 40-second run showed none. The cause is unknown.
- Audible sync, real phone footage, Chrome and Safari themselves, and touch gestures on a real phone. The test browser is the desktop app's built-in one.

### Phase 4: Audio (done)
**Built**
- `editor/audio.ts`: preview sound now runs through Web Audio, so volume above 100%, fades, ducking and drift correction work. Video elements feed the same mixer.
- Audio tracks on the timeline with waveforms. Sounds move, trim and split on their own, and change track when there's room. Add music, detach a clip's sound, volume to 200%, fades, speed, mute per sound or track.
- Ducking: "Dip under speech", on by default for added music. Export uses `sidechaincompress`, and preview applies the same threshold and ratio from a live level meter.
- "Even out loudness" in the export dialog: two-pass `loudnorm` to -14 LUFS with one steady gain. Export only, so preview doesn't change.
- `stem_service.py`, `POST /api/stems` and `install-stems.sh`: Demucs `htdemucs` through the render queue. It runs in its own environment, `backend/.stems`, and a song is only separated once. Remove vocals, keep only vocals, or split into two tracks.

**Tested through the UI on a 30-second excerpt of a real Tamil song**

| Check | Result |
|---|---|
| Whisper words found in the original | 22, the real lyrics |
| Whisper words found after Remove vocals | 0 |
| Whisper words found in vocals only | 20 |
| Music plus vocals against the original | Residual 0.0023 against 0.1722 level |
| Separation time on the Mac GPU | 22 seconds for 30 seconds of song |
| Export with a sound moved 2 seconds | Exactly 960 frames, 32.000 seconds, tone starts at 2 seconds |
| Export loudness | -14.0 LUFS |
| Preview music against picture over 10 seconds | Median 17 ms, 99% under 30 ms, peak 33 ms |
| Preview ducking on a test tone | -8 dB, as the formula predicts |

**Fixed along the way**
- Songs used only by edit projects were deleted after 30 days, because the cleanup only protected lyric projects.
- Preview music sat about 125 ms late, under the old correction limit. It's now nudged like video.

**Decisions from this phase**
- Stem separation is included as an optional add-on, answering open decision 3. It takes 650 MB. Remove it by deleting `backend/.stems` and `backend/.models/torch`.
- The add-on must use Motion's Python. Python 3.14 has no matching PyTorch builds.
- The Demucs code is MIT licensed. The `htdemucs` weights are downloaded at install, not bundled. Their terms haven't been reviewed for commercial distribution, so check them before shipping the add-on to others.
- Fades are set with sliders. Dragging fades on the timeline isn't built.
- Songs are added per project. There's no shared music library, and no licensed music.

**Not yet proven:** sync and ducking by ear, ducking on real speech rather than a tone, separation on a full-length song or on a Mac without a GPU, and Chrome and Safari themselves. Detaching only copies the clip's speed and fades, so a detached sound won't follow later trims of its clip.

### Phase 5: Animation presets, transitions and text (done)
**Built**
- `services/animation.py` and `timeline/animation.ts`: 9 enter and exit presets (fade, 4 slides, zoom, pop, blur, bounce) and 5 looks, with the same math on both sides. `timeline/fixtures/animation.expected.json` keeps them equal.
- Crossfade, wipe, slide and zoom transitions with `xfade`. Timeline length and sound don't change: the transition is centered on the cut, using footage past the trim points, or holding a frame when there is none. Sound still cuts hard.
- Text track, title presets (Big title, Lower third, Caption, Top note), style, position, size, color, typing, and enter and exit animations. `POST /api/text-image` draws preview text with the export's libass path, so letters are the same in both.
- Every item is now posed on its own frame. Fill keeps source detail instead of enlarging a shrunken picture, per-clip opacity works, and picture adjustments use one RGB formula in shader and export.
- Picking a preset plays it on the canvas. A transition replaces the enter or exit animation on its side of the cut, and the inspector says so.

**Golden-frame test:** `tools/golden_frames.py` exports every preset, then `tools/golden_check.js` compares the browser canvas with the export.

| Check | Result |
|---|---|
| Samples, covering 9 enters, 9 exits, 4 transitions, 5 looks, Tamil text through all 9 presets, zoomed clips | 139 |
| Mean difference, of 255 | 1.43 |
| Worst sample | 2.64 |
| Worst 20-pixel block in any sample | 18 |
| Golden export length | Exactly 1,920 frames |
| Tamil through a slide | Same letter shapes as the still text, checked in `test_tamil_keeps_its_shape_through_animation` |
| 60 Fill clips with transitions and animations, 1080×1920 | Exactly 2,700 frames, 205 seconds, 2.3× length, 3.4 GB peak |

**Decisions from this phase**
- Compare by averaging exact pixel blocks on both sides. Letting each side shrink the frame made equal frames look different.
- Opacity in presets is always linear, so ffmpeg's `fade` can draw it exactly.
- A clip is cropped to the frame first, and animation moves that whole frame. Otherwise a zoomed-in clip's overflow hides the slide, which the first golden run missed because its clips weren't zoomed. Keep zoomed clips in the golden test.
- `window.motionEngine` exists in dev builds only, for the golden test.
- The golden test draws directly because a hidden pane limits `requestAnimationFrame` to about once a second. That may explain the Phase 3 playback freezes, but it hasn't been proven.
- The blur preview is a one-pass approximation of the export's Gaussian blur. It's close on moving frames, not identical.

**Not yet proven:** how long text takes to appear while typing wasn't timed. The golden test needs a browser, so `./test.sh` doesn't run it; only its math and export halves run there. Transitions on rotated or HDR footage, Chrome and Safari themselves, and phone use of the new panels.

**Later:** exports with many Fill clips are over 3 times slower than plain ones. Static clips could use a plain crop instead of a per-frame overlay. Split doesn't work on text yet. Transitions work only on touching clips, and sound doesn't crossfade.

### Phase 6: Keyframes (done, curve editing not built)
**Built**
- `timeline/keyframes.ts` and `editor/Keyframes.tsx`: a stopwatch for position, size, rotation and opacity, with previous, add or remove, and next keyframe. Once a property is animated, changing it at the playhead makes a keyframe, including by dragging the picture.
- Motion styles: Smooth, Slow down and Steady. Curve editing isn't built.
- A motion path on the canvas with draggable keyframes, shown from two keyframes on, and keyframe diamonds on the timeline.
- Free rotation. Export turns the item at a fixed size with `rotate`, then scales it. Eased opacity is written per frame with `sendcmd`, because `fade` is linear only.
- A simple overlay track, needed for a logo over video: an Overlay button on each media tile, free timing and position, sound, trim, split and delete. Layer ordering and more belong to Phase 7.
- Split and trim keep motion on the same footage. A split clip now enters once and exits once.

**Tested**

| Check | Result |
|---|---|
| Golden samples, adding rotation, eased opacity, all properties together and a transparent logo crossing video | 155 |
| Mean difference, of 255 | 1.21 |
| Worst sample | 3.03 |
| Worst 20-pixel block | 37 |
| Logo animated through the UI over real video, export against preview, 6 moments | 1.62 to 1.71 |
| Exact length, UI project | 180 frames |

**Fixed along the way**
- `rotate` with `c=none` doesn't clear between frames, so animated rotation left a trail of old angles. Use `c=black@0`. The golden test caught it.
- The preview's image route always made JPEGs, so transparent logos showed as solid squares. Pictures with transparency stay PNG.
- Export turned pictures into YUV before use, which lost their transparency. Pictures now stay RGB.
- Clicking the ruler deselected the clip, and a lone keyframe's dot sat under the picture and caught drags. Both broke the second keyframe, and only a real run through the workflow showed it.

**Decisions from this phase**
- Moves between keys keep the easing of the key before them. One motion style applies to all animated properties of a clip.
- Rotation of a phone photo through EXIF already works in export, and `test_phone_photo_exports_upright` keeps it so.
- Editing a transformed clip in the inspector always acts at the playhead.

**Not yet proven:** a non-expert doing this unaided. I drove the UI, so the "done when" is met on function, not on ease. Also keyframes on many layers at once, touch dragging on phones, and Chrome and Safari themselves.

**Later:** curve editing and keyframes on text. Splitting a clip mid-move keeps the value at the cut, but each half eases on its own, so a curved stretch can change shape slightly.

### Phase 7: Full multilayer (done)
**Built**
- Layer headers beside the timeline: hide, mute, lock, bring forward and send back. Rows run text, then overlays front to back, then sound. The main track stays at the back and text stays in front.
- Lock blocks dragging, trimming, splitting, deleting, motion path dots and the inspector.
- Blend modes per overlay layer: multiply, screen, overlay, darken, lighten. Export blends color, then applies the layer's alpha. Preview copies what's underneath into a backdrop texture for the shader.
- Picture-in-picture: corner buttons with an even margin, working on any overlay, video or image.
- Resize in the preview: the selected clip shows its outline with a handle at each corner. Dragging one changes Size (and Position, so the opposite corner stays put; Option keeps the middle still). It writes the same transform as the Size slider, so export needs nothing new, and a drag is one undo step. Handles stay inside the frame when a corner is off-screen, and follow the pointer from the real corner. The math is in `frontend/src/timeline/resize.ts`.
- One-click Follow: a selected blur box or overlay gets a Follow button under it in the preview, and follows what is under it with no drawing. A blur first runs the face finder over the clip and takes the face it covers (`faceUnder` in `timeline/tracking.ts`), so it stays on the face for as long as it is in the clip; the box tracker drifted onto hair over long clips. With no face under it, it falls back to the tracker, stretched to the end of the video under it and cut where the subject is lost. Titles still draw a box, since they sit away from what they follow. Followed paths (more than 12 keys) show as a thin line in the preview and a bar on the timeline instead of a dot per frame, and a title's followed path is hidden (its transform is an offset, so the line was drawn in the wrong place). Finding faces and following show progress and the result on the preview.
- Known limit: the box tracker drifts on plain areas such as a T-shirt over long clips.
- The limit stays at 6 video layers, refused in plain words.
- `PlaybackEngine.onStruggling`: a plain message when video has to resync or frames run slow repeatedly, with Render preview. Render preview is also always available. `POST /projects/{id}/preview-render` makes a 540p draft outside the library. It plays as one clip until the next edit.
- Small overlays are worked on at their shown size.

**Tested with 6 moving 1080p sources through 720p proxies, 5 with animated position and rotation, one screen blend, a Tamil title, a ducked song, on this Mac**

| Check | Target | Result |
|---|---|---|
| Video against the clock, 6 layers, 20 seconds | Under 40 ms | Median 3 ms, peak 6 ms |
| Frames over 50 ms | None | 0 of 2,186, longest 43 ms |
| False heavy warning | None | None |
| Export length | Exact | 900 frames, 30.000 seconds |
| Export time | | 68 seconds, 2.3× length, was 177 seconds |
| Export memory peak | | 1.3 GB |
| Render preview of the same project, before the speed change | | About 50 seconds |
| Golden samples, now 4 blends at the layer limit | | 159, mean 1.40, worst 2.67, worst block 28 |

**Fixed along the way**
- Two steps set each video's rate every frame, so drift nudges barely worked. Median drift at 6 layers fell from 74 ms to 3 ms. This also applies to the near-miss in open decision 1, though it hasn't been re-measured over 5 minutes.
- Overlays were turned at full size and then shrunk, which made exports 2.6 times slower.

**Decisions from this phase**
- Measure drift against the real clock (`clockBase` and `clockStart`), not `currentTime` on the engine, which stops when the page isn't drawing.
- A gap near 1 second between frames isn't counted as struggling: hidden pages update about once a second. One such gap appeared while the pane was hidden, and none in a clean 20-second run, which supports the hidden-page explanation for the Phase 3 freeze. It isn't proven, and playback in a visible window hasn't been separately measured.
- Blend is per layer, not per clip. Overlays can't go above text.

**Not yet proven:** the heavy-project message was triggered by hand, because this Mac never struggled, so its threshold is untested on a slower machine. Also real footage, 4K sources, a machine busy with other work, Chrome and Safari themselves, and phones.

### Editor design pass (done)
Asked for after using Phase 7: adjustable panels, less flat, light and dark themes.

**Built**
- `editor/layout.tsx`: theme (system, light, dark) and layout, both stored per browser, resize handles, collapsible settings groups.
- `editor-shell.css` is token-based. Panels float on the background with 6px gaps, wells sit recessed and controls raised. The stage stays neutral dark in both themes, so colour can be judged. The timeline canvas reads the same tokens once per theme.
- Drag handles for Media, settings and timeline, with double-click and Reset layout. Handles work by keyboard. Panels can be hidden.
- Settings grouped as Framing, Motion, Colour, Animation, Speed and sound, with a dot on closed groups that hold changes.
- Media, Text and Audio tabs. Tiles show duration and a tick when used. Fit zoom on open. Shortcuts guide on `?`.
- The preview now sizes with container units, so narrow panels can't distort it. Measured 1.778 at 1440, 1000 and 375 px.

**Fixed along the way**
- Space after clicking a media tile added the clip again. Mouse clicks now release focus. Keyboard users keep it.
- Arrows or Delete on a focused handle would have reached the timeline.
- "Not Found" from an old backend now says to restart.
- Export's hover colour fell below 4.5:1 on white text.

**Not proven:** colour contrast was calculated, not measured on rendered screens. Timeline row height stays fixed on purpose, because heads, drawing and hit-testing share it.

### Phase 8: Easy automation and lyric videos (L)
- Auto captions, using Whisper and the letter-level aligner, with editable lines.
- Cut on the beat, remove silences.
- Templates for common posts.
- Move lyric videos onto the timeline as a template, and keep every current lyric feature, including AI image scenes, storyboard timing and LRC import.

**Done when:** an existing lyric project opens on the timeline and exports with no visible loss.

**Suggested order:** 0, 1, 2, 3, then 4 and 5 together, then 6, 7, 8. Phases 0–3 give a real multi-clip social editor. Give time estimates only after Phase 1, since its measurements decide how hard the later phases are.

## Home page and media
- One theme for the app, set on `<html>` by `useAppTheme` in `editor/layout.tsx`. The lyric editor follows it through `data-theme`.
- `studio.css` colours are tokens with a light and dark value, and all text was checked for 4.5:1.
- Returning users get recent projects and two compact New tiles on one screen. First-time users keep the welcome. Exports show as a pill in the top bar.
- Folders are one name per file, in `photos.folder`. A file sits in one folder at a time.
- "Remove from this video" only edits the timeline. "Delete from Motion" removes Motion's copy, and is refused while any project or generated scene uses the file. If only a project's cover uses it, the cover moves to something else in that project.

## What could make Motion unique as a video editor
Not started. Rivals' weaknesses here are guesses, not tested. Ranked for ordinary video editing.

1. **Edit by words.** Built, see below.
2. **First cut from a folder.** Drop in a day's clips and get a rough edit to refine, using local speech, sound and beat analysis, with no upload.
3. **One edit, every format.** Keep one project and give each format (9:16, 16:9, 1:1) its own framing and titles, exported together.
4. **What you see is what you export.** Keep the golden-frame test as a promise: preview and export match, with no watermark, account or upload.
5. **Saved versions.** Name a point in a project, try another cut, and compare or return to it.

### Remove background, chroma key (done)
Any clip can have a `chroma` setting: colour, strength (similarity), edge softness and colour spill. "Remove a colour" in clip settings shows the clip unkeyed and the user clicks the screen in the preview; Esc cancels. Export uses ffmpeg `chromakey` in limited-range BT.709 YUV plus `despill`; the preview shader in `playback.ts` uses the same distance formula (`timeline/chroma.ts`, `chroma_yuv` in `animation.py`). Golden samples cover a shaded picture, a compressed video, and tight and wide settings: mean gap about 2/255 on the keyed frames, 1.4 across all 163. Not yet tried on real green-screen footage; uneven lighting may need a second colour or a garbage matte later.

### Follow movement and blur boxes (done)
`tracking_service.py` follows a box with OpenCV's CSRT tracker (`opencv-contrib-python-headless`, about 130 MB) on the clip's 720p proxy, read at 640 wide: forward to the item's end and backward to its start, in 2-second pieces so memory stays small. It stops where the subject is lost, and a 5-frame average takes out the shake. `POST /api/photos/{id}/track` runs it in the render queue. `timeline/tracking.ts` maps source points to the frame with the preview shader's own geometry (fit, scale, position, turn, rotation, flips), so any framing of the clip underneath works, then turns the path into linear position keys (and size keys, if asked), thinned to within half a pixel. The result is ordinary keyframes: one Undo, editable, and exported by the existing keyframe code. "Continue from here" keeps earlier keys; "Stop following" keeps the current spot.

Blur boxes are a new `blur` layer kind, above video and below text: Blur or Pixelate, Oval or Box, strength, width and height, with position and size keyframes. Export blurs (`gblur`) or blocks (`scale` area then neighbour) the frame so far and keeps the shape through a feathered mask posed by `pose()`; the mask is padded clear before and after, as a mask that ended would repeat its last frame. Golden samples: blur about 2/255, pixelate about 4 (block edges on a checkerboard), 1.24 across all 168. A synthetic 6-second test follows within 9 px in a 1080-wide frame.

Titles have a transform too: it moves the whole title from where its Top, Middle or Bottom position puts it, under its enter and exit animations, so titles can be dragged in the preview, keyframed and made to follow. Older titles load with a resting transform. Golden samples for a moved and a moving title: about 1.5/255.

Limits: tested on synthetic footage only. Fast motion blur, the subject leaving the frame or something passing in front loses the track (it says where). Faces aren't found automatically; you draw the box.

### Fonts (done)
Titles have an English font and a Tamil font, picked from buttons that show each font in itself. English fonts are this Mac's own (Futura, Gill Sans, Optima, DIN Condensed, Impact, Didot, Bodoni, Baskerville, Georgia, Rockwell, American Typewriter, Copperplate, Snell Roundhand, SignPainter, Marker Felt, Noteworthy, Chalkduster); libass reaches them through Core Text, so nothing is downloaded. Avenir Next was left out: libass picks a slanted face of it. Tamil fonts are bundled from Google Fonts (SIL OFL, licences beside them): Hind Madurai, Catamaran, Baloo Thambi 2, Arima, Pavanam, Kavivanar, plus Noto Sans Tamil. Arima, Catamaran and Baloo Thambi 2 ship as variable fonts, which libass can't select from a folder, so fixed bold copies were made with fontTools (`varLib.instancer wght=700`). `write_title` cuts each line into Tamil and other runs (`script_runs`), so "Dream கனவு" gets both fonts. Font names are checked so they can't carry ASS formatting. The templates now use fonts too.

### Steadier person masks (fix)
On real footage Vision's mask wobbles: patches go half see-through and an arm drops out for a frame, so a title behind the person flickers through. `Steadier` in `cutout_service.py` takes the middle value of each mask pixel over 5 frames (centred, so nothing lags) and firms the inside (48 and below clear, 200 and above solid). On the user's 17-second clip, pixels flipping on and straight back went from 373 to 34 a frame. Masks are now version 2 file names, so old ones are made again.

### Title templates (done)
Ten templates in the Text tab, each shown as a picture the server draws: Cinematic, Name card, Festival, Chapter, Quote, Location, Bold reel, Minimal, News, End card (`timeline/templates.ts`). Titles gained a subtitle (its own size, colour, letter spacing, above or below), left, centre or right alignment, and a band colour. `write_title` in `timeline_service.py` draws them as one block, each line in its script's font; a title using none of the new options still goes through `write_lyrics` exactly as before. "Save as my style" keeps a look under My styles (up to 12, stored on this Mac). The title settings are now grouped: Words, Look, Subtitle, Animation.

Limits: one bundled font family (Noto Sans Bold and its Indic versions), so templates differ by size, colour, spacing and boxes rather than typeface; saved styles live in this Mac's app storage, not in projects.

### Title behind mountains or a shape (done)
On a title, "Put the title behind…": The person, Mountains, or A shape. Mountains: click along the top of the ridge or ground, and everything below the line (out to both edges) is in front (`groundShape`). A shape: click around a building, tree or object, and click the first point or press Enter to close. Backspace removes a point, Esc cancels. Either way a silent copy of the main clip goes on an "In front" layer right after the title's layer, with a `shape_mask` that keeps only that part of the frame. Export multiplies the copy's own transparency by the mask picture; the preview samples the very same picture from `/api/shape-mask` (drawn 4x larger then shrunk, with a 0.4% soft edge). Golden samples: 2.0/255. With Slide up as the title's Enter animation, it rises from behind the ridge.

Limits: the shape stays still, so the camera must too (a moving shot would need the shape to follow, via the tracker); the shape can't be edited after drawing, only removed and drawn again; the darken blend no longer has its own golden sample, as the project hit the six-layer limit.

### Behind chosen people, or objects (done)
The title's "Put the title behind…" is now People, An object, Skyline / ground and Draw around it (the last two are the drawn shapes above, renamed). People and An object add the cut-out copy and select it; its Background panel then shows "Who stays in front": People or Objects, a picture of the clip with each one tinted and numbered left to right, and chips for Everyone (All of them) or any mix of the numbers. The ones chosen stay in front of the title and the rest go behind it, so a title can sit between two people.

`native/instance_mask.swift` runs Vision's person instance masks (`VNGeneratePersonInstanceMaskRequest`) or foreground object instance masks (`VNGenerateForegroundInstanceMaskRequest`, which finds cars, buses, animals and other things that stand out) on every frame, up to 6, each trimmed by the sharp all-people mask for people. Vision numbers them afresh each frame, so `instance_service.py` follows each one by how much its outline overlaps where it was (at an eighth size, 0.2 or more), keeps a number for 15 unseen frames, steadies each mask with `Steadier`, and writes one mask per number plus `{kind}-tracks-1.json` and the numbered picture. Ones seen on fewer than 8% of frames (scene changes, flickers) are left out of the choice. A choice becomes one mask (the brightest of the chosen masks) and a see-through preview copy, named by a token like `people-0-2`, which the preview's prepared-proxy and the export (`Clip.cutout_pick`: kind and ids, only with Remove) both use. Everyone, for people, keeps the original sharp all-people mask. Two-person test clip: 120 frames in about 19 s for people, 24 s for objects.

Limits: Apple-only, like the person cut-out (a Windows build would need an ONNX instance model in place of Vision); people who cross or hug can swap numbers or merge into one; objects are whatever Vision thinks stands out, so a parked car in a busy street may not be found (then draw around it); at most 6 at a time.

### Focus on someone, blur the rest (done)
Background → Blur now has the same "Who stays in focus" picker (Everyone, or any mix of the numbered people or objects) and a Blur strength of Subtle, Medium or Strong (0.7%, 1.5% or 3% of the frame height). The chosen ones stay sharp and everything else, other people included, goes soft like a film camera focused on them. Each choice and strength is its own portrait copy and proxy (`portrait-{who}-{amount}-1.mp4`), made from the joined mask of the chosen ones, or from the sharp all-people mask for everyone; everyone at Medium is still the original `portrait-2.mp4`. The preview's token is `blur.{who}.{amount}`, such as `blur.people-1.strong`; export passes `(cutout_pick, blur_amount)` to `prepared` and uses the copy like a steadied one.

Limits: strength is three steps rather than a slider, because each one is a full-size copy made once; the focus can't move from one subject to another during a clip yet (focus pull is next).

### New background (done)
With Background → Remove, the panel shows "New background": every picture and video in the media list. Choosing one (`replaceBackground` in `timeline/model.ts`) puts it behind, filling the frame whatever its shape (Fill scale, centred, muted). A main-track clip moves up to a "Person" layer of its own at the same time, and the background takes its place on the main track with the same length and transition, so nothing after it moves. Choosing again from the cut-out clip replaces the main clip under it. A video shorter than the clip plays slower to cover it.

Limits: the background is centred, so a landscape picture in a vertical video keeps its middle (drag it or change Size to reframe); a much shorter video plays very slowly rather than looping.

### Themes (done)
A Themes tab, like iMovie's: Wedding, Festival, Travel, Birthday, Memories, Vlog and Classic, each with an English and Tamil name and a picture of its opening title (`timeline/themes.ts`). One click dresses the whole video: one colour look on every main-track clip, one transition between them (none before the first), gentle movement on photos that don't already move (push in and pull out taking turns, or a punch in), an opening title with the project's name and the theme's subtitle (up to 3.5 s, or 40% of a short video), an ending card in the last 3 s (if there is room), and the theme's fonts and colours on titles already there, keeping their words, places and sizes. Its titles live on a text layer named "Theme · <name>", which is how the editor knows the theme. Choosing another replaces it and keeps the opening words; Remove theme takes its titles away and puts clips back to their own colour and plain cuts. All of it is ordinary timeline settings, so export needs nothing new.

Limits: no theme music yet (none is bundled); photo movement from an earlier theme stays when changing theme; restyled titles keep their new look after Remove theme (undo brings back the old one).

### Focus pull (done)
With Background → Blur and people or objects found, "Pull focus at the playhead" makes the focus move part way through the clip, like a film camera: "Then the focus moves to" (Everyone, or any of the numbers), the moment (Move to playhead), and the speed (Quick 0.4 s, Smooth 1 s, Slow 2 s). `Clip.focus_pull` holds who, `at` in source seconds (of the reversed copy's own time when reversed: `focusAt` and `focusLocal` in `model.ts`) and the length. The server blends the first mask into the second with an eased step (`blend` with `T`), and blurs with that one moving mask, so partway through both are a little soft, as with a real lens. Preview and export share the copy; its token adds `.{to}@{at ms}+{length ms}`, URL-encoded since `+` would otherwise read as a space.

Limits: one pull per clip (split the clip for more); a ramped clip's pull time is shown approximately.

### Your music library, and music for themes (done)
`music_library_service.py` reads the Music app's folder (`~/Music/Music/Media.localized/Music`, or `KANAA_MUSIC_DIR`), only ever reading. Tags come from ffprobe, eight files at a time (159 tracks in about 3 s the first time), and are kept in `music-library-2.json` until a file changes; moods are worked out fresh each time from the name (most telling: "Happy Rock", "Memories") and then the genre tag (bought packs call every track "Track", so "Track 12 · Classical" is romantic). Moods: romantic, happy, birthday, calm, energetic, cinematic, inspiring, and songs (Tamil titles, which have vocals, so themes don't pick them). Effects under 30 s, talks (podcast, interview…) and anything over 15 minutes are left out; the same song kept twice shows once. Using a track copies it once into Kanaa's song store, like an upload.

Audio tab: "Your music", by mood, with listen and add-at-playhead. Themes tab: "Add music from your library" (on by default) puts a track of the theme's mood under the whole video, the closest one long enough to cover it, fading in and out and dipping under speech; "Another track" steps through the rest, and the × removes it. Theme music is the sound named "Theme music · …", replaced by the next theme and taken away with Remove theme.

Limits: moods are guessed from names and genres, so some will be off (use Another track); a song shorter than the video simply ends (no looping yet); macOS may ask once for permission to read the Music folder.

### Story templates (done)
In their own Templates tab (the left panel's six tabs sit in two rows: Media, Templates, Themes / Text, Audio, Words): Wedding highlights, Trip recap, Birthday reel, Festival day, Temple visit, Product intro and Then and now (`timeline/stories.ts`), each a list of named moments in English and Tamil with a length and a hint ("The ceremony · முகூர்த்தம் · 6s — the thali, the vows"), 22 to 28 seconds in all, and the theme that suits it. Choosing one opens its moments: click a moment to pick a clip or photo for it, "Fill the rest with my media" puts unused media into the empty ones in order, and "Make my video" lays them on the main track (replacing what was there; other layers stay) and dresses it in the story's theme with music from the library, as one undoable change. A longer video keeps the middle stretch of the moment's length, a shorter one plays whole, a photo lasts the moment; every clip fills the frame, as in a reel. Empty moments are skipped.

Limits: "the middle" is a guess at the best part (it doesn't look at the footage yet); the moments are fixed per story, though the clips can be trimmed and moved afterwards like any others.

### Cinematic finish (done)
At the top of the Themes tab, "Cinematic finish" puts a film look over the whole video, under the captions so they stay readable: widescreen bars to 2.39:1 (only on landscape and square frames; each bar is `(1 - aspect / 2.39) / 2` of the height), a teal and orange grade (teal in the shadows, orange in skin and light), glow on the highlights (above half brightness, a Gaussian of 3% of the height, screen-blended), darker edges (a smooth falloff from 45% to 105% of the way to the corners), and film grain (on brightness only, up to ±8%). Defaults: grade 70%, glow 35%, edges 55%, grain 30%; each has a slider. `Timeline.finish` holds it. Export (`finish_service.py`) uses a 33³ LUT and a vignette mask picture made from the same formulas, a quarter-size blurred highlight pass, FFmpeg noise and drawbox; the preview (`FINISH_FRAGMENT` in `playback.ts`) copies the frame and runs one shader with the same maths, before the first caption layer as the export does. A side-by-side of preview and export on the sunset photo matched by eye (grain differs, being random).

Limits: whooshes on transitions, light leaks and smooth slow motion were planned with it but are not built yet.

### Project settings (done)
Whole-film controls moved into one place: with nothing selected, the right-hand panel is Project settings, also opened by the top-bar button that now reads e.g. "1280 × 720 · 30 fps". Format: the shape (Reels, YouTube, square, portrait post, or the same shape as the clip) and the frame rate (24, 25, 30, 50, 60, each with a plain note on when to use it). Look: the current theme (with a button to the Themes tab) and the cinematic finish, moved out of the Themes tab. Sound: Even out loudness (also still offered at export). Frame rate was already part of the timeline schema; a new export test renders a two-clip edit with a crossfade at each rate and checks the stream rate and an exact frame count of 2 × fps. Clip panels keep only shot-specific controls.

Limits: export defaults and safe-area guides are not in Project settings yet; changing the shape refits clips but does not reframe them around people (that is the auto-reframe task).

### Effects on and off (done)
Every clip's effects can be listed, switched off and on, or removed. "Active on this clip" at the top of the clip panel lists only what the clip has (Look, Colour, Background, Green screen, Steady, Backwards, Speed effect, Animation with its point count, Enter and exit, Transition in, Clean voice), each with an eye switch and ✕; "All off" and "All back on". Right-clicking a clip on the timeline gives an Effects submenu with a tick per effect (the menu stays open, so several can be flipped, and the ticks always show the current state) and Turn all off, plus Remove effects with each effect and Remove all effects. The menu stays the same size however many effects a clip has. A switched-off effect is kept in `clip.bypass`, so its settings survive; one rule set on each side leaves it out of what plays (frontend `playingTimeline`, backend `playing_timeline` before compiling), so preview, preview renders and export agree, and a switched-off background needs no mask or blurred copy. Tests: export frames with a look, a green screen and animation switched off match the plain clip; a switched-off removed background exports without a mask; frontend tests for listing, switching, all off and remove. Browser check: switching Mono off brought the sky's colour back in the preview, and undo restored it.

Limits: plain speed, freeze frames and drawn shapes are not listed as effects (they change timing or are the clip's purpose); titles, sounds and blur boxes have no effect switches yet.

### Three ways to start a video (done)
New video offers: **Blank project** (the default when nothing is picked), **pick clips** (videos and photos together, numbered in the order they are clicked, up to 200), or **Use a folder** (every video and photo in a media folder, in name order). The server builds the first timeline (`starting_timeline` in `api/routes.py`): clips in order on the main track, whole videos, photos for 5 s, framed like the first clip; a blank project uses one shared "Blank canvas.png" record as its required starting media and an empty main track. The recipe carries `fresh: true` until the editor's first save, so the editor still asks "Where will you post this?"; the timeline route strips the marker, so the strict schema never sees it. "Same as my clip" now uses the first clip on the main track, and is not offered for an empty project. Test: a blank start, a shared canvas, and a photo-then-video start in order with the right lengths and a valid timeline.

Limits: "Blank canvas.png" shows in Media (shared, one file); a folder start takes the media list loaded in Studio (the first 100 imports plus any loaded with Load more).

### Clean voice (done)
A switch on any clip (Speed and sound) or sound. `voice_service.py` makes a cleaned whole-file copy once (FLAC, 48 kHz) with a high-pass at 80 Hz and ffmpeg's `afftdn` (24 dB, noise floor -30 dB, tracking the noise as it changes). The filter runs 1199 samples late, so that much is trimmed and padded back; the copy lines up with the picture within a sample. Export reads the copy (`voices` in `render_timeline`); the preview mutes the video's own sound and plays the copy through the mixer as a sound at the clip's place, speed, volume and fades, so it still ducks music.

Chosen by measurement on a real voice (an 11-second public speech clip, kept out of the repo) with added hiss and fan noise: the built-in filter brought the voice closest to the clean recording (spectral distance 20.6 to 16.8 dB with hiss, 25.9 to 17.2 with a fan) at full level. RNNoise (`arnndn`) turned the voice down about 6 dB and left more noise, and a compressor after it only made speech quieter, so neither is used.

Limits: it lowers steady noise (fans, AC, hiss, hum, traffic), not other voices, music or sudden sounds; very loud noise under the voice remains; not tried on the user's own recordings yet.

### Remove pauses (done)
A panel at the top of the Words tab: pauses longer than 0.4, 0.7 or 1 second, and optionally fillers ("um", "uh", "hmm", and Tamil and Hindi equivalents, compared without case or punctuation; `isFiller` in `timeline/words.ts`). It says how many it will take out and how much shorter the video gets, computed from the same cut plan (`cutRuns`) the cut uses, so the promise matches. One click cuts them all through `cutTokens`, keeping a short breath at each pause; existing captions are made again from what is left, in the same Undo. A spoken test clip with two long silences and an "um" went from 8.88 to 3.35 seconds (5.5 promised) with every word kept.

Limits: it relies on the transcript, so a pause only counts where Whisper found words on both sides (or the clip's start and end); fillers Whisper leaves out of the transcript can't be found; main track only.

### Auto captions (done)
Text tab, Captions: words per caption (1 to 4) and Add captions. It uses the Words tab's transcripts of the main track, transcribing any clip that has none first, and cuts lines at pauses over 0.6 s, at sentence ends, at commas once a line has two words, and at 24 letters (`timeline/captions.ts`). Captions are their own layer kind, on top of everything, with one look for all: style, position, size, colour, and an optional colour for the word being spoken. Selecting a caption lets you retype it; the same number of words keeps each word's timing. Export writes every caption state to one ASS file and draws it with one `ass` filter, since a long talk has too many captions to add one by one; `write_lyrics` gained `marks` to colour the lit word. The preview shows the same states as images from `/api/caption-image`, fetched three at a time, nearest the playhead first. Golden samples (Tamil and English, lit words): 1.3 to 2.0/255. A spoken test clip (macOS `say`) was captioned in 9 seconds including transcription.

Limits: captions come from the main track only; cutting words afterwards leaves them stale until made again; no per-caption styling or animation; Whisper's spelling of names needs fixing by hand.

The Text tab is now three even sections (Titles, Captions, Hide something), each a heading, one line of help and a two-column grid where wide actions span both columns.

### Cut out the person (done)
Background in Framing: Keep, Blur or Remove, for any video clip; on a title, "Put behind the person". `native/person_mask.swift` runs Apple's Vision person segmentation (accurate quality, a sequence handler for steadiness) on this Mac's Neural Engine; `cutout_service.py` compiles it once with `swiftc` (Apple's command line tools) into `data/bin`, pipes frames through it, and keeps a person mask at up to 1280 px with the clip's prepared files, about 9 frames a second. From the mask: Remove gets a VP9 see-through preview copy (the browser plays its transparency, but drops the colour under it), and export applies the mask to the full video with `alphamerge`; Blur gets a portrait copy, blurred under the mask and used like a steadied one. "Put behind the person" adds a silent cut-out copy of the main clip on a "Person" layer right after the title's layer. Steady, backwards and cut-out combine, each copy made from the one before.

The preview now seeks a quarter frame into each frame, as the export reads, so a time right on a frame's edge can't show the frame before; fast-moving people made that one-frame slip visible. Golden samples with real people (a public-domain NASA portrait, passed with PERSON_VIDEO): remove 1.0 to 1.1, blur 2.2 to 2.4, title behind 2.1/255; all 200 samples 1.36.

Limits: needs Apple's command line tools (`xcode-select --install`) for the first build; people only, not pets or objects; one fixed blur strength; Remove on the main track shows black (put the clip on an overlay over a new background); "Put behind the person" copies the clip, so later edits to the main clip don't follow. Not yet tried on real footage with hair, hands or several people overlapping.

### Speed ramps (done)
Presets in Speed and sound: Hero, Bullet, Montage, Speed up, Slow down, with a small curve and the playhead on it. A ramp is relative speed at points through the clip's time, scaled to average 1, so the clip keeps its length and the speed slider becomes the overall speed (`timeline/ramp.ts`, `services/ramp.py`; the two are checked against each other). Export moves each source frame with an exact `setpts` expression (the inverse of the piecewise-quadratic share) and `fps=` keeps the nearest frame. The preview follows the curve by changing the video's playback rate as it plays (drift under 20 ms in testing). Splitting a ramped clip keeps every moment in place; I and O split there too. Freeze, tracking and face finding use the ramp-aware `sourceAt`/`localAt`. Golden samples 2.0 to 2.7/255.

Limits: sound is off on a ramped clip (atempo can't change speed smoothly); slow parts repeat frames unless the footage has more frames (60 or 120 fps); dragging a ramped clip's edge stretches its curve over the new range; no custom curve editing yet.

### Steady shaky video (done)
A checkbox in Framing for any video clip. `stabilise_service.py` runs ffmpeg's vid.stab in two passes (detect with shakiness 6, then transform with 20 frames of smoothing and an automatic zoom so moving edges stay hidden) and keeps a steady copy plus its proxy with the clip's prepared files. The motion file uses vid.stab's text format: this build can't read back its own binary one ("Cannot parse localmotion"). Export always uses the steady copy (`prepared_copy` in `timeline_routes.py`); the preview shows the original until the copy is ready. Steady and backwards together reverse the steady copy. A synthetic hand-held pan went from 6.75 px of frame-to-frame shake to 0.12 px with every frame kept; golden samples 2.1 to 3.1/255. Not yet tried on real phone footage, rolling shutter wobble or very fast pans.

### Quick effects (done)
- **Freeze frame** (toolbar, or right-click a main clip): splits the clip at the playhead and puts a 2-second `freeze` clip between, holding that source frame, silent. Export reads exactly one frame and holds it.
- **Play backwards** (main track, Speed and sound): `reverse_service.py` makes a reversed copy once, in 2-second pieces so memory stays small, plus its proxy; export always uses it, and the preview plays forwards until it is ready. Reversed clips are silent. Splitting and trimming a reversed clip move the far end of its source.
- **Quick moves** (Motion): Push in, Pull out, Punch in here, Shake here (`timeline/presets.ts`), written as ordinary keyframes.
- **Transitions**: Flash and Dip to black use ffmpeg's `fadewhite`/`fadeblack`; their weights were measured and are matched by `dipWeights`. Whip is a slide plus a sideways blur peaking halfway.
- **Split screen** (overlay Framing): side by side or top and bottom, each clip whole in its half, with bars when shapes differ.

Golden samples: flash and dip 0.8 to 2.5/255, freeze 2.2, reverse 1.8 to 2.7, whip about 4 (the preview's sideways blur is an approximation). Glitch was left out: no matching preview yet. Possible later: reverse and freeze on overlays, filling each half of a split screen with cropping.

### Blur faces (done)
"Blur faces" (Text tab, or right-click the preview) searches the clip at the playhead. `face_service.py` runs OpenCV's YuNet detector (`face_detection_yunet_2023mar.onnx`, 232 KB, MIT, from the OpenCV model zoo; fetched once into `backend/.models/face` and checked against its SHA-256) on every frame at 640 wide, about 1 second per 4 seconds of video. Sightings are joined into people by distance, gaps up to half a second are filled, sightings shorter than 8 frames are dropped, and at most 12 people are blurred, the biggest first. For privacy, boxes are padded past hairline and chin and never shrink below 90% of the person's usual size when half hidden. Each person becomes one oval blur box with position and size keys (`blurForFace` in `timeline/tracking.ts`), in one Undo.

Tested on a clip made from a public-domain NASA portrait: two people, one briefly covered, overlapping at the end; both found, speeds within 1%, and the export blurs each face throughout. Not yet tried on real footage with profiles, crowds, low light or fast motion; check the result before posting.

### Edit by words (done)
`transcript_service.py` runs Whisper on this Mac and stores words with the clip's prepared files, per language. The Words tab in the editor shows the main track as text. Cuts go through `timeline/words.ts`, so each is a normal timeline change and one Undo.

| Check | Result |
|---|---|
| English, 32 words, synthetic voice | 32 exact, 1.8 seconds for 11 seconds |
| Tamil, 26 words, synthetic voice | 21 exact, 96% of letters, 3.7 seconds for 12 seconds |
| Export after cutting a word, a phrase and a Tamil word | Exactly the expected length, phrase and Tamil word gone |

For speech, Whisper runs one pass at temperature 0 with beam 1. On Tamil that was 14 times faster than the default fallback, with the same word count.

**Known limit:** Whisper's word edges can be off in fast, joined speech. Cutting "beautiful" left a fragment heard as "Abful", because Whisper gave the word 0.22 seconds. Snapping to quiet points and sharing time by word length were tried. Neither clearly helped, and word length was worse on Tamil, so neither shipped. Scoring cuts by comparing transcripts wasn't sensitive enough, so a better measure is needed before trying again.

**Not yet proven:** real human speech, especially Tamil, and long videos. Titles, overlays and separate sounds don't move when words are cut.

## Phase 2 on `dev_cloud` (built in a cloud session, not yet checked on the Mac)

Everything here was tested with generated clips on Linux only. None of it has met real footage, real faces or the Mac app yet.

### Drag and drop, and Simple / Pro (done)
`timeline/drop.ts` holds the drop logic: a JSON payload per tile (media, look, transition, title, music track, effect) and where it lands on the timeline (main track inserts at the drop point; below it adds on top). `TimelineView.tsx` draws a line and a hint while dragging and refuses drops that can't work (locked layers, a transition on the first clip). Every drop is one Undo. The lyric editor takes a song dropped anywhere, and a lyric line dropped on an image starts that image with the line (`slides.startImageAt`, saved as the storyboard). Simple mode (`layout.simple`, `SimpleContext`) hides keyframes, More sections, Green screen and frame rate; a Pro group already in use stays visible. It is off by default.

### Cut to the beat (done)
`timeline/beats.ts`: each main-track clip ends on the nearest beat of the longest song (beats from `beat_service.py`). Clips may grow up to their source's end or shrink to 0.5 s. With a 120 bpm click track the cuts landed about 0.03 s before each beat (under a frame).

### Push in towards faces (done)
`focus_service.py` finds the main faces in a photo or a video frame with YuNet; `presets.applyMove` zooms about that point, so the face stays put while the picture grows, and themes do the same for photos. It never downloads the face finder: until Blur faces (or a feature that asks) has fetched it, moves aim at the middle as before. **Not yet proven:** real photos of people.

### Split at scene changes (done)
`scene_service.py` compares small colour histograms frame to frame; a cut is a jump above 0.35 and three times the recent average, at least a second from the last. A 3-shot test video split at exactly 3.0 and 6.0 seconds. A pan is not a cut.

### Special effects (done)
`effect_service.py` draws eight effects in code on black (Confetti, Sparkles, Flower shower, Bokeh lights, Fireworks, Light leak, Film burn, Snow), 5 s at 720p on the short side, once per project shape (1–8 s each), filed in the Effects folder. `drop.placeEffect` puts each on an "Effects" overlay layer with the Screen blend, so preview and export use the existing overlay path and match without new code. **Not yet proven:** an exported MP4 with an effect, and whether the strength suits real footage.

### Auto-reframe: follow the person (done)
`reframe_service.subject_path` takes the face finder's paths, picks the biggest face at each half second, holds gaps, ignores movement under 4% of the picture and smooths over 1.5 s. `timeline/reframe.ts` turns it into x/y keyframes at the fill scale, never uncovering an edge. Offered when a clip's shape differs from the frame's (Frame tab, right-click). It asks before fetching the face finder. **Not yet proven:** real people walking, two people talking.

### Best moments for stories (done)
`moment_service.py` samples 5 frames a second and scores sharpness, exposure, steadiness and (when the face finder is already here) faces; a story moment uses the best-scoring stretch instead of the middle, skipping the first and last 0.3 s. Ties go to the middle. If it fails, stories fall back to the middle.

### Captions clear of faces (done)
A caption can now carry its own `position` (schema and `model.ts`), passed to libass per line, so preview images and export agree (a render test checks the moved caption is at the top). `timeline/clear-faces.ts` moves a caption that would cover a face to the top, else the middle, for that caption only. Making captions again resets them.

### Ask AI (done)
The editor became "AI ready" on the existing AI settings: the same OpenAI-compatible address and API key as image generation, plus a Text model. `text_ai_service.py` calls it through the official `openai` Python library (added to `requirements.txt`), so any compatible provider works, in the cloud with a key or on this Mac without one (Ollama, LM Studio). `edit_plan_service.py` gives the model a fixed catalogue of eleven commands (theme, look, transition, title, effect, cut to the beat, captions, captions clear of faces, shape, story template, caption translation) and the editor's real ids, then checks every command it returns; the editor checks again (`timeline/commands.ts`) and shows them as a ticked list. The person applies them; each runs through the editor's own action on the latest timeline and is one Undo. Caption translation keeps each caption's time and shares it evenly between the new words. "Words to post" writes a title, description and hashtags. Only text leaves the Mac: the request, file names, titles and captions.

**Tested:** the catalogue checks, prompt contents, reply parsing, key handling and provider errors against a fake provider; in a browser against a local fake OpenAI-compatible server, a four-edit plan applied exactly (and an unknown effect was dropped). **Not yet proven:** a real model's plans, in English and Tamil, and how often they need correcting. Choosing a model and judging its answers is the owner's next step.

### Lyric video director (done)
"Let AI direct the scenes" in Create consistent AI scenes: `lyric_director_service.py` sends the numbered lyrics (any language) to the text model, which splits them into scenes by meaning (contiguous, covering every line; gaps and overlaps are joined) and writes one English continuity bible and a visual for each scene. Non-ASCII is folded out of everything that goes into image prompts, and `plan_scenes(…, direction)` saves the plan exactly as a hand-built one, so editing prompts, generating and placing images on lyric times work as before. Lyrics never reach image prompts (a test checks every prompt). **Not yet proven:** a real model's reading of Tamil lyrics, and image quality from its descriptions.

### Whooshes and hits (done)
`sound_effect_service.py` lists Kanaa's own whoosh (filtered noise swelling to 0.5 s) and hit (a falling low thump), made in code into the song store, then the library's short files whose names say whoosh, swoosh, impact, boom and so on (only read, copied when used). Each comes with its loudest moment; `timeline/sfx.ts` places one per transition (at the cut) and per title (at its start) so the peak lands on the moment, replacing earlier ones. An export check found the whoosh loudest on the cut.

### Smooth music loops (done)
`timeline/loop.ts`: Loop to the end of the video, on a song that ends before the picture does, repeats it by whole bars (4 beats from `beat_service.py`, from the last beat near its end back to the earliest bar boundary, at least 4 s) with 30 ms joins and a fade at the picture's end. Without a clear beat it repeats the whole song. **Not yet proven:** how the joins sound on real songs; a bar is assumed to be 4 beats.

### Travel maps (done)
Effects → Travel map: 2 to 6 places, Flight/Road/Train/Boat per leg, Light/Night/Vintage, names in English, Tamil or both. Data: Natural Earth 10m countries in India's point of view (13 MB), 50m states, lakes and rivers, and GeoNames cities over 15,000 (CC BY 4.0), fetched once after a confirm and checked (zip or GeoJSON, never an error page). Search runs on this Mac, matching old and Tamil names. Flights follow the great circle; roads come from the OSRM demo server (no key, only the two points sent, cached per pair) with a curve fallback; trains use the road. `travel_map_render.py` draws Web Mercator outlines (culled and simplified per frame, 2× supersampled), the route drawing behind the vehicle, pins and Tamil-shaped labels (raqm), a credit line, and a camera that pulls back and settles on the destination: about 8 s for one leg, 40–60 s to render at 720p. **Not yet proven:** GeoNames and OSRM from the Mac (both blocked in the cloud session), real road routes, and long multi-stop trips.

### Cinematic title reveal, 3D titles and Lock to the scene (done, Mac session, November 2026)
Builds on Ground rise behind. **Reveals** (Title → Motion → Cinematic reveal, `cinemaReveal` in `model.ts`): Rise from behind (`rise-behind`), Push through (`push-through`) and Uncovered as they pass (no entrance; the subject crosses it), each putting people or an object in front through `groundRiseBehind` and adding depth to the rising and flying ones. The presets add `tilt` to a look, mirrored in `animation.ts` and `animation.py`. **3D** (`Transform.tilt_x`, `tilt_y`, with keyframes; `Text.depth`): `title3d.py` and `title3d.ts` turn a title's pose into four corners per depth layer through a fixed 40° camera, tilting about the letters' own box (found from the title picture's alpha, padded 4 px, on both sides); depth layers step back along `EXTRUDE` in the title's own space so the sides show and turn with the tilt. The preview draws each layer as a projective quad through the inverse homography (`TITLE_FRAGMENT`); the export warps the title picture with `cv2.warpPerspective` per frame and layer (`title3d_render.py`) into an ffv1 video overlaid like a flat title. Flat titles keep the old path. `tools/title3d_fixture.py` writes shared cases that both sides are tested against (corners within 0.01 px). **Lock to the scene** (`Text.pin`: clip id and pin moment; `scene_track_service.py`): Shi-Tomasi corners, Lucas-Kanade flow and a RANSAC homography per frame on the proxy, chained out from the pin moment both ways, held when fewer than 24 points agree, smoothed over 5 frames (mirrored at the ends), kept as JSON with the clip's prepared files. The title's corners go through placement × track × placement⁻¹ (`scene_matrix`). On a synthetic 4 px-a-frame pan with a person walking across it, the track stays within 1 px and the export moves the title 120 px over 30 frames. **Limits:** tracked on synthetic clips only; plain sky, water, dark shots and crowds filling the frame will slip; Lock to the scene refuses reversed and speed-ramped clips and doesn't follow a clip's own move or zoom keyframes; Tilt and Turn have sliders but no keyframe buttons yet; 3D titles take longer to export: each frame is warped in Python, only where the title reaches; measured about 105 ms a frame at 1080p and 460 ms at 4K with full depth (15 layers), so a 3-second 3D title adds about 10 s at 1080p and 40 s at 4K.

**Lock to the scene on the skyline** (November 2026, from the owner's Pongal hilltop clip). On a walking shot the whole-picture homography follows the near ground, so a title locked on the horizon was squashed about 7× and sheared by 18 s, as if painted on the ground. With Sky only in front (`on_skyline` in `title3d.py`, `onSkyline` in `model.ts`: the layer just above the title shows the clip's land), the track is asked for with `horizon` and made differently (`scene_track_service.py`): each step is a pan and turn at the same size (`estimateAffinePartial2D`, the zoom taken out about the agreeing points), from corners within 0.15 of the height of the skyline, people masked; each frame's skyline is fitted as a line from `find_sky` (points well above it, heads and trees, dropped), steadied over 15 frames, and the pin moment's skyline is turned and lifted onto it (`_on_skyline`). Kept as a separate file (`track_path(..., horizon=True)`), and the preview and export read the same matrices. On the owner's clip, checked against the sun (a point at infinity, followed frame by frame): mean 0.040 of the frame off (0.075 for the old track), within 0.02 in height throughout, lagging up to 0.1 sideways during the fast turn at 17–22 s; the letters keep their shape within 1.5% and tilt within 2° of the horizon. **Limits:** needs sky across at least a third of the frame's width; a title locked anywhere else still uses the homography and can squash on walking shots.

## Lyric video backlog
For later. This is an important feature, and it comes after the editing work.

- Text styles: static text as well as lyric text, with more styles.
- Colourful template animations.
- Trustworthy lyrics: paste the real lyrics, align them, and flag doubtful lines. Whisper matched 28% of the words on one song, so alignment beats transcription.
- Karaoke maker: instrumental plus a letter-by-letter wipe, with an adjustable guide vocal.
- Dual-script lyrics: a Tamil line with an editable romanized line on shared timing.
- Private until release: a visible "nothing left this Mac" indicator. AI scenes stay an explicit opt-in that says what is sent.
- One song, every format: a 9:16 chorus, a 16:9 full video and a 1:1 version, reusing the sync.

**Known behaviour to decide:** changing a main clip's speed moves later clips, but sounds and text stay put, which can break lyric sync.

## Mac app
The product is named Kanaa (கனா, "dream"). The folder, `WIDEANGLE_MOTION_*` settings and saved data keep the old name, so existing projects and setups keep working.

`desktop/build.sh` builds `Kanaa.app` and installs it in Applications. It's Electron 33 with `desktop/main.cjs` inside, chosen because Chromium is the engine every phase was tested on. FastAPI serves `frontend/dist`.

- The app runs this folder's code and data, so it only works on this Mac and the folder must stay put. Rerun `build.sh` after code changes.
- It's signed ad hoc. Sharing it needs an Apple Developer ID, notarization, and bundled Python, ffmpeg and models.
- Don't use `@electron/packager`: its unpacking step exits silently on Node 26.
- Only one Motion can use port 8010. If an older one from the terminal holds it, the app says so.

## AI backlog
Not started. Every AI edit must be a normal timeline change, so one Undo removes it. Build in this order.

| Order | Feature | What it does | Runs on | Phase |
|---|---|---|---|---|
| 1 | Auto captions | Tamil or English captions on the timeline, editable, using the title styles | This Mac: Whisper | 8 |
| 2 | Remove silences | Finds pauses and removes them after a review | This Mac | 8 |
| 3 | Cut to the beat | Snaps clips to the song, using `beat_service.py` | This Mac | 8 |
| 4 | Auto reframe | Turns 16:9 into 9:16 and keeps faces in frame | This Mac | After 8 |
| 5 | Edit by asking | A request such as "make a 30-second Reel with captions" becomes timeline changes | Cloud AI, optional | After 1 to 3, which it uses as tools |
| 6 | Highlights | Picks the best moments from a long video using speech and sound | Cloud AI, optional | After 5 |
| 7 | AI B-roll | Generates images for what's being said, reusing the lyric scene builder | Cloud AI, optional | After 5 |

**Notes**
- Tamil caption accuracy is the main risk. Whisper matched 28% of the lyric words on one song. Singing is harder than speech, so captions must be easy to correct, and pasting known lyrics to align them should be an option.
- Cloud features send project details to an outside service, so they need a clear opt-in.

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
- Motion stands alone, with no link to Photos, no shared database and no required process.

---

## Open decisions for the owner

1. Are the Phase 1 near-misses acceptable? Peak drift was 58 ms against 40 ms, and one edge was 2 px against under 2 px. The suggestion is to accept both, and require 99.9% of drift under 45 ms and no peak over 80 ms.
2. Which is the target: desktop Chrome only, or phones too? This plan assumes desktop first, with basic phone support.
3. Decided: stem separation is an optional add-on (Phase 4).
4. Should stickers, emoji and licensed music be included? Emoji doesn't render in exports today, and music needs a licensed source.

### Title batch 1: picture animations and title moves (November 2026, Mac session)
Asked for after comparing Kanaa's titles with a familiar editor's title list (42 designs: 10 already here, 10 close, 22 missing). Batch 1 adds 12 of the missing ones in two kinds, both built on maths the preview and export already share.

**Picture animations** (Enter/Exit, titles only): Reveal (a wipe from the left), Soft edge (the same with a wide soft edge), Line (a line drawn out under the words, then the words rise from it; it stays as an underline), Chromatic (red and blue copies close in), Prism (four rainbow copies on a slant close in) and Echo (four copies below, each half as strong, close in). `lookAt`/`look_at` give a `PictureLook` (reveal, soft, rise, line, split, trick), combined for enter and exit by `pictureLook`/`picture_look`; the fixture `animation.expected.json` holds both to the same numbers. They are drawn in the title's own picture before it is posed, so a title with one goes through the 3D path on both sides (`is3d`/`is_3d`): the preview's `TITLE_FRAGMENT` and `picture_tricks` in `title3d_render.py` do the same steps (premultiplied samples, smoothstep masks across the letters' box, a line in the title colour). Copy tricks draw within `trickBounds`/`trick_bounds`, the letters' box widened by 1.25 letter heights.

**Title moves** (Title → Motion → Title moves, `timeline/titleMoves.ts`): Drifting (grows 8%), Sideways drift and Vertical drift (4% of the frame each way), Ticker (x from 1.5 to −0.5, at the bottom), Scrolling credits (y from 1.5 to −0.5) and Story crawl (leans back 55°, rises and shrinks). Each is ordinary keyframes over the title's length; Stand still freezes it where it is (and undoes a crawl's lean). Ticker, credits and crawl clear Enter and Exit, which would only fight them.

**Checked:** export tests render every picture animation and look for what it should draw (the wipe's edge, the line alone then under the words, red left of blue, yellow and cyan copies, light below the words for echo) and that each settles to the plain title within 1/255; the golden test has 39 new samples (each animation entering, at rest and leaving, plus ticker and crawl), all within 1.32–1.43 mean and 9 worst of 255, the same as untouched samples. **Limits:** a title's picture is the frame, so a ticker or credits longer than the frame's width or height are cut; credits are one title's lines, not a list; picture animations go through the slower 3D export path (each frame drawn in Python, only where the title reaches).

### Title batch 2: laid-out titles and a date title (November 2026, Mac session)
Six more of the missing title designs. **Layouts** (`Text.design`, Style → Layout; `title_design.py`): Gradient bar (a bar from the left edge, 85% under the words, fading out over 30% of the width; Bar colour, black or white), Formal bar (ivory across the frame, two fine rules in the subtitle colour, words centred), Overlap (the subtitle's left edge reaches back over the end of the title by 22% of the title's height, the pair kept centred and inside the frame) and Four corners (title top left, subtitle bottom right, 6% of the height in). The words are drawn by libass as every title is (plain on a bar), measured from their alpha, and laid out in numpy in the same picture, so the preview (`/api/text-image`) and export share one picture. Templates: Gradient black, Gradient white, Formal, Overlap, Four corners, Date and Date in Tamil. **Date** (`/api/photos/{id}/recorded`, `media_probe.recorded_at`): a camera's own local date tag (`com.apple.quicktime.creationdate`, Blackmagic `dateRecorded`) as written, else a UTC `creation_time` in this Mac's time, else a photo's EXIF date; `dateWords` writes "15 December 2024" and "Sunday · 5:32 pm" (or Tamil month and day names). With no date in the file, today is used and the editor says so.

**Fixed on the way:** the text picture cache (`/api/text-image`) ignored letter spacing, so the preview could show an old picture after spacing changed; and spacing on an otherwise plain title was never drawn, in preview or export (it now counts as a designed look). **Limits:** a gradient's words sit on the left and a formal bar's in the middle, whatever Alignment says; Four corners moves as one picture, so a move or animation carries both corners together; Overlap has no control for how far it tucks in.

### Title batch 3: letter by letter (November 2026, Mac session)
Four Enter/Exit animations for titles that move each letter on its own: Pop-up letters (each pops up, one after another across 60% of the animation), Gravity (each drops from 1.4 title heights above with a bounce, one after another), Split (all start 1.2× further from the middle and close in) and Expand (all start bunched at 15% of their spread and open out). `letterLook`/`letter_look` share the numbers (the `letters` rows of `animation.expected.json`).

**Finding the letters** (`title_letters.py`, `/api/text-letters`): the title is drawn once more by libass, plain, with each letter in its own colour (red = 3 × its number, `write_title(letter_ids=…)`). A letter is a whole Tamil letter, with its vowel sign or pulli (`letter_clusters`). Its red is read after dividing by alpha (soft edges come back darkened), specks under 4% of a letter are dropped (blended edges between neighbours), the numbered drawing is lined up with the real picture's letter fill (a plain title's writer places words 2–3 px differently; coarse then fine search), and every visible pixel takes the nearest letter's number within 0.3 of the title size. Pixels of no letter (a band's box) stay still. More than 64 letters move in 64 groups; a laid-out title has no letters and moves whole. **Drawing:** the export's `moving_letters` (title3d_render.py) and the preview's `pm()` in `TITLE_FRAGMENT` move, size (about each letter's middle) and fade each letter of the title picture before the picture tricks and the pose, so letter animations go through the 3D path; the preview reads the same letter map (nearest) and boxes.

**Checked:** a letter map covers 95–99% of every letter's fill at 720p and 4K and every visible pixel; reading order kept; the API sends the export's map exactly; exports show the first letters popping first, a letter above the title for Gravity, wider for Split, narrower for Expand, and each settles to the plain title within 1/255. **Limits:** letters move flat (no turning); a ligature that joins two Tamil letters into one shape moves with the first; finding letters takes about 0.3 s at 720p and 1.5 s at 4K, once per look.

### Title batch 4: drawn backings and flourishes (November 2026, Mac session)
The last of the missing title designs, as four more layouts (`Text.design`; `title_art.py`, called from `title_design.py`): Clouds (a cloud with bumps along its top, round ends and a light rim, behind the words), Paper (a strip torn at both ends, with grain and a soft shadow), Torn edge (a band with a torn top edge and pale paper fibres along the tear, to the bottom of the frame for a lower third; black, tan or any Backing colour) and Flourishes (curling vines with leaves either side of the title line and a fine line with a diamond beneath, in the subtitle colour). Drawn in code at twice the size and shrunk, with seeded randomness, so a title always gets the same shapes and the preview and export share one picture, as with batch 2's layouts. Templates: Clouds, Paper, Torn edge black, Torn edge tan, Flourishes and Flourishes lower. **Checked:** each design's shape (bumpy cloud top, ragged paper ends, a band across the frame under a pale tear, vines past both sides of the words) and that drawing it twice gives the same picture; looked at on the owner's hilltop clip. Not golden-tested separately: these go through the same shared picture as batch 2's layouts, which the golden test matched. **Limits:** the shapes don't change with the words' length beyond stretching to fit; Flourishes follow the title line's size, so a very large title gets vines up to 16% of the frame wide.

With batch 4, every design on the owner's list has a Kanaa version (42 in all; see the batch notes above for which were already here).

### Title extras: Horizontal blur and titles that bring an effect (November 2026, Mac session)
The five "close, with an extra step" designs made one click. **Horizontal blur** (`blur-sideways`, Enter/Exit): a sideways blur of the title picture, 0.3 letter heights wide easing to sharp, opacity over the first 60%; `PictureLook.streak`; both sides take 17 samples (`STREAK_TAPS` either side) on a bell curve out to three widths, the export by shifted copies, the preview in `TITLE_FRAGMENT`. **Template extras** (`Template.extra`): Lens flare (`lens-flare` effect), Pixie dust (Magic form and Magic vanish with the `sparkles` effect), Boogie lights (Pop-up letters with `bokeh`) lay their effect on the Effects layer for the title's length (`addEffect(…, length)` trims it); Pull focus pairs a Blur entrance with a full-frame blur box (amount 0.35) whose opacity keys fade it in over the entrance and out over the exit (`defocusBox`). **Fixed on the way:** the preview drew blur boxes at full strength whatever their opacity keys; the export already faded them, so a fading blur looked different. **Checked:** export test (wider, not taller, then settles), fixture rows, Pull focus keys, the effect ids exist in effect_service; golden samples for Horizontal blur and Pull focus.

### Transitions batch A: directions, circles and cross blur (November 2026, Mac session)
After the titles, the owner's transition list (24): 5 were here, 5 close, 14 missing. Batch A: **Direction** for Wipe and Slide (`Transition.direction`: left, the default, right, up or down; `xfade_name` picks xfade's `wiperight`, `slideup` and so on; the preview's scissors and slide offsets follow the same way), **Circle open** and **Circle close** (xfade's `circleopen`/`circleclose`; the preview weights each clip per pixel by the same soft circle, `smoothstep(0, 1, distance/half-diagonal + shift)`, adding on black as xfade mixes, `circleWeight` in animation.ts) and **Cross blur** (a crossfade blurred every way, peaking at 0.025 of the frame height halfway: `whip_blur(..., sideways=False)` sets gblur's sigma and sigmaV per frame; the preview blurs both clips, which is the same as blurring their mix). **Checked:** exports with each direction show the old clip on the side it leaves from and the new on the other; circles open from the middle and close from the edges; a cross blur softens a hard edge to under half its sharpness halfway and leaves it untouched before; golden samples for the three new kinds at 0.2, 0.5 and 0.8 and every wipe and slide direction.

### Transitions batch B: transitions that move pixels (November 2026, Mac session)
Spin in, Spin out, Doorway, Puzzle left, Puzzle right, Mosaic, Ripple and Cross zoom. **Export** (`moving_transitions.py`): an xfade `custom` expression can read either clip anywhere (`a0(x, y)`), but evaluating it for every pixel took minutes per transition at 4K, so instead the n overlapping frames of each clip are cut out of the joined stream (`Builder.moving_transition`), the transition's frames are built from them with ffmpeg's native filters and joined again, frame for frame as xfade would: spins (scale, centre, rotate, overlay), doorway (two cropped halves overlaid apart over the new clip growing from 75%), puzzle (4 × 3 cropped pieces overlaid sliding a frame's width, eased out, each 0.5 of the transition later in the order of how near they start), mosaic (8 × 5 tiles narrowing and widening at tile size, stacked by hstack and vstack; tile order (7i + 3) mod 40), ripple (`displace`, its maps drawn 320 wide by geq inside the graph and scaled up: rings travelling out, 0.012 of the height at most, strongest halfway; then a fade. Maps from files held the golden export's first frame back 34 s) and cross zoom (the average of 5 sizes up to 1.25× further, into the old clip to 1.8× and out of the new; then a fade). Overlays are packed RGB, so what's clear stays clear. **Preview** (`TRANSITION_FRAGMENT`, `drawMoving`): what is under the layer is kept, each clip is drawn alone on black and on white (so its see-through is known), and the shader builds the same moves with the same constants (`MOVING` in animation.ts), including ffmpeg's rounding (even sizes, whole-pixel overlay places truncated towards zero, pixel-centre scaling). **Cost at 4K** (a 4 s video with one 1 s transition; a crossfade takes 6.2 s): spin 8.2, doorway 7.9, puzzle 7.3, mosaic 10.4, ripple 11.0, cross zoom 28.6. **Checked:** each keeps the video's length, starts as the old clip and ends as the new, and halfway shows its own shape (the spun clip small in the middle, the doors at the sides, more puzzle pieces in on the side they come from, both clips in the mosaic, an even mix for ripple and cross zoom); `displace` was confirmed to read from position + shift; golden samples at 0.2, 0.5 and 0.8 of each in the full golden project (Spin, Doorway, Puzzle, Mosaic 1.0–1.9 of 255; Cross zoom 2.3–2.5; Crossfade there 1.6–1.9), and a small golden project on high-detail checkerboards after Ripple's map fix (all 1.2–3.0; Ripple had been 26–35 until every plane of its maps held the shift). On the owner's 4K hilltop clip, 18 s with eight of them took 218 s against 83 s with crossfades: about 17 s more each.

**Thread budget (found by the golden test, fixed for every export).** Every input's decoding (about 11 threads) and every scale filter (one pool as large as the machine's cores; 60 scales measured 490 threads, with `threads=2` far fewer) start their own threads, and macOS allows one program 4,096. The golden project (160 inputs, about 600 scales) already peaked at 3,729 before this batch, and a long real video with many clips could fail ("Error reinitializing filters" / "Resource temporarily unavailable"); this batch's transitions pushed the golden test over. `fit_threads` now estimates a graph's threads: a short video is left as it is; a big one gets 2 threads for each input's decoding and each written scale (`limit_scale_threads`), and the graph's own thread count comes down only if even that is too many. Measured on the golden project's first 20 s: 110 s and 3,729 threads as before, 100 s and 2,168 threads throttled. Capping the whole graph to one thread instead (`-filter_complex_threads 1`) was 2–4× slower.

### Transitions batch C: 3D transitions (November 2026, Mac session)
Cube, Swap, Page curl left and Page curl right, the last of the owner's transition list. **Cube and Swap** treat each clip as a card in 3D (`card_corners` in moving_transitions.py, `cardCorners` in animation.ts, step for step): seen by a camera 1.6 frame widths away, the cube turns a quarter turn left about its middle, half a width back, the old clip its front face and the new its right face; in a swap the cards slide apart (0.32 of a width), back (0.9) and turn a little (0.5 rad), most at the middle, and the new card comes to the front halfway. The export warps each clip with ffmpeg's `perspective` (sense=destination, a 2-pixel clear border first, since it smears edge pixels outward; its frame counter `in` starts at 1, which put the export a frame ahead until found by the preview comparison); the preview draws each card through the inverse of its homography. **Page curl**: the fold moves from the edge across the frame (eased); left of it the old picture, over it the turned flap from 2·fold − W, its back: the picture mirrored, faint (0.18) on light paper (205); right of it the new clip. Page curl right is the same mirrored. The export builds the flap and its masks from overlays on whole pixels (drawbox sizes aren't redrawn per frame), the preview the same per pixel.
**Checked:** export tests (old clip before, new after, and halfway the old face left and the new right for the cube, the cards apart with the new in front for the swap, the flap's paper over half the frame for page curls); a frontend test that cube and swap cards start and end flat on the frame; golden samples at 0.2, 0.5 and 0.8 in the full golden project (Cube 1.2–1.8, Swap 1.1–1.4, Page curls 1.5–2.2 of 255; Crossfade there 1.6–1.9). On the owner's 4K hilltop clip, 10 s with the four took 63 s against 43 s with crossfades: about 5 s more each.

### Transition badges on the timeline (November 2026, Mac session)
Each cut of the main track shows its transition: a pill with its icon and length on the cut, and a band under the clips as long as the transition, centred on the cut; a plain cut shows a faint + on hover. Clicking a pill opens a popover hanging from it (`TransitionPopover.tsx`): the last picture of the clip before and the first of the clip after (filmstrip tiles), every transition in five groups (`TRANSITION_GROUPS` in transitions.ts, tested to hold every kind the export knows, once), the length (slider and 0.3/0.6/1/1.5 s; no longer than the shorter clip either side, nor 2 s), the direction for Wipe and Slide, and Preview (plays from just before to just after it), Every cut and Remove. It follows its badge when the timeline scrolls; Escape or a click outside closes it. The side panel's catalogue moved to `transition-catalog.tsx` for both.
