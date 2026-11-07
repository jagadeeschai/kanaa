# Kanaa backlog

Working list of what's worth building next, beyond the shipped editor. Ordered by impact per effort; the owner picks from here. Items marked (P) need the preview/export parity work mirrored in `playback.ts` / `timeline_service.py` and should be checked with the golden check.

## Version planning

Think of releases as **Kanaa 1.x** lines, each a coherent promise rather than a feature dump. Suggested shape:

| Version | Theme | Candidate contents |
|---|---|---|
| **1.0 (now)** | "Edit and ship" | The current editor: timeline, themes, captions, music, watermark, cinematic presets, Lite/Pro, 4K export. Remaining 1.0 work: real-footage acceptance (owner-led), golden-check stability, docs push. |
| **1.1 — Polish & packaging** | "Professional finish, zero friction" | Save-frame thumbnail export, beat marks on the ruler, audio level meter + clipping warning, named snapshots, end card with subscribe prompt, copy-look (if missed), second copy-tightening pass + Tamil subtitles on key controls. |
| **1.2 — Speed of editing** | "Twice as fast to cut" | Multi-select + bulk ops, copy/paste between projects, zoom-to-fit/follow refinements, keyboard clip selection, ripple trims, JKL polish. |
| **1.3 — AI assists (local-first)** | "The editor anticipates" | Highlights from a long video, silence/filler auto-cut review, B-roll suggestions from the text model, stronger Ask AI catalogue (using 1.1–1.2 tools), Tamil-first caption translation quality pass. |
| **1.4 — Cross-platform groundwork** | "Beyond this Mac" | ONNX person finder behind the helper protocol, bundled English fonts, Windows packaging investigation. Only after 1.1–1.3 are stable. |
| **2.0 (later)** | "Collaborate and extend" | Only if asked: accounts/cloud projects, plugin surface, team review. Deliberately out of scope today. |

Rules for versioning: each 1.x ships only when `./test.sh` is green and the golden check passes; Lite mode must stay coherent (every new feature decides its Lite home or absence); Mac-only features get their parity story before Windows work starts. Version numbers are marketing labels — the real contract is the table above.

## Colour and looks

- ~~More colour controls~~ — shipped (gamma, temperature, tint, fade).
- ~~Copy a clip's look~~ — tried and removed: the owner found it cluttered; Look chips already cover it.

## Creator professionalism

- **Save this frame as a thumbnail** — button on the preview exports the current frame (optionally with the project title) to Media. Every YouTube video needs a cover.
- **Beat marks on the timeline ruler** — beats are computed (`getSongBeats`) for cut-to-beats but never shown; draw ticks on the ruler for music-synced transitions and titles.
- **Audio level meter + clipping warning** — slim peak meter on the preview (WebGL analyser, no backend); warn when export audio clips. Ducking/normalise exist but levels are invisible today.
- **Named snapshots in a project** — save/restore named timeline copies server-side (next to the recipe). Undo is session-only today; protects before risky restructures.
- **Branded end card** — one-click closing card: brand logo + channel name + subscribe prompt over a chosen background, theme-matched animation. Reuses the brand watermark layers.

## Editing speed

- Multi-select + bulk ops on the timeline — select several clips to move, delete or apply the same transition/look at once (`selectedId` is single today). Biggest remaining speed gap.
- Copy/paste between projects.
- Keyboard clip selection on the timeline.

## Polish

- Guide article for the brand watermark (the ⓘ links point to `brand-watermark`, which doesn't exist yet).
- Cinematic preset swatches and Tamil labels beside preset names.
- Remember last-used watermark corner/size per project.

## Done (keep for context)

- Cinematic presets (Teal & orange, Golden hour, Night city, B&W classic, Clean documentary) — project Look tab.
- Brand watermark, project level and clip level, drawn above the cinematic finish bars; layer renaming (double-click a layer name); Music 1/2… default audio layer names.
- More colour controls: Gamma, Temperature, Tint, Film fade — clip Colour panel, More options (mirrored shader/export math, render-tested).
- Music library search in the Audio tab, plus the tab reorganised (library first, own song second).
- Playhead-follow on the timeline and a music-coverage warning (stops-at / silent-tail) in Project settings → Sound. (Timeline Fit button already existed.)
- Left panel: icon rail (click to open, active-icon click folds, default open on Media), custom instant tooltips, unique icons per meaning.
- Right panel: same icon-rail treatment via the shared `Panel` (every inspector), change-dots, tooltips.
- Transitions tab (tiles + Every cut + Remove-all with confirmation); transitions consolidated there (out of Motion and Themes); per-transition icons.
- Copy pass #1: ~28 wordiest UI strings shortened.
- Lite / Pro: Lite renamed and made a real guided mode (5 menus, one-click captions, theme-driven transitions; Pro unchanged and default). Guide article + AGENTS.md updated.
