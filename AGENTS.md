# Kanaa (கனா): notes for agents

Kanaa is a local, Tamil-first video editor and lyric video maker for one person on their own Mac. The aim is professional results with non-professional ease: high-impact features, no bloat (an 80/20 rule). Everything runs on this Mac; nothing is uploaded.

This file is the starting point. `docs/VIDEO_EDITOR_PLAN.md` has each feature's design, the measurements behind it and its limits, and `README.md` covers how the owner runs the app.

**Status: phase 1 is closed (November 2026).** The owner is now editing real videos with it and will send feedback. Treat that feedback as the next phase's input. Don't start new features before it arrives unless asked.

---

## How it fits together

| Part | What it is |
|---|---|
| `frontend/` | React + TypeScript + Vite. The editor, the WebGL preview and the timeline model. |
| `backend/` | FastAPI + SQLite (`backend/.data`). Media store, jobs, and export through FFmpeg 6.1 (`/opt/homebrew/bin/ffmpeg`). |
| `desktop/` | The Electron Mac app, installed by `desktop/build.sh` as `/Applications/Kanaa.app`. It runs this folder's code and serves `frontend/dist` on port 8010. While it starts it shows `desktop/splash.html` (a theatre: curtains part, a projector lights the screen with a play button, and the screen becomes the icon; about 4.5 s, then a second on "Ready"), read from this folder, so the welcome can change without a rebuild; `main.cjs` changes need `build.sh`. |
| `backend/native/` | Swift helpers using Apple Vision: `person_mask.swift` (all people) and `instance_mask.swift` (each person or object). Compiled once with `swiftc` into `.data/bin`. |
| `tools/` | `golden_frames.py` and `golden_check.js`: preview against export, frame by frame. |

**One timeline drives everything.** A timeline is JSON (version 2) with layers: video (main track and overlays), text, captions, blur boxes and audio. `backend/app/services/timeline_schema.py` (strict pydantic; extra fields are rejected) and `frontend/src/timeline/model.ts` describe the same shape. Change both together.

**Preview and export must match.** The preview (`frontend/src/editor/playback.ts`, WebGL2) and the export (`backend/app/services/timeline_service.py`, which compiles one FFmpeg `filter_complex`) implement the same maths. Constants are mirrored and commented on both sides: looks and animations in `animation.ts` and `animation.py`, the cinematic finish in `playback.ts` (`FINISH_FRAGMENT`) and `finish_service.py`. The golden check holds them to about 1.5/255 mean difference.

**Prepared copies.** Slow work (steadying, reversing, cut-out masks, per-person masks, blurred portraits, focus pulls, clean voice) is done once per source in the background (`enqueue_render`) and kept in `folder_for(content_key(path))`. The preview plays a proxy of the copy (`/api/photos/{id}/prepared-proxy?...&cutout=<token>`), and the export uses the full copy through the `prepared` and `masks` callbacks. Cut-out tokens such as `blur.people-0.strong.people-1@2500+800` are URL-encoded.

## Running, testing, shipping

- Run the tests with `./test.sh`, which runs backend unittest and the frontend node tests plus `tsc`. It must exit 0, and tests only use temporary data folders.
- Golden check: `tools/golden_frames.py API OUT.json WORK`, with `PERSON_VIDEO=…` for the people features, writes `frontend/public/golden.json`; the browser then compares. Remove the generated file afterwards.
- Build the page with `npm --prefix frontend run build`. The app serves `frontend/dist`, so a page-only change needs Cmd+R in Kanaa. A backend change needs Kanaa restarted (Cmd+Q, then reopen). Check that no render is running first, and tell the owner.
- Usual workflow:
  1. Work in a git worktree with `frontend/node_modules`, `backend/.venv` and `backend/.models` symlinked in.
  2. Test against throwaway servers (API on 8011 with a scratch data folder, Vite on 5191 with `MOTION_API_TARGET`).
  3. `git add` only the files you mean, commit, and fast-forward `main`.
  4. Remove the worktree and build.
- Git: on the Mac, `origin` is GitLab (`https://gitlab.com/jagadeesch1981/kanaa.git`) and `github` is GitHub (`https://github.com/jagadeeschai/kanaa.git`, public). Only push when the owner says "push", and then push `main` to both. Cloud sessions work on GitHub through pull requests; see CLAUDE.md.

## The owner's standing rules

- **Ask before downloading anything**: models, fonts, music, sample media.
- **Their files are read-only.** Imported media is copied into Kanaa's store and never changed. The Music library (`~/Music/Music/Media.localized/Music`) is only read; a track is copied in when used. Their music is bought, so never commit or upload it.
- **Warn before restarts**, and don't change code under the app while they're using it without saying so.
- **Report honestly.** Look at real output frames, say what wasn't tested, and say when something fell short (for example, RNNoise was dropped because it made voices quieter).
- **Keep progress updates short.** The owner reads English and Tamil, and the UI shows both where it helps.

## What phase 1 delivered

Each has a section, and its limits, in `docs/VIDEO_EDITOR_PLAN.md`.

**Editing core:** full screen preview (button or F; Esc leaves), multi-clip timeline with overlays and up to 6 video layers, trimming, splitting, magnetic main track, undo, keyframes and motion paths, blend modes, split screen, picture-in-picture corners, corner handles in the preview to resize the selected clip, one-click Follow on a blur box or overlay (a blur on a face takes that face's path from the face finder; anything else falls back to the tracker), right-click menus, an adjustable layout with light and dark themes, autosave, a render queue, and 4K export.

**Clip effects:**
- Freeze frame, reverse, speed and speed ramps.
- Zoom moves (push in, pull out, punch in, shake).
- Transitions: crossfade, wipe, slide, zoom, flash, dip, whip.
- Colour looks.
- Steady shaky video (vid.stab).
- Chroma key.

**People and objects (Apple Vision):**
- Remove or blur the background.
- **Who stays**: each person or object is found, numbered and followed (`instance_service.py`), then chosen from a numbered picture.
- **Focus blur** at Subtle, Medium or Strong, and **focus pull** from one subject to another.
- **New background**: any picture or video, filling the frame.
- Titles behind people, behind objects (cars, buses, animals), behind a skyline or ground line, or behind a drawn shape.
- Masks are steadied over time (`Steadier`) so titles don't flicker.

**Privacy:** blur boxes (blur or pixelate) that follow movement (optical-flow tracking), and automatic blurring of every face (YuNet).

**Text:**
- Ten title templates with subtitles, plus saved styles.
- 18 English fonts (the Mac's own) and 7 bundled Tamil fonts (OFL), with per-script font runs.
- Titles that follow movement.
- Auto captions (Whisper) in a chosen number of words per caption, with highlight.

**Words and audio:**
- Edit the video by its transcript, and remove pauses and fillers.
- Clean voice (FFmpeg `afftdn`).
- Ducking, loudness normalisation, and optional stem separation (Demucs).
- **Your music library**: the Music app's folder, sorted into moods (`music_library_service.py`), in the Audio tab.

**Dressing a whole video:**
- **Themes**: Wedding, Festival, Travel, Birthday, Memories, Vlog and Classic (`timeline/themes.ts`). Each sets the look, transitions, photo movement, opening and ending titles, title styles and music of its mood.
- **Story templates** (Templates tab, `timeline/stories.ts`): seven stories of named moments in English and Tamil. Fill them and "Make my video".
- **Cinematic finish** (Project settings, Look tab): widescreen bars (2.39:1, landscape and square only), a teal and orange grade, glow, darker edges and film grain over the whole video, under the captions (`finish_service.py` and `FINISH_FRAGMENT`).

**Lyric videos:** a separate mode, with synced lyrics (letter-level), multi-image slideshows and 4K export. See the lyric backlog in the plan.

**Phone access:** off by default. Turned on in Studio (phone icon), devices on the Wi-Fi open `http://<Mac IP>:8010` and enter a 6-digit PIN (`phone_service.py`, gate in `app/main.py`). Loopback never needs it; only the Mac can see or change it; wrong PINs are rate-limited; New PIN signs every phone out. `main.cjs` listens on 0.0.0.0 only when it's on, so turning it on needs a restart.

**Project settings vs clip settings:** whole-film controls live in `ProjectInspector` (`Editor.tsx`), the right-hand panel when nothing is selected, also opened by the top-bar size button: Format (shape and size, frame rate 24/25/30/50/60), Look (theme, cinematic finish) and Sound (even out loudness). Clip panels hold only shot-specific controls (trim, speed, framing, stabilisation, a clip's own look, background, blend, clip audio, transitions, keyframes). Export defaults and safe-area guides may join Project settings later.

**Effects on and off:** `clip.bypass` lists a clip's effects that are switched off with their settings kept (look, colour, background, green_screen, steady, reverse, speed_effect, motion, enter_exit, transition, clean_voice). `frontend/src/timeline/effects.ts` (`clipEffects`, `applyBypass`, `playingTimeline`) and `timeline_service.py` (`apply_bypass`, `playing_timeline`, applied in `Builder.__init__`) strip them the same way, so preview and export agree. The clip panel shows "Active on this clip"; right-clicking a clip offers an Effects submenu of ticks (the menu stays open while they are flipped) and Remove effects (each, or all). ContextMenu supports `submenu` (an array, or a function built each time the menu draws) and `checked` / `keepOpen` items. A new effect must be added to both lists.

**Settings panels and the Guide:** every inspector is a `Panel` (`editor/layout.tsx`): a search box, icon tabs, and `Group`s that each name their `tab`, search `keywords`, a one-line `tip` and a `help` article id; rarer controls sit in `More`. Clip: Frame, Look, Backdrop, Motion, Sound. Title: Words, Style, Motion. Sound: Volume, Voice. Caption: Words, Style. Blur box: Hide, Motion. Timing shows on every tab. The ⓘ on a section opens the Guide (`editor/Guide.tsx`, articles in `editor/guide-articles.ts`, with the shortcuts), also on the ? button. Keep the articles true to how features work when you change them.

## Phase 2 work on `dev_cloud` (not yet merged or checked on the Mac)

Built in cloud sessions at the owner's request; details and limits are in the plan's "Phase 2 on dev_cloud" section.
- **Ease:** drag and drop from the side panel onto the timeline (`timeline/drop.ts`), a Lite / Pro switch (`SimpleContext` in `layout.tsx`; Lite shows only Media, Audio, Text, Templates and Themes plus the main settings — transitions come from the theme, captions are one click), and in the lyric editor song drops and lyric lines dropped on images.
- **Local ML reused:** cut to the beat (`timeline/beats.ts`), push in towards faces (`focus_service.py`), split at scene changes (`scene_service.py`), auto-reframe to follow the person (`reframe_service.py`, `timeline/reframe.ts`), best moments for stories (`moment_service.py`), captions clear of faces (`timeline/clear-faces.ts`, per-caption `position`).
- **Special effects:** eight effects drawn in code (`effect_service.py`), laid on a Screen-blend "Effects" layer (`drop.placeEffect`).
- **AI ready (Ask AI tab):** uses the existing AI settings (`ai_settings_service.py`: one OpenAI-compatible address and API key) with a new `text_model` beside the image model; `text_ai_service.py` calls it through the official `openai` Python library. A provider on this Mac (Ollama) needs no key. `edit_plan_service.py` turns a request into commands from a fixed catalogue, checked against the ids the editor sends; `timeline/commands.ts` checks them again and the person ticks and applies them (`runAsk` in `Editor.tsx`). Also caption translation (Tamil ⇄ English) and post words (title, description, hashtags). Only text is sent, never media. A native Claude connection (Anthropic SDK) is a possible follow-up if the owner chooses Claude.
- **Lyric video director:** “Let AI direct the scenes” (`lyric_director_service.py`, `/image-scenes/direct`): the text model reads the lyrics, splits the song by meaning and writes an English continuity bible and a scene each; `plan_scenes(…, direction)` saves it like a hand-built plan. Lyrics go only to the text model, never into image prompts.
- **Whooshes and hits** (`sound_effect_service.py`, `timeline/sfx.ts`): Kanaa's own (made in code) or the library's short effects by name, placed to peak on each transition or title. **Smooth music loops** (`timeline/loop.ts`): a short song repeats by whole bars on the beat to the picture's end.
- **Travel maps** (`travel_map_service.py`, `travel_map_render.py`, `editor/TravelMapPanel.tsx`): Natural Earth (India's view of borders) and GeoNames data downloaded once after asking (about 20 MB, `data/maps`); place search on this Mac; flights on the great circle, roads from the free OSRM server (no key, cached, curve fallback); an animated map clip drawn on this Mac.
- The face finder is never downloaded without asking: `/api/face-finder` says whether it is here, and features confirm first.

## Known limits worth remembering

- **Apple-only parts:** Vision masks, the Mac's English fonts, and the Mac app. On Windows the plan is to swap Vision for an ONNX model behind the same helper protocol (count byte plus masks on stdout), and bundle English fonts.
- **Tested mostly on synthetic and test clips.** Real phone footage (hair, hands, people crossing, HDR, variable frame rate) still needs the owner's feedback. People who cross can swap numbers.
- **Music:**
  - Moods are guessed from names and genre tags.
  - Music shorter than the video ends rather than looping, unless Loop to the end of the video is used (on `dev_cloud`).
  - The short sound effects in the library are skipped in the music list; on `dev_cloud`, whooshes and hits among them are used on transitions and titles.
- **Tests:** `Api.test_transcript_is_saved_and_kept_per_language` failed once in a full run and passed on rerun, probably a race with a background job. Investigate if it recurs.
- **Stories and themes:** photo movement from an earlier theme stays when switching themes. (On `dev_cloud`, stories pick each clip's best part.)

## Candidates for the next phase (after feedback)

1. Fixes from the owner's real editing.
2. Whooshes and hits from the library on transitions and title reveals.
3. Picking the best part of a clip (motion, faces, sharpness) for stories.
4. Smooth music loops, light leaks, more grades, and smooth slow motion (frame interpolation).
5. A cross-platform person finder (ONNX) and remote use from Windows.
