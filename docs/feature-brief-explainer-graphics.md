# Feature brief — explainer graphics: numbers, steps and framing

**For:** a coding agent working on Kanaa (கனா).

**Goal:** small animated graphics that explain things over footage, the kind YouTube explainers and documentaries use:
- charts that grow;
- numbers that count up;
- step lists;
- comparisons;
- timelines;
- lower thirds;
- chapter cards;
- icons.

They're for any video, not only lyric videos. Each one must be **one click to add** with a good default look, then easy to change.

> **Not in this brief:** arrows, circles, callout labels, spotlight, glow outline and "follows the object". Another session is building those (they reuse Click to choose and the Remove dialog code). Don't touch `editor/RemovePersonDialog.tsx`, `backend/app/services/click_select.py`, `remove_person.py` or `popout.py`.

Read the rules in §6 before starting. Work through the parts in order; each one is its own commit that passes its tests.

---

## 1. First: how a graphic is drawn (do this before any graphic)

Every graphic must look the same in all three render paths:
- the **preview** (`frontend/src/editor/playback.ts`, WebGL);
- the **ffmpeg export** (`backend/app/services/timeline_service.py`);
- the **GPU export** (`gpu_render.py` plus `native/gpu_render.swift`).

It also needs **see-through areas**, because it sits over footage.

**Recommended design (prove it first):**
1. One Python module draws a graphic's frames from its settings (Pillow and numpy, as `title3d_render.py` and `travel_map_render.py` draw theirs).
2. The frames are encoded once into a **video with alpha**, made as a Kanaa job and cached by a hash of the settings.
3. The graphic sits on the timeline as an ordinary **overlay clip** on its own layer, named "Graphics", with its settings stored on the clip. Changing a setting re-renders it.

**Spike first (its own commit, with tests):** prove a short video with alpha:
- plays see-through in the **preview** (Electron's Chromium; VP9 WebM with alpha is the likely choice);
- composites see-through in the **ffmpeg export** (ProRes 4444 or PNG-in-MOV, for example);
- composites see-through in the **GPU export** (AVFoundation reads ProRes 4444 alpha);
- is **exactly the same moving picture** in all three.

If one path can't, say so and propose the alternative, such as PNG frame sequences like `title3d_render.render_title_sequence`. **Stop and report before building on a design that fails.**

**Acceptance for the spike:** a red disc moving over a blue picture, rendered by the preview, ffmpeg and the GPU. The blue shows around the disc in all three, and the GPU and ffmpeg renders match at ≥ 35 dB (`tests/test_gpu_render.py` has the comparison pattern).

## 2. The graphics, in this order

Each one:
- comes with **3–4 one-click styles** ("Clean white", "Documentary yellow", "Dark band", "Bold colour"), which follow the project's theme and fonts, Tamil included;
- has **entrance and exit** animations: draws on, pops, slides, fades;
- has a **length** that follows the clip;
- uses plain labels with Tamil translations (`i18n-ta.ts`), with fine controls under "More".

### G1. Count-up number (small)
- "0 → 2,000" ticking up with an easing curve, with an optional label ("years") and prefix or suffix.
- Lakh and crore grouping as an option (2,00,000), plus Tamil numerals as an option.

### G2. Animated bar chart (medium)
- Type or paste up to 8 rows of "label, value".
- Bars grow in one after another, with values shown on the bars.
- Horizontal or vertical; one highlight colour for one bar.

### G3. Line chart (medium)
- Up to 12 points. The line draws itself left to right, with a dot running along the end and an optional value label at the end.

### G4. Pie / donut (small)
- Up to 6 slices that sweep in, with labels and percentages.

### G5. Step list (small)
- "1. … 2. … 3. …": steps appear one by one.
- Option: **time each step to the playhead**, so you set when each step appears by moving the playhead and clicking. Store the times on the clip.

### G6. Lower third (small)
- Name and role, with 4 styles. A bar or line draws on, then the text slides in.

### G7. Chapter card (small)
- "Part 2 — The Sangam age", full-screen over a darkened frame, or in a corner.

### G8. Comparison split (medium)
- Two clips or pictures with a sliding divider and "Before / After" (or any two words) labels.
- This is a picture-in-picture arrangement rather than a drawn graphic. Build it from two overlay clips plus a moving divider graphic.

### G9. Timeline bar (medium)
- Dates on a line, with a marker moving from one to the next, and an optional label per date.

### G10. Icons and stickers (small)
- A small built-in set: pin, warning, tick, cross, question, star, heart, arrow-up and arrow-down trend. Pop or draw-on entrance.
- Draw them in code or use bundled SVGs with an open licence, and list them in `LICENSES.md`.

## 3. Where they appear (one-click homes)

- **Left panel:** a **Graphics** tab (or a section in the Text tab) with a tile per graphic, showing a small looping preview of its default style. A click adds it at the playhead on the Graphics layer.
- **Inspector:** selecting a graphic clip opens its settings in the right panel. Keep this module separate (`editor/inspectors/GraphicInspector.tsx`); don't grow `ClipInspector.tsx`.
- **Right-click on the preview:** **Add graphic ▸** with the same list, placed where you clicked when that makes sense (lower third: bottom left; icon: at the point).
- The preview's clip bar (`editor/preview/ClipQuickBar.tsx`) needs no change. **⇧Space** already plays just the selected clip.

## 4. Acceptance (each graphic)

- **Same in all three paths:** preview vs ffmpeg export within about 1.5/255 mean (`tools/golden_frames.py` style), and GPU vs ffmpeg ≥ 35 dB, or `gpu_render.unsupported()` names it and ffmpeg is used.
- **Tests:**
  - unit tests for the settings and maths (count-up easing, bar heights, pie angles, step timing);
  - a render test on real frames (a bar's height at a known time matches its value);
  - the full suite (`./test.sh`).
- **Proof:** a contact sheet of real rendered frames for each graphic and style, in the final report.
- **Performance:** a graphic renders once (cached by its settings), so exports stay fast. Adding ten graphics to a 5-minute video must not slow the GPU export noticeably.

## 5. Suggested order and size

| # | Part | Size |
|---|---|---|
| 0 | Spike: video with alpha in all three paths | small to medium |
| 1 | The graphic framework: settings on a clip, render job, cache, Graphics layer, inspector shell | medium |
| 2 | G1 count-up, G6 lower third, G7 chapter card | small each |
| 3 | G2 bars, G3 line, G4 pie | medium |
| 4 | G5 step list, G9 timeline, G10 icons | small to medium |
| 5 | G8 comparison split | medium |
| 6 | Graphics tab, preview right-click menu, Tamil labels, guide article | small |

## 6. Rules for this repo (from the owner; follow exactly)

- Work in a **git worktree** `../wideangle-motion-<name>`, with `frontend/node_modules`, `backend/.venv` and `backend/.models` symlinked from the main checkout. **Never edit the main checkout directly.**
- **Stage explicit paths only.** Commit messages end with `Co-Authored-By: <your model> <noreply@<your vendor>>`.
- **Run the tests, then merge as a separate step.** Never chain a merge after tests in a way that runs even if they fail.
- **Don't push** and **don't restart Kanaa** (port 8010) or start exports in it. For UI checks use throwaway servers: API on port 8011 with a scratch data folder (`WIDEANGLE_MOTION_DATA_DIR`), Vite on 5191 with `MOTION_API_TARGET`.
- **The owner's media and music are read-only.** Never commit or upload bought music. Never print or commit the API key in `.mcp.json`.
- **New features go in their own modules.** Keep hooks into `timeline_service.py`, `Editor.tsx` (under about 1,200 lines) and `ClipInspector.tsx` minimal.
- **Jobs:** request a Kanaa job **once** and wait on that job id. Never re-request in a loop.
- **Downloads** (fonts, icon sets): ask the owner first, giving the file, source and size.
- **Ease of use:** one-click named styles with good defaults; plain labels and Tamil translations; advanced controls under "More".
- **Report honestly** what was rendered and checked and what wasn't.

## 7. Reporting

At the end, report:
- the commits;
- the spike's result (which video-with-alpha format each path uses);
- test results;
- the preview / ffmpeg / GPU comparison numbers per graphic;
- a contact sheet of real frames;
- what wasn't checked.
