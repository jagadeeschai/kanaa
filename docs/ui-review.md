# Kanaa UI review: making the menus intuitive

Two reviews of the editor, the lyric screen and the studio (November 2026). The goal: every option sits where a
person would look for it, once, under one name. Status: ✅ done, 🚧 in progress, ⬜ to do.

## Titles and the preview

| # | Problem | Change | Status |
|---|---|---|---|
| T1 | A title's words were on one tab, its size and colour on another, its fonts hidden under More | One **Text** tab: words, Tamil and English font, size, colour, style, position, alignment, letter spacing together. Subtitle and Layout and look below it | ✅ |
| T2 | Title letter spacing only appeared with a subtitle | It sits with the title's other settings | ✅ |
| T3 | Timing was always open at the top, pushing everything down | Folded to one line: `0:04 → 0:09 · 5s` | ✅ |
| T4 | The layer switch used an eye (which means hide elsewhere) and changed its label | A checkbox, link icon, fixed label "Use layer style", shown only when the layer has a style | ✅ |
| T5 | No shortcuts for titles | Enter / F2 types into the selected title; Alt+arrows nudge it (Shift: further); Esc deselects | ✅ |
| T6 | "Title moves" / "Advanced motion" vs the clip's "Moves" | Moves and Keyframes everywhere | ✅ |
| T7 | A title can't be picked in the preview | Click a title in the preview to select it, with a box around it | ✅ |
| T8 | Can't type into a title in the preview | Double-click to type in place, safe for Tamil typing; Enter keeps, Esc cancels | ✅ |
| T9 | Size, colour, font only in the side panel | A small toolbar over the selected title: type, size, colour, Tamil font, style | ✅ |
| T10 | Title animation in three groups | ✅ Motion tab under three headings: In and out (simple, cinematic) · While on screen (moves, keyframes) · Follow the scene (stay with people, place in scene, move with the scene, keep clear) | ✅ |

## Clips

| # | Problem | Change | Status |
|---|---|---|---|
| C1 | The effects list squeezed the settings | Effects fold to one line | ✅ |
| C2 | Effects on three tabs (Mirror on Frame; Echo, Zoom blur, Beat pulse on Motion) | ✅ Clip tabs Frame · Colour · Effects · Backdrop · Motion · Sound; all eleven effects in Effects | ✅ |
| C3 | The per-clip brand mark sits under Backdrop | ✅ On the clip's Frame tab, with the other things placed on the picture (the project-wide mark stays in Project settings › Brand) | ✅ |

## Layers and timeline

| # | Problem | Change | Status |
|---|---|---|---|
| L1 | Up to nine icons on a 126px layer header | Keep hide, lock, mute; the rest in a ⋯ menu; click the layer name for its settings | ✅ |
| L2 | Fix sync crowds the layer panel | A "Fix lyric timing" action in the layer's ⋯ menu | ✅ |
| L3 | Snapshot uses the face icon; "Render preview" has two names; "More" is vague | Camera icon; one name, "Render smooth preview"; More becomes **View** | ✅ |

## Whole editor

| # | Problem | Change | Status |
|---|---|---|---|
| E1 | "Theme" is both the video's look and light/dark mode (both கருப்பொருள் in Tamil) | Light/dark becomes **Appearance**, in Settings | ✅ |
| E2 | Back, save state, undo, export spread over two rails; the project name shown nowhere | ✅ Name and save state above the preview; Back leads the left rail; Undo/Redo lead the timeline toolbar; Jobs · ? · ⚙ · Export on the right rail | ✅ |
| E3 | Colour and looks set in five places | ✅ Themes panel is whole-video only (one-clip looks live in the clip's Colour); Effects' "Colour" category is now Stylise; Cinematic finish and LUT together under Colour & finish | M | ✅ |
| E4 | Effects tab holds four unrelated tools | ✅ Travel map moved to Media; blur/pixelate/faces is the Privacy section; Effects holds clip effects, overlays and Privacy | M | ✅ |
| E5 | Caption language lives in Words, which Lite hides | ✅ Captions have their own language choice (in Text, so Lite has it); a merged Captions & words tab was dropped because it would hide captions from Lite | S | ✅ |
| E6 | The Transitions tab changes with the selection | ✅ The tab holds the gallery, Every cut and Remove all; one cut's length and direction are set on the cut itself | ✅ |
| E7 | "Templates" holds only stories | Rename to **Stories**; put Brand intro there as an opening | ✅ |
| E8 | Project settings mix format, look, brand and sound; loudness also in Export | ✅ Tabs Format · Colour & finish · Brand · Sound; Export's loudness switch says it is the same setting as Project settings › Sound | M | ✅ |
| E9 | The guide is reachable five ways but has no visible button | A **?** in the header; fewer duplicate entries | ✅ |
| E10 | Lite hides things silently | "More in Pro" hint | ✅ |
| E11 | Much text not translated; the lyric screen is English only; language only in the editor | ✅ Every visible label on the home screen, lyric screen (all five steps) and editor panels is in Tamil when chosen (checked by collecting what stayed English); labels of typing boxes are translated, never their contents; numbered labels by pattern; a த / EN switch on the home screen. Still to do: retire the page translator for t() (B5) | ✅ |
| E12 | Empty Templates, Themes and Ask panels | "Add a clip first" | ⬜ |

## Lyric video screen

| # | Problem | Change | Status |
|---|---|---|---|
| Y1 | Background options split across Scenes, Style and Timing; "Export" step doesn't export | ✅ Steps: Song & words · Backgrounds · Timing · Lyric style · Open in editor; image animation, 3D, how images change and crossfade together under Backgrounds › How the pictures move; Timing is only line sync | ✅ |
| Y2 | Its own styling and spelling ("Text color") | 🚧 Spelling matches the editor (colour) and the step names and main labels are in Tamil; its controls still look different from the editor's | 🚧 |
| Y3 | Lyric style presets don't match the editor's names | Superseded: Build video sets the look by Mood and House style, so the presets no longer carry into the editor | — |

## Home

| # | Problem | Change | Status |
|---|---|---|---|
| H1 | Studio and Projects are nearly the same page | One Home: create cards above all projects | ⬜ |
| H2 | Folder actions only on the home screen | Also in the editor's media right-click menu | ⬜ |
| H3 | One chip per folder fills the media panel as songs grow | One folder picker with counts; this video's own folder first (★) | ✅ |

## Architect review (third pass)

### Experience

| # | Problem | Change | Effort | Status |
|---|---|---|---|---|
| A1 | Only one item can be selected; fixing 40 lyric lines is 40 edits | ✅ Shift-click range, ⌘-click, ⌘A, a box over empty track; changes apply to all picked; Delete removes all; the picked note lists the Mixed settings ("the panel shows the first; a change makes them all the same") | L | ✅ |
| A2 | Snapping and zoom give no visible cue | ✅ A dashed line where a dragged edge snaps; magnet button and N toggle snapping; a zoom slider between − and + | M | ✅ |
| A3 | Six long jobs, six progress styles, most can't be cancelled | ✅ One Jobs tray: progress, Cancel, plain failure words, a note when one finishes, and Try again for a failed or cancelled job (same job, while Kanaa runs) | M | ✅ |
| A4 | Errors show the server's raw English text | Plain sentences that say what to do, with Retry and Details | S | ✅ |
| A5 | Hints are written into code and not translated | A hints table through `t()`, shown under the control they explain | S | ⬜ |
| A6 | Powerful features are buried (cinema reveal, keep clear, brand intro) | ⌘K command palette searching every action, English and Tamil; a "✦ Smart" row per inspector | M | ✅ |
| A7 | Some focus rings removed; timeline not reachable by keyboard | Focus and contrast pass; arrow keys move between timeline items | M | ⬜ |
| A8 | Tamil interface font only in bold; Tamil labels cut off | Load Noto Sans Tamil 400/500; Tamil-aware sizes; labels never truncated | S | ✅ |
| A9 | A new project opens to an empty editor | ✅ First steps card in the preview corner (clips → title → export), ticks itself, links to the guide, can be closed | S | ✅ |
| A10 | Loading looks frozen in big projects | Shimmer placeholders; "Preparing preview…" on the stage | S | ⬜ |
| A11 | Keys mean different things in different places | One keymap with scopes, feeding the shortcuts sheet and ⌘K | M | ⬜ |

### Code health (what makes UI work slow or risky)

| # | Problem | Change | Effort | Status |
|---|---|---|---|---|
| B1 | Editor.tsx: 3,370 lines, 109 pieces of state | 🚧 Editor.tsx at 2,812 lines (new features land in their own files: editor/useClipboard.ts, timeline/clipboard.ts, timeline/karaoke.ts; backend kanaa_mcp/scene_motion.py, lyric_touches.py). Own files: preview/TitleEditing, ErrorBanner, Timing, inspectors/TextInspector + parts, ClipInspector + clip-parts, ProjectInspector + project-parts (brand intro, frame rates). Next: a shared store (B2) so panels stop taking 30+ inputs | L (many S) | 🚧 |
| B2 | Inspectors take 30+ props each | 🚧 state/EditorContext shares the timeline, change, pause, the guide, the playhead and seeking, and the selection; panels work out their own place in time with useItemTime(). Next: jobs into the context, then each panel's own actions | M | 🚧 |
| B3 | The same controls rebuilt (13 raw colour inputs, local Chips) | One `ui/` set: Slider, ColorField, Segmented, Select, Toggle, Section, Callout, ProgressRing | M | ⬜ |
| B4 | Two styling systems (Tailwind lyric/studio, hand CSS editor) | One `tokens.css`; Tailwind mapped to it; lyric screen moved last | M | ⬜ |
| B5 | The DOM translator can fight React and translate user text | `t()` everywhere, a missing-translation check, then remove the translator | M | ⬜ |
| B6 | No UI tests | 🚧 `npm run test:ui`: 41 tests (panels, ⌘K, Jobs, Fix sync, preview title editing, the editor context) in English and Tamil | M | 🚧 |

### Roadmap

- **Next 2 weeks:** B6 smoke tests; B1 first moves (helpers, leaf components, dialogs, preview overlays); A8 Tamil fonts; A4 plain errors; A9 first-run checklist; A7 focus fixes.
- **Next month:** B2 store; A3 job tray; B3/B4 shared controls and tokens; A1 multi-select; A2 snap and zoom cues; A6 command palette; B5 translation cleanup.

## Code review of the multi-select, Jobs and ⌘K work (validated)

| Finding | Verdict | Status |
|---|---|---|
| Multi-delete skipped captions | Real: a Shift-click range on the Captions layer left them behind | ✅ fixed |
| Ctrl-click to add on Windows/Linux | Not applicable: Kanaa is a Mac app, and the timeline treats Control-click as right-click (it opens the menu) | — |
| ⌘K highlight jumps when arrow keys scroll the list under the pointer; −1 index on an empty list | Real | ✅ fixed: only real pointer movement moves the highlight |
| ⌘K labels translated twice; names in labels left to the page translator | Real (harmless, but untidy) | ✅ fixed: labels translated once with `{name}`; English kept for search |
| A failed job with no message showed nothing | Real | ✅ fixed: "Could not finish" |
| "Find in settings" fills the settings search through the page after a delay | Real | ⬜ give the settings panel a shared search value instead |

## Menu-architecture review (validated against the code)

| Proposal | Verdict | Action |
|---|---|---|
| Top header with project name, save state, Jobs, ⌘K, ?, ⚙, Export | Valid in part. The project name is shown nowhere and save state only in Back's tooltip. But the owner asked for Back at the top of the left rail, so it stays there. | ✅ Project name and save state above the preview; Back stays on the rail |
| Left rail in groups with dividers (Media·Audio │ Text·Captions │ Effects·Transitions·Stories │ Ask AI) | Valid: nine flat icons today | ✅ Dividers: Media·Audio │ Text·Words │ Transitions·Effects·Stories·Themes │ Ask AI; a Pro hint in Lite (E10) |
| Rename Words to Captions | Partly: captions are made in Text today; Words is the transcript and pause tidy-up | ⬜ "Captions & words" as one tab (with E5) |
| Travel map to Media; blur/pixelate as Privacy | Valid (already E4) | ✅ |
| Themes + Stories as one "Styles" tab | Valid (already E7's second option) | ⬜ owner to choose |
| Lite hint "Switch to Pro for…" | Valid (already E10) | ✅ |
| One Effects tab for clips, applied effects on top | Valid (already C2) | ✅ |
| Clip "Colour" tab holding the 3D LUT | Wrong: the LUT is a whole-video grade in Project settings › Colour & finish (by design, E3) | — |
| Brand watermark per clip next to the project's | Valid (already C3) | ⬜ |
| Title: Typography / Motion / Look tabs | Rejected: splitting look from the words again is what the owner asked to undo (T1); the Motion grouping is T10 | ⬜ T10 only |
| Timeline right-click is a flat 15+ list | Overstated: it already has dividers and an Effects submenu. Fair that the AI tools could sit in a submenu. "Fix lyric sync" doesn't belong on a clip; "F" is full screen, not freeze | ✅ "Smart tools ▸" submenu (Follow the person, Split at scene changes) |
| Media panel: Move to folder | Already there (right-click a media item › Move to folder…) | — |
| Media panel: New folder button | Already there: Move to folder… › Create a new folder. The editor's folder picker is now searchable instead | ✅ |
| ⌘K: section headings, suggestions when empty | Partly: an empty box already lists everything | ✅ Group headings; the last five actions first, under Recent |
| Export ▾ quick choices (1080p, 4K) | Nice to have; the Export window already chooses quality | — |

## Later (owner's list)

| What | Notes | Status |
|---|---|---|
| Create the lyric video for கற்கண்டு with Build video | Lyric project "கற்கண்டு"; song and LRC in Downloads (`கற்கண்டு.wav`, `கற்கண்டு by kavintamiloriginals.lrc`). Use the lyric screen's Build video step (house style, brand intro with the gold leaf logo, credits). The screen already removes Suno's notes like "(Backing harmony)"; the agent's reader still needs the same rule once the other session commits its lyrics.py fix | ⬜ |
