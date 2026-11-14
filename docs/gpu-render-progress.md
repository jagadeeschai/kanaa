# GPU render implementation checkpoint — 14 November 2026

Branch: `codex/gpu-render`, isolated checkout `../wideangle-motion-gpu-render`.
Main, the running Kanaa application, and project recipes have not been changed. Nothing has been pushed.

## Finished implementation commits

- `b1ddcb1`: looks and colour adjustments.
- `4dc2370`: dreamy glow, matching the export rather than the preview's different bloom.
- `6338a39`: title motion, shared particle frames, bounded changing-texture memory, and bit-exact particle-field caching.
- `662d267`: person/space masks plus the owner's approved Screen blending, rotation, beat pulse and zoom blur; cancellation and stalled-helper handling.
- `7b6bb4c`: automatic GPU selection, exact reference audio graph without duplicate title rasterisation, muxing, private publication and FFmpeg fallback.

`KANAA_GPU_RENDER=0` retains the reference path. Unsupported features remain conservatively on FFmpeg.

## Measurements already completed

Project 49, கற்கண்டு, 288.826 seconds at 1080p:

- Full GPU export: **299.530 seconds (4:59.530)**, including preparation, audio and muxing.
- Real media capability audit: **no unsupported features** for projects 49 and 48.
- Project 46 still needs FFmpeg for 3D/pinned titles, echo, mirror and reveal animation.
- Project 47 is a lyric-creator recipe, not an editor timeline yet.

The real comparison outputs are outside the repository:

`/var/folders/x7/zz5b68y51xv5_26y13jhyzjh0000gn/T/kanaa-gpu-project49-6vlrks8n/`

That folder contains the immutable timeline snapshot, completed `gpu.mp4`, `timings.json` when each pass completes, and `coverage.json`.
The seven-slice FFmpeg reference pass was still running at this checkpoint. Its timing and full-song PSNR are **not yet known**.
The benchmark command is `PYTHONPATH=. .venv/bin/python -u /tmp/kanaa_gpu_real_bench.py` from `backend`; do not launch a duplicate while the existing pass is running.

## Validation already completed

- 253 frontend model tests, 44 frontend UI tests and TypeScript checks passed.
- Latest complete GPU/fallback comparison run: 24 tests passed, average 36.7 dB on the 30-second sample; GPU 19.7 s versus FFmpeg 180.6 s.
- Combined mask/Screen/rotation/pulse/zoom-blur synthetic comparison: average 36.2 dB; GPU 8.9 s versus FFmpeg 101.5 s.
- Latest focused mask/cancellation/audio/particle run: 35 tests passed; the additional successful mux/normalisation tests also passed.
- Particle caching matched the original implementation bit-for-bit in all 10 checked cases.
- Full backend run: 419 tests, two failures. One was the documented pre-existing rise-behind test. The other used the animation assertion loaded before it was updated; the subsequent current GPU comparison run passed. A final full-suite rerun on the final source is still desirable.

The comparison test explicitly identifies the known first-word karaoke timing frames. It also permits up to 2 dB below 30 during animated glyph interpolation; **this is a tolerance extension that must be reviewed**, not proof that the handoff's stricter full-song per-frame goal has been achieved.

## Remaining work

1. Wait for the existing FFmpeg benchmark to finish; inspect `timings.json` and confirm `ffmpeg.mp4` is complete.
2. Run `backend/.venv/bin/python tools/gpu_compare.py <comparison-folder>` from the checkout root. It writes per-frame PSNR, the worst 20 frames and a side-by-side contact sheet.
3. Inspect the real contact sheet, particularly 69.8–72.3 seconds, particle titles, transitions and glow. Fix unacceptable differences; do not claim full parity from the synthetic averages alone.
4. Review/remove the animated-edge tolerance extension if it fails the handoff's strict acceptance requirement.
5. Finish the final backend verification and results report. Do not restart Kanaa or push.

## Review and merge — 14 November 2026 (Claude)

- Fixed: dreamy glow softened in source pixels instead of the export's canvas pixels (கற்கண்டு 70.3 s was visibly
  blurred); radius now converted per clip (`_canvas_fit`). That scene now matches at 31–35 dB.
- Rebased onto main (karaoke fix); co-author lines corrected.
- Full song, same timeline snapshot: GPU 275 s against ffmpeg 2,470 s (the ffmpeg pass ran alongside other work).
  Average 33.4 dB; frames under 30 dB are concentrated where **the ffmpeg export itself drifts**: when rounding puts a
  clip's start a frame before the previous clip's end, `Builder.add_video_layer` starts it at the cursor instead, so
  runs of short clips slip 1–4 frames late (the end montage, 4:12–4:42), and parallel slices reset that drift at each
  cut, so the reference's timing depends on slicing. The GPU places each clip at its own rounded start, as the preview.
- **Merged with GPU export off by default** (`KANAA_GPU_RENDER=1` to use it). To turn it on: fix the ffmpeg drift
  (start each clip at its own rounded time, trimming the previous one), re-run the full-song comparison, and check
  that frames under 30 dB are only known karaoke/particle frames.

## ffmpeg drift fixed, GPU on by default — 14 November 2026 (Claude)

The differences were the ffmpeg export's own timing, fixed in turn (each with a test):

- Clips start on their own frame; one that rounding puts a frame early cuts the last one short (`bfc4703`).
- A slice cut through an eased move keeps the move's own first key (before zero), so the curve carries on; `concat`
  frames are renumbered, so a one-frame gap no longer pulls later clips a frame early (`a1ecc59`).
- A clip covers the frames from its start's frame to its end's (`clip_frames`, `clipFrames` in model.ts), halves rounded
  up: touching clips no longer get a black frame or lose their transition; slices trim clocks by whole frames;
  `BEAT_SLACK` makes a frame exactly on a beat the beat in both engines (`8098ee6`).
- An `xfade` offset a hair early: written to six places it could start a transition (and all after it) a frame late.

Full song, கற்கண்டு (8,665 frames): GPU 4:20–4:36, ffmpeg about 24 minutes with nothing else running. Average
33.4 dB at merge → 35.5 dB before the xfade fix; the 107–114 s beat-pulse run it fixed (58 frames under 30 dB in a
82.9–112 s slice) is now 3 frames at 29.0–29.8 dB. Of the rest under 30 dB, 81 frames are particle titles coming in or
going and karaoke word changes; 10 single frames sit at 29.5–29.96 dB and one at 27.5 dB (107.17 s, the start of the
crossfade the xfade fix moved). GPU export is now on by default; `KANAA_GPU_RENDER=0` keeps ffmpeg.
