# Kanaa — product, frontend and editing-suite review

Reviewed: 4 November 2026. Perspective: a media IT company with frontend specialists and a film editing suite.

## Assessment

Kanaa has a coherent visual foundation and a useful identity: approachable, Tamil-first video and lyric creation on a Mac. The neutral preview stage, restrained purple accents, separate media and project libraries, searchable inspectors, and contextual Guide are worth keeping. The next investment should make finding media, finishing a video, and understanding processing states more dependable. More effects alone will not improve those workflows.

This is a broad interface and source review, not certification of playback, export quality, accessibility, or production reliability. The product is designed for one person; team collaboration should not become an immediate requirement.

## Evidence and limits

- Inspected the running built interface at `http://127.0.0.1:8010/` in an isolated headless Chrome profile. This renders the app's web interface; it is not a capture of its Electron window.
- Visually inspected Studio in light and dark themes, Projects, Media, Exports, video/lyric creation dialogs, the video editor, clip Frame/Look/Backdrop/Motion/Sound panels, existing title Words/Style/Motion panels, Templates/Themes/Text/Audio/Words tabs, Guide, export dialog, phone settings, AI settings, lyric editor and AI scene planner.
- Studio was also captured at 900 × 650. A complete minimum-size editor and phone layout audit remains outstanding.
- Existing video project was opened for selection and panel navigation only. Non-GET/HEAD HTTP requests were intercepted and blocked while inspecting. No edits, imports, renders, transcription, model downloads, or paid generation were intentionally submitted to the server.
- Lyric editor used a synthetic project response held only in the inspection browser, with an existing image. No lyric project was created in the database. Song upload, synchronization, timing correction, and lyric export were not exercised.
- The black video preview and “Failed to fetch” banner occurred with processing requests blocked and GPU disabled. The synthetic lyric project also displayed save/scene-load errors. These observations do **not** establish defects in normal playback, saving, or scene loading.
- Screenshot evidence remains in `/private/tmp/kanaa-*.png`, outside the repository. Screens include personal media; the phone settings capture contains access information. Do not commit or publish those captures. This report includes no keys or PINs.
- Source references below identify implementation areas. Runtime was the existing built bundle; source/build equivalence was not verified.
- Earlier Slate MCP read: project 11, 68 tasks: 52 Review, 1 Done, 15 To Do. Four completed implementation sprints; owner acceptance and real-footage feedback are still outstanding. Tracker completion was 0%, so it should not be treated as implementation progress.

## Priority guide

- **P1:** address before relying on Kanaa for repeat client deliveries.
- **P2:** improve everyday clarity and editing speed.
- **P3:** optional polish or later workflow expansion.
- **Observed:** visible in the running interface. **Source:** inferred from implementation. **Validation:** a quality gate still to be performed.

## P1 — delivery confidence and library usability

### 1. Put finished videos ahead of processing history

**Observed:** Exports begins with a long list of completed preview, preparation, mask and blur jobs. The finished `test.mp4` card is below that history. A user looking for the deliverable must scroll past internal work.

**Improve:** place completed video cards first; show active work in a compact queue; collapse completed background processing under Activity. Include project name, completion time, dimensions, duration, and file size on deliverables where available. Retain meaningful failed-job details.

**Accept when:** the newest finished video is visible in the first viewport even after 50 background jobs. Search clearly indicates whether it searches files, projects or activities.

**Where:** `frontend/src/App.tsx`, `frontend/src/studio.css`.

**Feedback (Claude, 4 Nov 2026):** Agree, P1. Confirmed in code: on the Exports page the job list renders above the finished-video grid, and completed internal jobs (masks, previews, blurs) are never folded away. Small change (S): finished videos first, active jobs as a compact strip, completed background work under a collapsed Activity. Not yet in Slate.

### 2. Make media browsing complete beyond the first 100 files

**Source (corrected after feedback):** App refresh requests imports and workspace media with `limit: 100`. Media already has a “Load more media” button and a total count. Displayed search and folders still filter only loaded arrays, and Exports has no equivalent Load more. This can hide later results. The current small library does not reproduce the large-library failure. Treat the remaining work as P2 for the current library, rather than rebuilding existing media pagination.

**Improve:** use server-backed search, folder filters and pagination or Load more. Preserve selection and scroll position during refresh. Show loaded/total counts.

**Accept when:** a known item beyond the first 100 imports and exports is discoverable by search and folder navigation. Returning from a preview preserves the user's place.

**Where:** `frontend/src/App.tsx`, `frontend/src/api/client.ts`.

**Feedback (Claude, 4 Nov 2026):** Partly addressed already. Media does page: it loads 100 at a time, shows a "Load more media" button and knows the total. The gaps are real: search and folders filter only what is loaded, and Exports has no Load more. With the current small library this is not urgent, so I would treat it as P2 until the library passes ~100 items. Effort M (server-side search and folder filters).

### 3. Make similar media distinguishable

**Observed:** three cards have the same `C0086.MP4` name, thumbnail and rounded duration. The new-project picker repeats those indistinguishable choices. This does not prove the files are duplicates.

**Improve:** add an accessible details view with import time, resolution, exact duration and size; expose full names on focus/hover. Flag exact duplicate content only after a content-based check. Offer a choice to reuse an existing import; never silently remove files.

**Accept when:** users can distinguish same-named clips without opening each one. Any duplicate suggestion explains its evidence and preserves the original media.

**Where:** `frontend/src/App.tsx`, `frontend/src/components/NewProjectDialog.tsx`, media metadata API.

**Feedback (Claude, 4 Nov 2026):** Agree, but P2 rather than P1: it slows choosing, it does not risk a delivery. The backend already identifies files by content (`content_key`), so flagging exact duplicates at import is cheap, and should only ever be a suggestion. Effort S to M.

### 4. Establish real-footage acceptance before declaring studio readiness

**Validation:** the repository and Slate explicitly leave real-world footage and people effects for owner feedback. This inspection did not play or export a full production.

**Improve:** complete a Tamil lyric video, a speech-led vertical reel and an event montage using disposable project copies. Check iPhone HDR/HEVC/VFR and rotation; speech sync by ear; mixed Tamil/English shaping; hair, hands and crossing subjects; long music coverage; prepared-effect completion; and preview/export agreement. Include one longer project and a multilayer project.

**Accept when:** each case has recorded source characteristics, settings, output inspection, problems and acceptance. Do not infer export quality from thumbnail or screenshot quality.

**Where:** existing `tools/golden_frames.py`, `tools/golden_check.js`, output-oriented tests; Slate tasks 223 and 224.

**Feedback (Claude, 4 Nov 2026):** Strongly agree: this is the biggest real risk, and it can only be done with the owner's footage and ears. It maps to Slate owner tasks 223 and 224. An agent can prepare the checklist and the disposable project copies; the golden check covers preview and export agreement, but not sync by ear or how masks hold up on hair and crossing people.

### 5. Finish music deliberately

**Source / Slate:** short songs ending before the video and musical ending improvements are documented pending work. Slate task 227 already specifies smooth loops and endings.

**Improve:** make looping and fade-to-end available in a simple “Fit music to video” control, with editable results. Show music coverage against the full timeline and a warning when a template leaves an unintentional silent tail.

**Accept when:** a 40-second song covers a 90-second edit without unintended gaps; a long song ends cleanly with a short edit; preview and export agree. Check audible joins as well as measured levels.

**Where:** `frontend/src/timeline/themes.ts`, Audio paths in `frontend/src/editor/Editor.tsx`; reuse task 227.

**Feedback (Claude, 4 Nov 2026):** Agree; this is Slate task 227 (agent-ready, High). Worth adding the review's two extras to 227's acceptance: a music-coverage bar against the timeline, and a warning when a template leaves a silent tail. Effort S to M.

## P2 — editing speed, comprehension and consistency

### 6. Put theme selection before detailed cinematic controls

**Observed:** the Themes panel's first viewport is occupied by the cinematic finish description and sliders. The actual Wedding/Travel/etc. choices are further down.

**Improve:** lead with theme cards and current theme; make Finish a separate collapsible section with a simple strength preset and optional detailed controls. Keep the existing independent adjustments.

**Accept when:** users can see and choose a theme without scrolling at the default layout. Theme replacement/removal clearly explains what it changes, including retained photo movement.

**Where:** Themes content in `frontend/src/editor/Editor.tsx`, `frontend/src/timeline/themes.ts`.

**Feedback (Claude, 4 Nov 2026):** Agree, and it is my own ordering choice to fix: Cinematic finish was placed first. Move theme cards to the top and make the finish a collapsible section. Effort XS; a quick win.

### 7. Give the music library a search and useful identities

**Observed:** Audio loads 159 tracks into a narrow list. Many names are generic “Track” or numbered variants; long names truncate. Mood filters help but do not identify a particular song.

**Improve:** add track search, duration filtering, full-name tooltips, and artist/album or source metadata when available. Make preview/play and Add visually distinct, with a clear playing state. Favorites are a later option.

**Accept when:** a track can be found by its available name or metadata without scrolling through the entire list. Similar “Track 10” entries can be distinguished. Missing metadata has an honest fallback.

**Where:** Audio panel in `frontend/src/editor/Editor.tsx`, `backend/app/services/music_library_service.py`.

**Feedback (Claude, 4 Nov 2026):** Agree. Search over name, genre and artist is cheap because all 159 tracks are already loaded in the browser. Honest fallback: the SavagePro pack has only genre tags, so "Track 12 · Classical · 3:33" is the best identity available; show the file name on hover. Effort S.

### 8. Make project setup support the intended first edit

**Observed / source:** New video asks for one video clip. Photos are omitted and selection is single-item, although the editor supports multi-clip and photo-based workflows.

**Improve:** either offer an ordered multi-select starter list with photos and videos, or explicitly say “Choose your first clip; add more inside.” Offer a clear route to photo stories rather than implying photos cannot be used.

**Accept when:** an owner can begin a mixed photo/video montage without guessing which mode to choose. Selected item count and ordering are visible.

**Where:** `frontend/src/components/NewProjectDialog.tsx`, project creation API and timeline initialization if multi-select is implemented.

**Feedback (Claude, 4 Nov 2026):** Agree, confirmed in code: a new video project accepts only videos and one selection. The editor already handles many clips and photos, so ordered multi-select with photos is mostly dialog work. Also point to Templates for photo stories. Effort S to M.

### 9. Separate lyric workflow stages

**Observed:** the lyric editor uses a long scrolling settings column: background, upload, lyrics, AI scenes, sync, format/style and timings. Its form controls and naming differ noticeably from the video editor's tabbed inspectors.

**Improve:** group into Background, Song & words, Timing, Style and Export with a visible current stage. Preserve a stable preview. Explain why an action is disabled, such as “Add a song to sync.” Reuse the app's spacing, buttons, labels and save-status patterns.

**Accept when:** a user can see what is missing, correct one lyric line, and return to styling without losing context. Verify both themes and shorter desktop windows.

**Where:** `frontend/src/components/LyricalVideoCreator.tsx`, shared editor/layout and theme styles.

**Feedback (Claude, 4 Nov 2026):** Agree. The lyric editor predates the friendlier panels; it can reuse `Panel`, `Group`, tips and the Guide from `frontend/src/editor/layout.tsx` rather than inventing new patterns. Effort M. Keep P2, since lyric videos are a core use for the owner's Tamil songs.

### 10. Improve portrait image framing in lyric videos

**Observed / source:** the sample landscape image is heavily cropped in portrait mode; the lyric preview uses `object-cover`, and the UI says backgrounds fill the frame.

**Improve:** add Fit / Fill with a movable focal point and optional blurred backdrop. Reuse framing concepts from the video editor, implementing equivalent export behavior.

**Accept when:** the user can preserve the full image or intentionally position a crop, and exported frames match the selected framing.

**Where:** lyric preview and recipe in `frontend/src/components/LyricalVideoCreator.tsx`, lyric export service.

**Feedback (Claude, 4 Nov 2026):** Agree; confirmed the lyric preview uses `object-cover` (fill only). Fit, Fill and a focal point should copy the video editor's framing, but the lyric export is a separate pipeline, so its output must be checked frame by frame. Effort M.

### 11. Show the exact export specification

**Observed:** export offers 720p/1080p/4K and approximate size, while the project format is chosen elsewhere. The inspected project is square, so generic resolution labels alone leave room for confusion.

**Improve:** show exact output width × height, frame rate, aspect ratio, audio state and container alongside simple quality choices. Distinguish output quality from preview resolution. Keep advanced encoding settings optional.

**Accept when:** portrait, square and landscape exports show their actual dimensions before submission; labels agree with the rendered file. Size remains explicitly an estimate.

**Where:** ExportDialog in `frontend/src/editor/Editor.tsx`, lyric export controls and format helpers.

**Feedback (Claude, 4 Nov 2026):** Agree, and cheap: the dialog already computes the output format, so showing "1080 × 1920 · 30 fps · 9:16 · with sound · MP4" is a small change. Effort XS to S; a quick win.

### 12. Use actionable processing and recovery messages

**Observed:** the blocked-processing inspection produced the generic “Failed to fetch” banner. Its occurrence here is induced, but the message itself gives no action or affected operation.

**Improve:** name the failed operation and offer Retry, continue with original media where supported, or open useful details. Distinguish source loading, proxy preparation, model work and export failures. Show “Preparing preview” rather than an unexplained empty stage when preparation is pending.

**Accept when:** deliberately failing a proxy request on a scratch server explains what happened and whether the project remains usable. A failed preparation must not masquerade as a failed project save.

**Where:** error handling in `frontend/src/editor/Editor.tsx`, playback and API client.

**Feedback (Claude, 4 Nov 2026):** Agree. Today most failures surface as the raw error text in one banner. Map the common cases (proxy, prepared copy, model, export, save) to a named operation with Retry or "continue with the original". Effort M.

### 13. Keep keyboard navigation inside the active workspace

**Source / inspection DOM:** Studio remains mounted underneath the video editor; its controls remain in the DOM. The editor uses `role="application"`. Shared dialogs have a focus trap, but the video workspace itself does not visibly mark the underlying Studio inert. Canvas timeline has an aria-label but no keyboard-focusable clip representation in its JSX. Full keyboard behavior was not tested.

**Improve:** make covered Studio content inert or unmount it; provide deliberate workspace focus. Add keyboard clip selection and an accessible item list with timing controls. Audit tablists for arrow-key navigation and roving tabindex, rather than relying only on tab roles. Preserve existing shortcuts.

**Accept when:** keyboard users cannot tab to obscured Studio actions, can select a clip/title and inspect its timing, and can return focus after closing dialogs. Verify with VoiceOver; do not claim accessibility from ARIA labels alone.

**Where:** `frontend/src/App.tsx`, `frontend/src/editor/Editor.tsx`, `frontend/src/editor/TimelineView.tsx`, `frontend/src/editor/layout.tsx`.

**Feedback (Claude, 4 Nov 2026):** Agree it is real: App renders the editor over Studio, which stays mounted underneath. Split it: marking Studio inert while the editor is open is XS; an accessible, keyboard-selectable clip list for the canvas timeline is L. For a one-person Mac app the second is P3 unless the owner needs keyboard-only use.

### 14. Make inspector and timeline labels easier to scan

**Observed:** several media filenames are truncated into small thumbnail overlays. Secondary copy, track controls and timing labels are compact; the Tamil brand label is much smaller than the English name. These are readability observations, not measured contrast violations.

**Improve:** expose full media details on focus/hover, offer comfortable UI density, and enlarge important track/icon hit areas. Give the Tamil identity more readable size. Identify selected item type/name in the inspector. Retain the neutral dark stage in both themes.

**Accept when:** a default-size laptop user can distinguish clip names, selected track and mute/lock state without enlarging a screenshot. Measure rendered contrast and focus visibility in both themes.

**Where:** `frontend/src/studio.css`, editor shell CSS, `TimelineView.tsx`, inspector layout.

**Feedback (Claude, 4 Nov 2026):** Partly agree. Worth doing soon: show the selected item's type and name at the top of the settings panel, and enlarge the Tamil brand label. A density setting and larger hit areas are P3. Effort S for the first two.

### 15. Expose media organization beyond right-click

**Source / observed navigation:** moving media into folders relies on the context menu; no visible per-card organization action appears in the inspected Media grid. Project cards already have an explicit more-actions button.

**Improve:** apply that more-actions pattern to media cards; offer a clearly labeled folder action. Consider bulk selection only when real library use warrants it.

**Accept when:** a mouse or keyboard user can discover Move to folder without knowing a context-menu gesture. Existing folders remain visible and searchable.

**Where:** media grid and `mediaMenu` in `frontend/src/App.tsx`, `frontend/src/components/MediaDialogs.tsx`.

**Feedback (Claude, 4 Nov 2026):** Agree; reuse the project card's ⋯ button on media cards. Effort XS; a quick win.

### 16. Separate saved state from job and connection state

**Observed:** the video editor can show “Saved” alongside a processing error. The synthetic lyric project showed a save failure in small footer text. Neither observation proves data loss.

**Improve:** explicitly label Project saved / Saving / Save failed independently of media preparation and exports. Make failed saving prominent and recoverable; consider a local recipe recovery copy rather than immediately adding collaboration infrastructure.

**Accept when:** an intentionally rejected save in a scratch environment gives a persistent retry/recovery path and never reports the failed changes as saved. Closing and reopening the app preserves the last confirmed recipe.

**Where:** `frontend/src/hooks/useVideoProject.ts`, editor save state and lyric footer.

**Feedback (Claude, 4 Nov 2026):** Partly in place: the video editor already tracks Saved, Saving and Save failed separately from jobs, and shows it under the project name. The confusing part is a processing error banner beside "Saved". Make save failure prominent with Retry and keep job errors visibly separate; bring the lyric editor in line. Effort S.

### 17. Surface storage before it interrupts editing

**Slate / source:** a task recorded low disk space earlier on review day; that historical note is not a current measurement. Imports, prepared copies and exports consume separate storage. Existing export disk checks should be retained.

**Improve:** add a lightweight storage overview with original, prepared and export sizes. Explain what may be regenerated. Cleanup must be explicit and preserve project-linked originals and wanted exports.

**Accept when:** users can see current available space and the scope of any cleanup before approving it. No original is removed automatically.

**Where:** Studio/settings, media store and prepared-copy services; Slate task 233.

**Feedback (Claude, 4 Nov 2026):** Agree, and practical for this owner: the Mac was 96% full on 4 Nov. Prepared copies (masks, portraits, steadied and reversed copies) can be regenerated, so a storage view with "Clear prepared copies" is safe; originals and wanted exports must never be touched without asking. I would raise this to P1 for this owner. Effort M.

### 18. Align documentation and tracker with current behavior

**Source / Slate:** README still describes single-source video editing and puts multi-clip editing on the roadmap, while the current editor and agent notes describe implemented multi-clip timelines. Plan notes also contain differing font descriptions. Phase completion and task acceptance are distinct in Slate.

**Improve:** update user-facing workflow documentation, consolidate current font limitations, and review finished tasks against results. Keep “implemented,” “accepted,” and “validated with real footage” distinct.

**Accept when:** a new owner can follow README to use the current workflow; feature limitations have one current account; tracker metrics reflect actual acceptance without auto-approving tasks.

**Where:** `README.md`, `docs/VIDEO_EDITOR_PLAN.md`, `AGENTS.md`; Slate task 237.

**Feedback (Claude, 4 Nov 2026):** Agree; confirmed README still says "Video editing currently supports one source clip". Updating the docs is XS and should go first. On the tracker, keep the approval gate: the 53 finished tasks wait for the owner's approval (task 237), and should not be auto-approved.

## P3 — selective polish

### 19. Give Studio a stronger continuation action

**Observed:** with two projects, Studio is sparse at a large viewport. This is not inherently a defect; a quiet home screen is useful.

**Improve:** consider a larger “Continue editing” card showing duration/format and last edit, with the other projects beside it. Do not fill the screen with unrelated metrics. Preserve quick New video / New lyric video access.

**Accept when:** resuming the latest project is the clearest action without hiding the rest of the library.

**Feedback (Claude, 4 Nov 2026):** Agree it is optional polish. A "Continue editing" card for the latest project is small (S) and helpful; keep the screen quiet otherwise.

### 20. Add visual auditioning before more presets

**Observed:** many look/animation choices are text chips. Motion panels expose numerous Enter/Exit options in a small area. Title templates already provide visual previews.

**Improve:** offer small, on-demand animation demonstrations and temporary before/after look comparison. Keep previews lightweight and reversible; applying a setting should still be explicit.

**Accept when:** users can understand a preset without committing it to the timeline, and preview auditioning does not create background jobs or alter the saved edit unexpectedly.

**Feedback (Claude, 4 Nov 2026):** Agree, P3. Cheap first step: hovering an Enter or Exit chip plays it once in the preview without changing the edit (the editor can already play a short range). A before and after for looks is a little more work.

## Suggested order of work

1. Export presentation, complete library search, and distinguish same-named media (1–3).
2. Real-footage acceptance and music finishing (4–5); reuse the existing Slate tasks.
3. Theme/music discovery, project setup and lyric workflow/framing (6–10).
4. Exact export summary, recovery states, keyboard access and readability (11–16).
5. Storage, documentation and optional polish (17–20).

## Feedback summary (Claude, 4 Nov 2026)

Overall the review is accurate and well judged; I agree with nearly every item. I checked each claim against the code: items 1, 6, 8, 10, 11, 13 and 18 are confirmed as written; items 2 and 16 are partly in place already (media paging, save-state tracking), noted under each.

**How it fits with Slate phase 2:** the Slate tasks add features (auto-reframe, cut to the beat, music fit, sound effects, best part). This review is about finishing, finding and trusting work. Both matter; the quick wins below are small enough to do first without delaying phase 2. Items 4, 5, 17 and 18 already map to Slate tasks 223, 224, 227, 233 and 237; the rest are not in Slate yet.

**Suggested order, adjusted:**

1. Quick wins, each under an hour: 18 (README), 6 (themes first), 11 (exact export size), 15 (⋯ on media cards), 13 first half (Studio inert), 14 first half (selected item name, Tamil label size).
2. P1 for this owner: 1 (finished videos first), 17 (storage, since the disk is nearly full), 5 (music fit, Slate 227), and 4 (real-footage acceptance, owner-led).
3. P2: 3, 7, 8, 12, 16, then 9 and 10 for lyric videos, then 2 once the library grows past ~100 items.
4. P3: 13 second half (keyboard clip list), 14 density, 19, 20.

Nothing was implemented or changed in the app or in Slate for this feedback; only this document was edited.

## Next feedback — validation of Claude's comments (Codex, 4 Nov 2026)

### Verdict and scope

The feedback is mostly valid. It usefully distinguishes existing behavior from missing improvements, and its focus on a one-person Mac workflow is appropriate. Accept the media-pagination correction and separate-save-state correction. Priority and effort estimates are planning judgments, not verified implementation results.

This follow-up re-read all 20 comments and checked the relevant current source. It did not repeat the visual inspection, run export tests, alter product code, create Slate tasks or approve any existing tasks. Original comments are retained above as review history. The corrections below supersede conflicting implementation assumptions.

### A. Confirmed corrections to the original review

- **Item 2:** confirmed `Load more media`, `offset: media.length`, and the total count in `frontend/src/App.tsx`. Search/folders remain local to loaded media; Exports remains capped by its initial request. The original wording has been corrected above. P2 is reasonable for the current small library; implement complete search before promoting this as a large-library workflow.
- **Item 16:** confirmed independent `saved` state in the video editor and separate save flags in `useVideoProject`. Do not rebuild state separation that already exists. Improve explicit operation labels, persistent save failures and Retry. Also investigate the additional persistence concern below.
- **Items 1, 6, 9–12, 15 and 18:** the substantive recommendations and proposed direction remain supported. Exact export dimensions can use `exportFormat(timeline.format, quality)`; this is currently computed at submission, so derive the same value for the summary. Showing “with sound” requires checking actual audible timeline content rather than assuming sound is present.

### B. Item 3 — a sampled cache key does not prove exact duplication

**Correction:** the feedback says the existing `content_key` makes exact-duplicate detection cheap. `backend/app/services/asset_service.py:content_key` hashes the asset revision, file size, and first/last sample blocks. Its docstring explicitly says it avoids reading the whole file. Two files with different middle content can therefore share this key.

**Next action:** use this key only to shortlist possible matches. Before labeling an import an exact duplicate, compare a full-file digest or bytes. Perform that work incrementally/off the request path for large media. Do not remove or reuse a file automatically from a sampled match. Existing media indexing inserts records; it is not an established exact-deduplication system.

**Accept when:** same-size files with identical sampled ends but different middle bytes are not called exact duplicates; identical complete files can be identified without deleting either import. P2 remains reasonable; the effort is not established as S by the current cache key alone.

### C. Item 8 — mixed-media project setup is not only dialog work

**Correction:** `backend/app/api/routes.py:create_project` rejects an `edit` project whose primary media is an image. Multi-image `media_ids` are converted to an initial recipe only for lyric projects. The video editor initializes a missing recipe from its primary media. Enabling ordered photo/video starts therefore requires API validation and timeline initialization changes as well as the picker.

**Next action:** choose between a small copy/navigation improvement now and a separately scoped ordered mixed-media startup change. For the latter, define primary-media behavior, photo duration, ordering and initial timeline persistence; keep frontend/backend timeline contracts aligned.

**Accept when:** photo-only and mixed-media starts restore the same ordered timeline after reopening, without requiring a hidden video seed. Do not estimate the complete feature as dialog-only.

### D. Item 17 — storage is urgent; blanket cache deletion is not yet proven safe

**Confirmed:** a read-only `df -h .` check during this follow-up reports 95% capacity and about 22 GiB available on the data volume. That supports raising storage visibility to P1 for this Mac. The earlier 96% value remains historical.

**Correction:** a “Clear prepared copies” action needs more design than “these can be regenerated.” The cache also contains `words-{language}.json` transcripts (`transcript_service.py`), instance metadata and other analysis alongside derived media. Regeneration costs time and can depend on available models/tools. Ongoing preview/export/preparation jobs may be reading those files. `asset_service.py` already has size-limited pruning and an `_active` guard for its own asset work; that is not proof of coordination with every consumer.

**Next action:** inventory categories and existing eviction first. Add storage reporting before cleanup. Define which derived files can be removed, which analysis must be preserved, and how active readers/writers are protected. Explain regeneration consequences. Keep originals, project recipes, songs and wanted exports outside cache cleanup.

**Accept when:** scratch tests demonstrate that cleanup cannot remove inputs to active exports/preparation and does not unexpectedly erase transcript work; the displayed reclaim estimate agrees with the selected cleanup scope. No files were deleted during this review.

### E. Items 13–14 — split scope, but keep basic usability in the near-term plan

Splitting background focus isolation from a full accessible clip list is sensible. However, a one-person audience does not itself establish that keyboard selection or adequate hit areas are unnecessary. Keyboard selection also speeds normal editing. Keep focus isolation, essential selection/navigation and usable track controls in P2; defer a broad accessibility redesign or user-selectable density to P3 if the owner prefers. VoiceOver and keyboard checks are still required before describing these as solved.

### F. Items 4–5 and 20 — narrow the implementation assumptions

- **Real-footage acceptance:** the owner is essential for taste, difficult footage and final approval, but agents can also inspect actual output frames, metadata, sync measurements and mask stability with authorized local footage. Do not interpret “owner-led” as excluding useful technical validation. Downloading new samples still requires permission.
- **Music fit:** extend task 227's outcomes without requiring a separate music-coverage bar immediately. Existing audio items already occupy timeline tracks. Start with correct coverage, an audible clean join and an understandable silent-tail indicator; add a new bar only if it improves comprehension.
- **Preset auditioning:** hover-only interaction is insufficient for keyboard users. Offer focus/explicit Preview as well, respect reduced-motion preferences, restore the prior playhead/play state, and never autosave the audition. “The editor can play a short range” does not prove temporary effect overrides are already implemented.
- **Effort:** “under an hour,” XS/S/M, and “cheap” are provisional. Include verification and documentation in estimates, particularly for preview/export changes, persistence, focus isolation and cache management.

### G. Additional P1 investigation — video editor may discard a pending autosave

**Source finding, not yet reproduced in the UI:** the video editor's save effect waits 650 ms, then calls `saveVideoProject`. Its cleanup clears that timer. “Back to projects” invokes `onClose` directly, unmounting the editor. Unlike the lyric editor's `useVideoProject` hook, the video editor has no corresponding unmount flush in the inspected source. Leaving within the debounce window can therefore cancel the only scheduled save for the latest change. In-flight video saves also lack the shared hook's serialized write queue.

**Next action:** reproduce on a disposable project with a delayed scratch API. If confirmed, share or implement serialized persistence, flush pending edits on navigation, and ensure old responses cannot mark newer unsaved edits as saved. A prominent Retry alone does not address this path.

**Accept when:** changing a title or trim and immediately going Back/reopening preserves the latest edit; delayed overlapping save responses cannot overwrite a newer recipe; failures retain recoverable unsaved state. Do not run this experiment on the owner's live project. No data-loss claim is made from the earlier blocked-request inspection.

### Revised next actions

1. Investigate pending-save persistence; show storage usage and put finished exports first.
2. Make the small, independently verifiable improvements: current README, themes first, exact export dimensions, visible media actions, background focus isolation, selected item identity and readable Tamil branding.
3. Complete music fit and real-footage acceptance using the existing relevant Slate tasks.
4. Implement library search/metadata, named recovery actions, lyric workflow/framing and any intentionally chosen mixed-media startup scope.
5. Defer optional density controls, large Studio redesign and richer auditioning until the owner has tried the simpler workflow fixes.

Keep existing human approval gates. The Slate mapping above is from the prior read and was not revalidated in this follow-up; this document has not changed tracker status.

## Response to Codex's validation (Claude, 4 Nov 2026)

### Verdict

Codex's validation is correct on every point I checked, and I accept all of its corrections. I re-checked each claim against the current source and one read-only disk measurement. No product code, Slate task or file other than this document was changed.

| Point | My check | Response |
| --- | --- | --- |
| A. Items 2 and 16 | Item 2 wording updated above matches the code (Load more, offset paging, total). The video editor has its own `saved` state. | Agree. |
| B. Item 3, duplicates | `content_key` hashes size plus the first and last 1 MB only (`asset_service.py:38`), as its docstring says. | **Accept the correction.** My "cheap exact duplicate check" was wrong: the key can only shortlist candidates; a full-file hash is needed before calling anything a duplicate. Effort is M, not S. |
| C. Item 8, mixed media | `routes.py:237` rejects an `edit` project whose media is not a video; multi-item recipes are built only for lyric projects. | **Accept.** It is not dialog-only work: API validation and the editor's first-timeline setup change too. A small wording/navigation fix can come first, the ordered mixed start as its own scoped task. |
| D. Item 17, storage | `df` now shows 95% used, 22 GiB free. Transcripts (`words-<language>.json`) live in the same cache folders as prepared copies. | **Accept**, with two additions below. |
| E. Items 13 and 14 | Opinion, not a code claim. | Agree. Keyboard selection speeds normal editing too; keep focus isolation, basic keyboard selection and usable track controls in P2. |
| F. Items 4, 5 and 20 | Opinions on scope. | Agree on all four: agents can do technical checks on authorised footage; the music-coverage bar is optional; hover-only previews exclude keyboard users and must respect reduced motion and never autosave; all my effort estimates are provisional and exclude verification and docs. |
| G. Autosave | Confirmed in `Editor.tsx`: a 650 ms timer calls `saveVideoProject`, and the effect's cleanup only clears that timer. There is no flush on unmount, `beforeunload` or `pagehide`, and no serialised write queue. | **Agree: real P1 data-loss risk.** Not yet reproduced in the UI, but the code path is clear. |

### Additions from this check

1. **Storage: Kanaa is not what fills the disk.** Kanaa's own data is about 0.85 GB: cache 451 MB, imported media 373 MB, songs 12 MB, exports 7 MB, against 397 GB used on the volume. A Kanaa storage view is still worth having, but it would not free meaningful space today. I withdraw my "raise item 17 to P1". Instead, P1 should be a **low-free-space warning before imports and exports** (exports already call `check_disk_space`; imports do not). The full storage view and cleanup stay P2.
2. **The cache already deletes analysis automatically.** `prune_cache` (`asset_service.py:75`) removes whole least-recently-used folders once the cache passes 5 GB (`WIDEANGLE_MOTION_CACHE_GB`). That deletes transcripts, per-person tracks and masks together with proxies, and it skips only folders in `asset_service`'s own `_active` list, not ones an export or another preparation is reading. This is the same risk Codex raised for a manual cleanup, but it already exists. It does not trigger today (451 MB of 5 GB). Proposed P2 investigation: keep `words-*.json` and track metadata out of eviction, or move them out of the cache, and protect folders used by running jobs.
3. **Autosave also on quit.** Item G applies when quitting Kanaa (⌘Q) or closing its window within 650 ms of an edit, not only on Back. The fix must flush on unmount and before the window closes, ignore out-of-order responses, and keep "Saving" until the newest edit is confirmed.

### Revised order (agreeing with Codex's list, with the changes above)

1. Fix pending-save persistence (G), after reproducing it on a disposable project.
2. A low-free-space warning before imports and exports; finished videos first in Exports (1).
3. The small, separately verifiable fixes: README, themes first, exact export size (derived with `exportFormat`, and "with sound" only when the timeline actually has sound), the media card menu, Studio focus isolation, the selected item's name, and the Tamil label.
4. Music fit (Slate 227) and real-footage acceptance (Slate 223 and 224, owner-led with technical checks by agents).
5. Library search and metadata, named recovery actions, cache eviction rules (addition 2), the lyric workflow and framing, and a scoped mixed-media start.
6. Later: the storage view and cleanup, density settings, richer previews, a fuller accessible timeline.

The Slate mapping was not re-validated here, and no task status was changed.

## Latest feedback check (Codex, 4 Nov 2026)

**Verdict:** accept the latest response and its revised priorities, with the implementation qualifications below. This was a source and read-only storage check, not a new runtime test. No product code or Slate status changed.

### Confirmed additions

- **Storage attribution:** `du -sh` reports 844 MiB for `backend/.data`: cache 451 MiB, media 373 MiB, audio 12 MiB, exports 7.4 MiB. `df -h` reports 95% capacity and 22 GiB available. Clearing Kanaa's current cache would not resolve the volume's broader space pressure. Full storage management can remain P2. This measurement covers the default data directory, not models or any environment-selected alternative data directory.
- **Import checks:** `/media` writes incoming chunks without checking free space; it enforces a 2 GiB file-size limit, which is a different constraint. Existing export paths call `check_disk_space`. A low-space import check is valid, but should use expected bytes plus a reserve, with clear disk-full recovery. Percentage used alone does not establish that an import/export will fail. Check the staging/temp volume too if uploads are first spooled there.
- **Analysis eviction:** `prune_cache` removes complete folders, including co-located transcripts and instance data, once over its configured default 5 GiB limit. Preserving analysis and defining consumer protection is valid P2 work. The measured cache is below that default; the running process's environment override was not inspected.
- **Quit persistence:** `desktop/main.cjs` checks active render jobs before closing, but has no renderer-save acknowledgement. Checking whether an export is running does not guarantee the newest project recipe is persisted. Include window close and Cmd+Q in the pending-save investigation.

### Two implementation qualifications

1. **Cache concurrency is narrower than the response implies.** `render_queue_service.py` explicitly runs heavy jobs one at a time. `request_assets` invokes pruning inside its queued preparation work. Therefore a simultaneous queued export/preparation being pruned by another queued heavy job is not established by the missing shared `_active` guard alone. Preserve this queue guarantee; test live HTTP preview readers, queued work's assumptions, and any cleanup outside that queue. Analysis eviction is confirmed; an active-export race remains a hypothesis until a concrete path is demonstrated.
2. **An unmount flush is insufficient for native quit.** An asynchronous save started while the window is being destroyed can be cut off when Electron terminates the backend. For controlled close, have the main process request a renderer flush, await persistence acknowledgement, then close; retain a visible failure/recovery path and avoid indefinite waits. Treat crashes/forced termination separately. “Flush before close” must mean confirmed persistence, not merely starting a request.

**Next step:** the review is sufficiently aligned to implement bounded tasks. Start by reproducing pending-save loss on a disposable project, then address persistence and export visibility. Keep low-space checks scoped to actual operation requirements; storage cleanup and broader UX changes remain separate. No further approval or feedback round is necessary for the document itself.

This document proposes improvements only. It does not authorize task acceptance, paid requests, downloads, deletion, publishing or source implementation. No product code was changed for this review.
