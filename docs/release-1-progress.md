# Release 1 progress

2026-11-15. Worktree `wideangle-motion-release-1`, branch `codex/release-1`. Do not push or restart the owner’s app.

- Preparation complete: `b302599` preserves lyric items when replacing old credit cards. Its full suite passed (461 backend tests plus frontend/model/UI checks); separately fast-forwarded into main. Main has no tracked changes. Untracked `.snowflake/` was left alone.
- B1 complete: Editor.tsx 2,823 → 1,195 lines. Each component/tool extraction passed model tests, UI tests and type checking before commit.
- B2 complete: inspectors consume shared store bindings with zero props. Coordinator history, save queue and outside-change handling were retained.
- Browser check in the throwaway app: clip edit, title edit, undo, redo, a short draft, autosave reopening, external update detection and Undo passed with no runtime errors. Draft job `530532745a7a43d699741e680c580013` was requested once and completed.
- F1–F5 and remaining readiness work: pending.
- Signing: no valid signing identity was visible; owner requested an unsigned candidate and will configure Developer ID/notarization later. No signing credentials requested or stored.

Feature render comparisons, final full-suite results, licence review, packaging results and two real-project export timings will be recorded as those steps are completed.
