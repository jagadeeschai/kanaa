# Release 1 brief — what must be done before Kanaa goes public

**For:** a coding agent working on Kanaa (கனா).

**Goal:** make Kanaa ready for its first public release. That means:
- finish the two **blockers** (B1, B2);
- add five features chosen because they fit Kanaa's promise, **professional results without a learning curve**;
- complete the readiness work.

Do the parts **in order**. Each item is its own commit (or small set of commits) that passes the tests. Read the rules in §6 first.

> Kanaa is **not** trying to become Premiere or Resolve. Every feature here is one-click first, with plain names, good defaults and Tamil labels. Fine controls go under "More". If a design starts to need a manual, simplify it.

---

## 1. Blockers (do these first; nothing else ships before them)

### B1. Split `frontend/src/editor/Editor.tsx`
- **Now:** **2,823 lines**. **Target:** under about **1,200**, with each panel, tool and overlay in its own file.
- Good examples already split out: `editor/inspectors/*.tsx`, `editor/ShapeDrawing.tsx`, `editor/useClipboard.ts`, `timeline/clipboard.ts`, `timeline/karaoke.ts`, `timeline/shapeEdit.ts`, `timeline/signatureTitles.ts`.
- What to move out, one module at a time:
  - left-panel tabs (Media, Audio, Text, Templates, Themes, Effects, Lyric tools);
  - the preview overlays (frame handles, drawing, picking, follow box);
  - the timeline toolbar;
  - export and format dialogs;
  - keyboard shortcuts (the big `useEffect` keydown handler);
  - job and effect helpers (`addEffect`, `decorateTitle`, cinema reveal handlers);
  - the lyric-sync UI.
- **Rule:** move code, don't rewrite it. Behaviour must stay identical. Run the UI tests (`npx vitest run`) and the model tests (`npm test`) after each move, and commit each move separately.

### B2. One shared editor store
- **Now:** inspectors take 30+ props (see `TextInspector`'s signature). `editor/state/EditorContext.tsx` already provides `useEditor()` with `timeline`, `change`, `pause` and `openGuide`.
- **Target:** panels read state and actions from the store (`useEditor()` or small hooks such as `useSelection()` and `useJobs()`), not from long prop lists. No inspector takes more than about 8 props.
- Keep undo and redo, autosave (`saveQueue`) and the outside-change check (the one that shows "Updated from outside this window") working exactly as now.
- Do B2 in the same files as you move them for B1, where it's natural.

**Acceptance for B1/B2:**
- `Editor.tsx` is under about 1,200 lines, and no other file grows into a grab-bag (over about 800 lines).
- Every existing UI and model test passes.
- A manual check in the throwaway app (§6): open a project, edit a clip and a title, undo, redo, export a short draft, and confirm autosave.
- Update `docs/ui-review.md` "Release 1 blockers" to say they're done.

---

## 2. Features for Release 1 (in this order)

Each must look the same in the **preview** (`editor/playback.ts`), the **ffmpeg export** (`backend/app/services/timeline_service.py`) and the **GPU export** (`gpu_render.py` plus `native/gpu_render.swift`). If the GPU can't draw something yet, `gpu_render.unsupported()` must name it so ffmpeg is used. Mirror schema changes in `timeline_schema.py` (pydantic, strict) and `frontend/src/timeline/model.ts`.

### F1. "Add" blend mode (small)
- Add `'add'` to `VideoLayer.blend` in both schemas.
- **Export:** `Builder.blended` uses ffmpeg `blend=all_mode=addition`.
- **Preview:** the `blendMode` branch in `playback.ts`.
- **GPU:** `CIAdditionCompositing`, which already exists in Swift for transitions.
- Offer it in the layer blend menu as "Add (bright light)".

### F2. Adjustment layer (medium)
- **What it does:** a new layer kind, "Adjustment". Its items are time spans carrying a look, colour adjustments or a picture effect (warm, dreamy glow, LUT, …). It changes **everything below it** during its span.
- **Schema:** `AdjustmentLayer { kind: 'adjust', items: [ { id, start, length, look?, adjust?, dreamy_glow?, lut?, lut_amount?, enter/exit fades } ] }`.
- **Export:**
  - the composite so far (`base`) goes through the same colour and effect filters used for clips (`picture_filters`, `dreamy_glow_filters`, LUT), enabled only during the span;
  - mix it in by the item's fade (an `overlay` of the graded copy with time-limited alpha, as the blur boxes do).
- **Preview:** a full-frame pass over the composite, as `FINISH_FRAGMENT` does.
- **GPU:** grade the frame composite with the existing colour and glow kernels during the span.
- **UI:**
  - "Add adjustment layer" in the Layer menu;
  - selecting one opens the clip-style Colour and Effects tabs;
  - one-click presets: "Warm the whole scene", "Cool night", "Dreamy", "Film look".

### F3. Simple colour wheels (medium)
- **What it does:** Shadows, Midtones and Highlights, each a colour puck (hue and amount) plus a brightness slider. This is lift, gamma and gain, applied **after** the existing look and adjustments, the same way in all three paths.
- **Maths, in one shared place:**
  - lift adds to the dark tones: `c + lift * (1 - c)`;
  - gamma bends the middle: `pow(c, 1 / gamma)`;
  - gain scales the bright tones: `c * gain`.

  Each takes a per-channel colour vector. Put the constants in `animation.py` / `animation.ts` style mirrored files, with a shared fixture as `timeline/fixtures/animation.expected.json` does.
- **UI:**
  - three small wheels under Colour → "More";
  - **one-click presets** at the top: "Warm shadows", "Teal and orange", "Cool highlights", "Golden hour", "Reset".
- Works on clips, and on adjustment-layer items (F2).

### F4. Voice and music EQ presets (small to medium)
- **What it does:** on a sound or a clip's audio, add **one-click presets**:
  - "Remove rumble" (high-pass at about 80 Hz);
  - "Clearer voice" (a gentle presence boost of about 3 kHz +3 dB, and a low cut);
  - "Warmer music" (low-shelf +2 dB, a high roll-off);
  - "Even out" (a gentle compressor, threshold about −18 dB, ratio 2:1, slow).
- **Export:** append ffmpeg `highpass`, `equalizer`, `bass`/`treble` and `acompressor` filters in `sound_steps()`.
- **Preview:** BiquadFilter and DynamicsCompressor nodes in `editor/audio.ts`.
- **Schema:** `audio_presets: list[...]` on `Sound` and `Clip`.
- **Don't** add a free parametric EQ UI to Release 1.
- **Check:** compare levels before and after on a test tone and on noise (as `CleanVoice` tests do), and check that preview and export use the same settings.

### F5. Slip and roll trims (medium)
- **Slip:**
  - drag inside a selected clip with a modifier (Option-drag), or use a "Slip" tool;
  - the clip stays where it is on the timeline, but a different part of its source plays (`in` and `out` move together, within the source length).
- **Roll:**
  - drag the cut between two adjacent clips on the main track;
  - one clip gets longer and the other shorter, the total length is unchanged, and transitions are kept.
- **Model functions in `timeline/model.ts`:** `slipClip(timeline, id, delta)` and `rollCut(timeline, leftId, rightId, delta)`, with unit tests (bounds, images vs videos, ramps, frozen clips, transitions).
- **UI** in the timeline view (`TimelineView.tsx`): show a ghost of the new in and out frames while dragging. These must also show as one Undo each.

---

## 3. Readiness before going public
1. **Golden check:** `tools/golden_frames.py` and `tools/golden_check.js` pass (preview vs export within about 1.5/255 mean) for every look, transition, animation and the new features.
2. **Full test suite:** `./test.sh` is green: backend unittest, frontend node tests, UI tests and `tsc`.
3. **Mac packaging:** `desktop/build.sh` produces a **signed and notarised** `Kanaa.app` / DMG. Document the steps in `README.md`. Signing credentials come from the owner; never commit them.
4. **Data safety:**
   - autosave recovery after a crash (reopen offers the last autosave);
   - a project backup on every export, kept in `backend/.data/backups`, with the 10 most recent kept per project;
   - no destructive migration without a backup.
5. **Licences:**
   - list the bundled fonts (OFL), models (Demucs, YuNet, Whisper and others) and ffmpeg build options in `LICENSES.md`;
   - confirm that nothing bundled forbids distribution.
6. **First-run experience:**
   - a short getting-started guide (Guide articles in `editor/guide-articles.ts`, in English and Tamil);
   - the empty states make sense.
7. **Performance targets:** a 4–5 minute 1080p lyric video exports in **under about 5 minutes on an M1** (GPU path). Measure two real projects and record the timings in the progress doc.

## 4. Explicitly *not* in Release 1
- Bezier graph editor.
- Nested sequences.
- VST/AU plugins.
- Sample-level audio editing.
- Unlimited tracks.
- Full planar tracking and rotoscoping.
- Matte choke and edge refine.
- A free parametric EQ.

Add them to `backlog.md` under a "Pro tools (maybe later)" heading with a one-line reason each.

## 5. Reporting
At the end, report:
- the commits;
- `Editor.tsx`'s line count before and after;
- test results;
- golden-check results;
- export timings;
- a contact sheet of real rendered frames for F1–F3;
- what wasn't checked.

## 6. Rules for this repo (from the owner; follow exactly)
- Work in a **git worktree** `../wideangle-motion-<name>`, with `frontend/node_modules`, `backend/.venv` and `backend/.models` symlinked from the main checkout. **Never edit the main checkout directly.**
- **Stage explicit paths only.** Commit messages end with `Co-Authored-By: <your model> <noreply@<your vendor>>`.
- **Run the tests, then merge as a separate step.** Never chain a merge after tests in a way that runs even if they fail.
- **Don't push** and **don't restart Kanaa** (port 8010) or start exports in it. For UI checks use throwaway servers: API on port 8011 with a scratch data folder, Vite on 5191 with `MOTION_API_TARGET`.
- **The owner's media and music are read-only.** Never commit or upload bought music. Never print or commit the API key in `.mcp.json`.
- **New features go in their own modules.** Keep hooks into `timeline_service.py` and `Editor.tsx` minimal.
- **Jobs:** request a Kanaa job **once** and wait on that job id. Never re-request in a loop.
- **Backups:** before editing any real project, back it up to `backend/.data/backups/` (not `/tmp`). Validate with `Timeline.model_validate` before saving.
- **Ease of use:** one-click named presets, plain labels and Tamil translations (`i18n-ta.ts`); advanced controls go under "More".
- **Report honestly** what was rendered and checked and what wasn't.
