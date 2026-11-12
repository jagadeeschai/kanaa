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
| T10 | Title animation in three groups | Motion tab: In and out · While on screen · Follow the scene | ⬜ |

## Clips

| # | Problem | Change | Status |
|---|---|---|---|
| C1 | The effects list squeezed the settings | Effects fold to one line | ✅ |
| C2 | Effects on three tabs (Mirror on Frame; Echo, Zoom blur, Beat pulse on Motion) | One Effects tab, applied effects on top | ⬜ |
| C3 | The per-clip brand mark sits under Backdrop | Move it next to the brand watermark | ⬜ |

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
| E2 | Back, save state, undo, export spread over two rails; the project name shown nowhere | One header: Back · name · Saved · Undo · Redo · ? · ⚙ · Export | ⬜ |
| E3 | Colour and looks set in five places | Clip looks in the clip's Colour; Themes for the whole video only; one Project "Colour & finish" | ⬜ |
| E4 | Effects tab holds four unrelated tools | Effects + overlays; Travel map to Media; blur/pixelate as **Privacy** | ⬜ |
| E5 | Caption language lives in Words, which Lite hides | A language choice inside Captions | ✅ |
| E6 | The Transitions tab changes with the selection | Tab: gallery, Every cut, Remove all; per-clip length in the clip | ⬜ |
| E7 | "Templates" holds only stories | Rename to **Stories**; put Brand intro there as an opening | ✅ |
| E8 | Project settings mix format, look, brand and sound; loudness also in Export | Tabs Format · Colour & finish · Brand · Sound; loudness set once | ⬜ |
| E9 | The guide is reachable five ways but has no visible button | A **?** in the header; fewer duplicate entries | ✅ |
| E10 | Lite hides things silently | "More in Pro" hint | ⬜ |
| E11 | Much text not translated; the lyric screen is English only; language only in the editor | `t()` on toolbar, panels and lyric steps; language on the home screen too | ⬜ |
| E12 | Empty Templates, Themes and Ask panels | "Add a clip first" | ⬜ |

## Lyric video screen

| # | Problem | Change | Status |
|---|---|---|---|
| Y1 | Background options split across Scenes, Style and Timing; "Export" step doesn't export | Steps: Song & words · Backgrounds · Timing · Lyric style · Open in editor | ⬜ |
| Y2 | Its own styling and spelling ("Text color") | The editor's controls and words | ⬜ |
| Y3 | Lyric style presets don't match the editor's names | Same names after handoff | ⬜ |

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
| A1 | Only one item can be selected; fixing 40 lyric lines is 40 edits | ✅ Shift-click picks a range on a layer, ⌘-click adds or removes, ⌘A picks the whole layer; a change applies to all picked (not words or timing); Delete removes all. Still to do: drag a box, "Mixed" values | L | 🚧 |
| A2 | Snapping and zoom give no visible cue | A snap line with its reason (Beat, Playhead, Clip edge); N toggles snapping; zoom slider and Fit (⇧Z) | M | ⬜ |
| A3 | Six long jobs, six progress styles, most can't be cancelled | One job tray: progress, Cancel, Retry; export, AI and brand intro included; a toast when done | M | ⬜ |
| A4 | Errors show the server's raw English text | Plain sentences that say what to do, with Retry and Details | S | ✅ |
| A5 | Hints are written into code and not translated | A hints table through `t()`, shown under the control they explain | S | ⬜ |
| A6 | Powerful features are buried (cinema reveal, keep clear, brand intro) | ⌘K command palette searching every action, English and Tamil; a "✦ Smart" row per inspector | M | ⬜ |
| A7 | Some focus rings removed; timeline not reachable by keyboard | Focus and contrast pass; arrow keys move between timeline items | M | ⬜ |
| A8 | Tamil interface font only in bold; Tamil labels cut off | Load Noto Sans Tamil 400/500; Tamil-aware sizes; labels never truncated | S | ✅ |
| A9 | A new project opens to an empty editor | A three-step first-run checklist (media → title → export) linked to the guide | S | ⬜ |
| A10 | Loading looks frozen in big projects | Shimmer placeholders; "Preparing preview…" on the stage | S | ⬜ |
| A11 | Keys mean different things in different places | One keymap with scopes, feeding the shortcuts sheet and ⌘K | M | ⬜ |

### Code health (what makes UI work slow or risky)

| # | Problem | Change | Effort | Status |
|---|---|---|---|---|
| B1 | Editor.tsx: 3,370 lines, 109 pieces of state | Split into `state/`, `inspectors/`, `preview/`, `dialogs/`, `keyboard/`, one small move at a time | L (many S) | ⬜ |
| B2 | Inspectors take 30+ props each | A small store; inspectors read what they need by id | M | ⬜ |
| B3 | The same controls rebuilt (13 raw colour inputs, local Chips) | One `ui/` set: Slider, ColorField, Segmented, Select, Toggle, Section, Callout, ProgressRing | M | ⬜ |
| B4 | Two styling systems (Tailwind lyric/studio, hand CSS editor) | One `tokens.css`; Tailwind mapped to it; lyric screen moved last | M | ⬜ |
| B5 | The DOM translator can fight React and translate user text | `t()` everywhere, a missing-translation check, then remove the translator | M | ⬜ |
| B6 | No UI tests | Smoke flows (import, title, edit in preview, undo, export) and English/Tamil screenshots | M | ⬜ |

### Roadmap

- **Next 2 weeks:** B6 smoke tests; B1 first moves (helpers, leaf components, dialogs, preview overlays); A8 Tamil fonts; A4 plain errors; A9 first-run checklist; A7 focus fixes.
- **Next month:** B2 store; A3 job tray; B3/B4 shared controls and tokens; A1 multi-select; A2 snap and zoom cues; A6 command palette; B5 translation cleanup.
