# Feature brief — 3D text, fly-through reveals, cinematic light

**For:** a coding agent working on Kanaa (கனா).

**Goal:** add title and light features that make Kanaa's lyric videos feel like After Effects work, while staying **one click** for the owner.

Work through the features below in order. Each one is its own commit that passes its tests. Read the rules in §5 before starting.

## 1. What already exists (build on it, don't duplicate)

| Area | Where | What it does today |
|---|---|---|
| 3D titles | `frontend/src/timeline/title3d.ts` and `editor/playback.ts` (`drawTitle3d`) for the preview; `backend/app/services/title3d.py` and `title3d_render.py` (`frame_at`) for the export | Extruded depth (`TitleDepth`: amount, colour, light, angle), tilt, and cinematic reveals `rise-behind` and `push-through`. Each frame is drawn in Python with numpy; a still stretch is drawn once (`_drawer`). |
| Letter tricks | `animation.py` / `animation.ts` (`PICTURE_PRESETS`, `LETTER_PRESETS`, `letter_looks`) | pop-letters, gravity, split, expand, reveal, soft-edge, line, chromatic, prism, echo, blur-sideways |
| Title animations | `animation.py` `look_at` and `scale_expression`; `animation.ts` `lookAt` | fade, slides, zoom, pop, blur, bounce, blast, magic, particle-form, **fly-through, rapid-zoom** (the last two are new). They're checked against a shared fixture, `timeline/fixtures/animation.expected.json`. |
| Light effects | `backend/app/services/effect_service.py` | Drawn in code as 5 s 720p videos laid on an Effects layer with **Screen** blending: lens-flare, anamorphic, anamorphic-gold, light-leak, sun-rays, prism-leak, film-burn, shine, bokeh, light-flicker, dust, embers and more. They have preview tiles in `editor-shell.css` (`.fx-<id>`) and appear in the Effects tab. |
| Lights inside the picture | `picture_lights_service.py`, `sky_light_service.py`, `lamp_glow_service.py` | Glow on real lamps, the sun and the sky inside a scene picture |
| Finish | `finish_service.py` and `FINISH_FRAGMENT` in `playback.ts` | Whole-video grade, glow, vignette and grain |
| GPU export | `gpu_render.py` and `native/gpu_render.swift` | Draws the timeline on the GPU when `unsupported()` is empty; otherwise ffmpeg. Letter and 3D titles reach the GPU as frame sequences (`title3d_render.render_title_sequence`). |

**Three paths must agree:**
- the **preview** (`playback.ts`, WebGL);
- the **ffmpeg export** (`timeline_service.py`);
- the **GPU export** (`gpu_render.py`).

A feature isn't done until all three draw it the same, or `unsupported()` keeps it on ffmpeg with a reason.

## 2. Features, in order

### F1. Better 3D text (materials and light)
Today the 3D depth is a flat extrusion colour with one light amount. Add **one-click 3D looks**, each a preset over `TitleDepth` plus new optional fields:
- **Gold:** warm metallic face gradient, darker gold sides, a bright edge bevel.
- **Chrome / silver:** cool gradient, a strong highlight.
- **Stone / carved:** matte, with a soft shadow beneath.
- **Neon glow:** face lit, coloured glow around it.
- **Glass:** semi-transparent face, bright edges.

Implementation notes:
- Extend `TitleDepth` with `material`, `bevel` (0–1) and `shine`. Mirror the change in both `timeline_schema.py` and `model.ts`.
- Draw in `title3d_render.frame_at` (export) and `drawTitle3d` (preview) with the same maths.
- Add a **light sweep** option: a moving highlight that crosses the letters' face once after the entrance. It's like the existing `shine` effect, but drawn *on the letters* only.
- UI: a row of 5 named chips under 3D, with plain labels and Tamil translations. No sliders unless they sit under "More".

### F2. 3D fly-through reveal ("through the letters into the scene")
This is the signature After Effects opener.
1. The title starts **huge and close**. The camera is inside or just in front of one letter.
2. The **scene shows only through the letter shapes** (the letters act as a window: a track matte). Outside them it's black or a solid colour.
3. The camera **pulls back** through the 3D letters, which shrink and tilt slightly in perspective.
4. Near the end, the matte **opens out** until the whole scene is revealed. The title can stay as a normal 3D title, or fade out.

Implementation notes:
- Add a new title animation preset **`fly-reveal`**, an entrance with a duration of about 1.5–3 s. It needs:
  - a **matte mode**: the title's alpha cuts the layers *below* it. This is new compositing; in the export it's an `alphamerge` of the frames below with the title's alpha, and in the preview a shader pass.
  - **3D perspective**, using the existing depth and tilt maths in `title3d`.
  - a **zoom curve** from about 12× down to 1×. The export must not scale a full frame to more than about 5× (see the fly-through cap in `animation.py`), so draw the large stages by cropping and scaling only the visible part.
- Add a matching **exit `fly-through-3d`**, where the camera flies *into* a letter and through to the next scene. This can double as a transition between scenes.
- **One-click home:** in the Cinematic reveal menu (`CinemaPicker` in `parts.tsx`), add "Through the letters".
- **Check:** render the matte both ways with a white frame under a black title, then compare against the ffmpeg path at 35 dB or better.

### F3. Cinematic light effects (After Effects style)
Add to `effect_service.py` as new effects, drawn in code, Screen-blended, with preview tiles. Each one needs a Tamil name and a one-line "about".

| Effect | What it looks like |
|---|---|
| **Volumetric light rays (god rays)** | Beams through the frame from a corner, with gently drifting dust in them |
| **Light sweep across the frame** | A soft bright band crossing diagonally, for a title-card moment |
| **Optical flare, multi-element** | A flare with rings, a starburst, hexagonal ghosts and a streak; it drifts slowly. Warm and cool versions. |
| **Light wipe transition** | A bright white-gold flash wipe between two scenes. Add it as a **transition kind** (`timeline_schema.Transition`), and implement it in ffmpeg xfade, the GPU (`_transition`) and the preview. |
| **Glow pulse / bloom hit** | A short bloom on the beat (pairs with `beat_pulse`) |
| **Light streak trails** | Thin glowing streaks racing across, like a long-exposure city at night |
| **Film light leak, burnt edges (warm)** | Organic orange-red leaks crawling in from the edges (a richer version of `light-leak`) |
| **Sparkle dust drifting in a beam** | Fine gold particles catching the light |

Also add **text-tracked light**: a lens flare or glint that **follows a title** (anchored to the title's position over time, using `value_at`). Add it to a title as a one-click "Glint", like the existing title decorations in `decorateTitle`.

### F4. Presets that combine these
For the owner, these are the actual buttons:
- **"Cinematic opener":** F2 fly-reveal, gold 3D title (F1), volumetric rays and sparkle dust (F3).
- **"Golden title card":** gold 3D, light sweep, warm optical flare.
- **"Verse change":** light wipe transition, plus a bloom hit on the beat.

Add them to the Templates / Text tab next to the existing title templates (`timeline/templates.ts`).

## 3. Acceptance (each feature)
- **Preview and ffmpeg export match:** run the golden check (`tools/golden_frames.py`) or a focused comparison, averaging about 1.5/255 mean difference or ≥ 35 dB.
- **GPU export:** either draws the feature (compare with `tools/gpu_compare.py` or the `MatchesFfmpeg` pattern in `tests/test_gpu_render.py`), or `unsupported()` names it so ffmpeg is used.
- **Tests:**
  - unit tests for the maths, using the shared fixture for any new animation preset;
  - a render test that measures the effect on real frames (see `test_fly_through_and_rapid_zoom_grow_the_picture_as_the_math_says`);
  - the full backend suite (`./test.sh`).
- **Proof:** a short contact sheet of real rendered frames for each feature, in the final report.
- **Performance:** a 4–5 minute lyric video with these features must still export on the GPU in a few minutes. Draw only the frames that change, as `title3d_render._drawer` does.

## 4. Suggested order and size
1. F3 light effects, the self-contained ones first (small each).
2. F1 3D materials and light sweep (medium).
3. F2 fly-through reveal with the matte (large; build the matte compositing first, then the 3D camera).
4. F3 light wipe transition and text-tracked glint (medium).
5. F4 presets (small).

## 5. Rules for this repo (from the owner; follow exactly)
- Work in a **git worktree** `../wideangle-motion-<name>`, with `frontend/node_modules`, `backend/.venv` and `backend/.models` symlinked from the main checkout.
- **Stage explicit paths only.** Commit messages end with `Co-Authored-By: <your model> <noreply@<your vendor>>`.
- **Don't push** and **don't restart Kanaa** (port 8010). Don't start exports in the owner's app; use throwaway servers (API on port 8011 with a scratch data folder, Vite on 5191) for UI checks.
- **The owner's media and music are read-only.** Never commit or upload bought music. Never print or commit the API key in `.mcp.json`.
- **New features go in their own modules.** Don't grow `Editor.tsx`, and keep hooks into `timeline_service.py` minimal.
- **Ease of use:** one-click named presets with good defaults; advanced controls go under "More". Labels are plain English with Tamil translations (`i18n-ta.ts`).
- **Jobs:** when waiting on a Kanaa job, request it **once** and wait on that job id. Never re-request in a loop: that once queued 556 duplicate jobs.
- **Backups:** if you edit a real project, back it up first to `backend/.data/backups/`, not `/tmp`, which a restart erases. Validate with `Timeline.model_validate` before saving.
- **Report honestly** what was rendered and checked and what wasn't.
