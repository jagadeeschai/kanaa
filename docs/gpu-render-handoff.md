# GPU render engine — handoff brief

**Goal:** a typical Kanaa lyric video (for example கற்கண்டு, editor project 49, 4:49 at 1080p) should export in about **3–5 minutes**. Today it takes 25–30 minutes.

**How:** finish the GPU render engine for everything this kind of song uses, then make Export use the engine whenever it can draw the whole timeline. Everything else keeps the current ffmpeg path.

Work through the steps below in order. Each step is a separate commit that passes its tests. Do not change how anything looks: every frame must match the current ffmpeg export, which in turn matches the editor preview. When in doubt, the preview shader (`frontend/src/editor/playback.ts`) and `backend/app/services/timeline_service.py` are the reference.

---

## 1. Where things stand

| Piece | File | State |
|---|---|---|
| ffmpeg export (reference) | `backend/app/services/timeline_service.py` | Complete. Every frame is composed on the CPU. Long exports are cut into slices rendered in parallel (`parallel_export.py`). |
| GPU engine | `backend/native/gpu_render.swift` | Swift, Core Image (Metal), AVAssetReader decode, AVAssetWriter hardware H.264. It reads a JSON plan and draws each frame. |
| GPU bridge | `backend/app/services/gpu_render.py` | `unsupported(timeline, media)` lists what the engine cannot draw. `plan(...)` builds the per-frame JSON. `render(...)` compiles and runs the helper. **Not called by Export yet.** |
| Tests | `backend/tests/test_gpu_render.py` | Unit tests for the plan, plus `MatchesFfmpeg`, which renders the same 30 s 1080p timeline both ways and compares PSNR and speed. |

**What the engine draws today:**
- picture and video clips with x, y, scale and opacity (keyframed, eased);
- fade entrances and exits;
- titles, rasterised by the export's own `render_text_image`, karaoke included (one picture per lit state, switched per frame via `paths` and `shown`);
- crossfade, cross-blur, dip and flash transitions, each centred on the cut exactly as `Builder.add_video_layer` and `transition_frames` do it.

**Measured** on the 30 s test: GPU 8.8 s against ffmpeg 48 s with clips and titles. With transitions it took 16.7 s. Transition frames score 33–42 dB against ffmpeg.

### How the plan works (read `gpu_render.py` first)

- Each item is `{kind, path, start, frames, source_in, speed, x[], y[], scale[], opacity[]}`, plus optional `paths`/`shown` (picture per frame) and `transition` (mix with the previous item). Items are listed bottom to top.
- Every per-frame value is computed **in Python** with the export's own maths (`timeline_schema.value_at`, `timeline_service.shared_fit`, `animation.OPACITY_SPAN`, and so on), so Swift only draws. **Keep it that way:** new maths goes in Python, sampled per frame into the plan, never re-implemented in Swift.
- **Geometry**, the same as `clip_chain` plus `pose`: the source is fitted *inside* the frame (contain), that fitted picture is multiplied by `scale`, and its centre is placed at `(x·W, y·H)`. Core Image's y axis points up.
- **Colour:** the CIContext uses no colour management (`workingColorSpace`/`outputColorSpace = NSNull`), so pixel values blend the way ffmpeg blends them.
- **Encoder:** H.264, 16 Mb/s at 1080p, **no frame reordering**, a keyframe every second. With frame reordering on, B-frames were starved.

### How to build and test

```bash
cd backend
.venv/bin/python -m unittest tests.test_gpu_render                        # plan tests + 30 s comparison against ffmpeg
GPU_BENCH_SECONDS=60 .venv/bin/python -m unittest tests.test_gpu_render.MatchesFfmpeg   # longer benchmark
GPU_KEEP=1 ...                                                            # keeps both videos and prints their folder
.venv/bin/python -m unittest discover -s tests                            # full backend suite (one known failure, see §6)
```

The helper is compiled automatically by `cutout_service.helper(SOURCE)` (`swiftc -O`, cached by source hash).

To compare one moment of a real project without touching it, use `render_timeline(..., window=(start, end))` with `media_facts` and `prepared_copy` from `app/api/timeline_routes.py`, and set `WIDEANGLE_MOTION_DATA_DIR` to the real data folder. **Read only:** write outputs to a scratch folder, never into the project.

---

## 2. The work, in order

For each step:
1. extend `unsupported()` so the feature is no longer listed;
2. add its per-frame data to `plan()`;
3. draw it in Swift;
4. add the feature to the `MatchesFfmpeg` test timeline, or add a focused comparison test;
5. confirm frames match: **average ≥ 35 dB, and no frame under 30 dB except known differences**.

### Step 1 — Looks and colour adjustments
- **Reference:** `picture_filters(adjust, look)` and `adjust_filters(adjust)` in `timeline_service.py`, `LOOKS` in `animation.py`, and the preview shader in `playback.ts` (brightness, tint, gamma, fade, contrast, saturation, in that order).
- **Plan:** per clip, pass the final constants (tint vector `[r, g, b]`, gamma, fade, contrast, saturation). They don't vary per frame.
- **Swift:** use `CIColorMatrix` for the tint vector, then a small custom `CIColorKernel` (Metal) for gamma, fade, contrast and saturation in the shader's order. This gives exact parity; built-in filters don't.
- Apply them to the source picture **before** posing, as `clip_chain` does.
- Rotation, flip and turn adjustments can stay unsupported for now unless trivial.

### Step 2 — Dreamy glow
- **Reference:** `dreamy_glow_filters` (export) and `dreamyAmount`/`dreamySoftness`/`dreamyWarmth` in `playback.ts`.
- **Known difference:** the export (an unsharp blur, `eq`, `colorbalance`) and the preview (a bloom screened over the picture) differ. **Match the export**, because that's what users have been getting. Note in the commit that the preview differs.
- The export was just fixed so warm colours no longer turn grey (`pl=1` removed in `f7a5391`). Use that fixed chain as the reference.
- **Swift:** `CIGaussianBlur` with radius from `softness` approximates `unsharp` with a negative amount. Then brightness, saturation, and a small red/blue balance.
- Compare against ffmpeg on bright orange, gold and skin tones in particular.

### Step 3 — Title animations
- **Reference:** `Builder.pose` and `Builder.blur_commands` in `timeline_service.py`; `look_at`, `offset_expression`, `scale_expression`, `SLIDES` and `MAX_BLUR` in `animation.py`; `lookAt` in `frontend/src/timeline/animation.ts`.
- **Plan:** sample them per frame in Python, the same way fades already are (`_frames` in `gpu_render.py`): extra x/y offset (`dx`, `dy`), extra scale, opacity span, and blur (a fraction of the frame height).
- Presets: slide-up, slide-down, slide-left, slide-right, zoom, pop, blur, bounce, ground-rise, blast, magic-form, magic-vanish, particle-form.
- The animation moves the **whole posed frame**, not just the picture. Check `pose` for the exact order (title move first, then the animation; scale about the frame centre).
- **Particle-form, magic-form and magic-vanish on titles:** the export now draws these frames itself (`backend/app/services/particle_frames.py`, function `listing`). Reuse it to get one picture per frame and feed it through the existing `paths`/`shown` mechanism. **Do not reimplement it.**
- On **clips**, magic presets are only zoom, blur and fade, with no particles (as in the preview).
- Add `blur[]` per frame to the item and apply `CIGaussianBlur` to the posed item when > 0.
- **Leave unsupported:** 3D, tilted or pinned titles (`title3d.is_3d`), keep-clear and stay-with titles, rise-behind, push-through, and the picture tricks (chromatic, prism, echo, and so on).

### Step 4 — Behind-the-person cut-out clips (`cutout: 'remove'`)
- **Reference:** the `cut` branch in `Builder.add_video_layer`. A person mask video (`self.masks(facts, clip.cutout_pick)`, then `make_space_mask` when `depth_gap` is set) is read over the same source stretch and used as alpha via `scale2ref` plus `alphamerge`, before `clip_chain`.
- **Plan:** add `mask_path` to the item. The mask is read with the same `source_in`/speed as the clip.
- **Swift:** a second `VideoSource` for the mask, then `CIBlendWithMask` (or a colour kernel) to turn its luma into the picture's alpha, applied before looks, glow and posing.
- Masks come from `instance_service.ensure_mask`. In `render`, accept a `masks` callable the same way `render_timeline` does.
- Check against the 1:09.8–1:12.3 scene in கற்கண்டு: the woman over a background, with the lyric behind her.

### Step 5 — Connect to Export
- In `timeline_service.render_timeline`, before `_render_in_slices`: when `window is None and not draft`, the hardware encoder is available, `gpu_render.unsupported(...)` is empty, and `KANAA_GPU_RENDER` is not `'0'`, then:
  1. mix the audio once, exactly as `_render_in_slices.mix` does (`compile_timeline`, then `mix_audio`, then `normalize_loudness` when `normalize_audio` is set);
  2. render the silent video with `gpu_render.render(...)`;
  3. mux with ffmpeg (`-c:v copy`, `aac 192k`, `-t duration`, BT.709 tags, `+faststart`) into a private folder, then hard-link to `target`, as the other paths do.
- Report progress through `on_progress`: about 3% for the mix, then the GPU frames, then 99%.
- If the GPU render raises, log it and fall back to the slice or whole-graph ffmpeg path. **Never fail the export because of the GPU.**
- Respect `should_cancel`: kill the helper process when it returns true (see `job_service.stop_process_when`).
- Log which path was used (`Exporting on the GPU` / `in N slices` / `as one graph`).

### Step 6 — Measure on the real song
- Render கற்கண்டு (project 49) **both** ways into a scratch folder:
  - GPU: `KANAA_GPU_RENDER=1`;
  - current path: `KANAA_GPU_RENDER=0`.
- **Do not** export through the app, and **do not** modify the project.
- Report:
  - wall time for each;
  - PSNR per frame (worst 20 frames and their timestamps);
  - a contact sheet of frames at transitions, particle titles, the cut-out scene and the glow scenes;
  - anything still unsupported (`gpu_render.unsupported` output) for projects 49 and a few other lyric projects.

---

## 3. Known differences that are acceptable

- **Karaoke:** the ffmpeg export lights a line's **first** word one frame late (concat timing). The GPU engine lights it on the word's own frame, as the preview does. A separate fix for the ffmpeg side may land; if it does, these frames will match.
- **Edges:** a few dB lower on the edges of scaled pictures (Core Image vs ffmpeg bicubic) is fine. Visible softness or shifting is not.

## 4. Rules for this repo (from the owner; follow exactly)

- Work in a **git worktree** named `../wideangle-motion-<name>`. Symlink `frontend/node_modules`, `backend/.venv` and `backend/.models` from the main checkout. **Stage explicit paths only** (never `node_modules`).
- Commit messages end with: `Co-Authored-By: <your model> <noreply@anthropic.com>`.
- **Do not push.** The owner reviews and pushes.
- **Do not restart Kanaa** (the Electron app on port 8010) and do not start exports in it. The owner may be exporting.
- **Read only:** the owner's media and music library. Never commit or upload bought music.
- Never print or commit the API key in `.mcp.json`.
- New features go in **their own modules**. Do not grow `Editor.tsx` or add more than the minimal hook into `timeline_service.py`.
- Do not change how anything looks in the preview or the ffmpeg export unless a step says so.

## 5. Definition of done

- All of `unsupported()` is empty for project 49 (கற்கண்டு), or the remaining items are listed with a reason.
- Export uses the GPU automatically when supported, with a safe fallback and correct cancel and progress.
- Measured on கற்கண்டு:
  - **≤ 5 minutes on the GPU** (M1 Pro);
  - average PSNR ≥ 35 dB against the ffmpeg path;
  - no frame below 30 dB other than the known karaoke frames.
- Tests:
  - `tests/test_gpu_render.py` covers each step;
  - the full backend suite passes, except the known failure in §6.
- A short report in the final message: commits, timings, PSNR table, contact sheet paths, and anything left on ffmpeg.

## 6. Known pre-existing test failure (not yours)

`tests.test_timeline.MovingTitles.test_cinema_presets_rise_and_push_through_settle_flat` (rise-behind) fails on `main` already.
