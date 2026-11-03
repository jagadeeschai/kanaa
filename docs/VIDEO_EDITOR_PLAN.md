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
