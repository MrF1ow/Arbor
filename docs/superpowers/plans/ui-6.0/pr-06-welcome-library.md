# PR 6: Welcome, first run, and the file-review dialog

Branch `ui/06-welcome-library`, stacked on `ui/05-shell`. Master plan §6.4, §11 row 6, Appendix B items 1–2. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

PR 5 already built the sidebar library tree, add class, active-root switching, and the Add files → `import_sources` → plan → `update-plan-store` path. **This PR finishes those flows with real UI.** Legacy reference: `desktop/src/legacy/main.ts`.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Welcome / first run (`routes/welcome.tsx`)
- Replace the placeholder with an `EmptyState` built from the mockup's visual language:
  - the Arbor logo (light/dark swap like the sidebar) at a larger size
  - a serif title "Welcome to Arbor"
  - the body copy from legacy `index.html` ("Choose a Knowledge folder, add a class, and drop lecture files in from the app. Arbor reads them and writes study notes.")
  - a primary **Choose Knowledge folder…** button
- Choosing a folder ports legacy `activateKnowledgeRoot` (~2099) and `pickFolder` (~3168):
  1. `ipc.openDialog({ directory: true })`
  2. `init_knowledge_repo { path }` (it returns whether the repo was created; log "Initialized Knowledge repo at …" to the job log when true, as legacy does)
  3. add the root to settings `knowledge_roots` and set it active (reuse the PR 5 switch-root mutation)
  4. `init_arbor_db { root }`
  5. navigate to the first course's Overview, or stay on welcome showing the next step ("Add your first class" with an inline add-class field) when the root has no courses
- **Outside Tauri** (`hasTauriInvoke(window) === false` and not mock mode): the welcome copy becomes the legacy desktop-only message (legacy `showDesktopOnlyMessage` ~4323: "This is the Vite dev server. Open the Arbor desktop window; a browser tab cannot talk to the worker."). The button is disabled. Nothing else calls `invoke`. The shell must not throw: the sidebar shows an empty library and the provider line shows "Desktop app required".
- **Empty states elsewhere:** a course route for a root with **zero digests** shows on the Overview placeholder an `EmptyState` with **Add files** as its primary action. This is the hook PR 7 will keep.

## 2. File-review dialog (`components/app/update-review-dialog.tsx`), master plan §6.4
- Opens when `update-plan-store.open` is true (set by PR 4/5 `presentUpdatePlan` from Update, Add files, or the watch path when auto-update is off or auth is missing). Mounted once in the shell; lazy-loaded so it stays out of the entry chunk.
- **Title:** "Files to process" (serif, per the dialog styles). **Description:** "N file(s) to process. Ranges like `151-300` or `40-55, 120-122`. Leave blank for the whole file." (legacy `index.html` review hint).
- A `Table` with columns **File** (path, `truncate` with a full-path tooltip), **Pages** (`page_count`), and **Ranges** (an `Input`, placeholder "all", prefilled with `formatRanges(p.suggested_ranges)`). Below an input, show `alignmentNote(p)` in `text-xs text-faint-foreground`, or in `text-destructive` for the ambiguous case.
- **Pure helpers:** move `formatRanges`, `parseRanges`, and `alignmentNote` from legacy (~2757–2790) into `src/domain/update.ts`, next to the existing `selectionsFromPending`, with **unit tests** for valid ranges, single pages, out-of-bounds, and garbage input (the legacy error messages verbatim).
- **Validation:** parse on blur and on Confirm. Show the `parseRanges` error inline under the field (`Field` error styling), and disable Confirm while any field is invalid.
- **Footer:** **Cancel** (closes and clears the store; legacy `cancel-review`) and **Confirm** (primary). Confirm builds selections from the inputs (legacy `collectSelections` ~2821) and calls the start-update mutation with `trigger: "manual"` (or `"watch"` when the plan came from the watch path; keep that on the store). On success, close and put the job id in `job-store`. On failure, keep the dialog open and log `Update failed to start: …` (legacy `startUpdateWithSelections` ~2682).
- **Viewer write-block:** Confirm is disabled with the PR 5 viewer hint when blocked.
- **The dialog must not open the log drawer** (D6). The log lines from `presentUpdatePlan` stay unread until the user opens the log.
- **Keyboard:** Enter in a range field moves to the next field; Enter in the last field confirms when valid; Escape cancels.

## 3. Import feedback
- **Add files** in the header shows a busy state (spinner in the button) while `import_sources` runs. Success shows `toast.success("Added N file(s)")`; failure shows `toast.error` with the message. The review dialog then opens through the store when there's something to process. If the plan is empty, the log gets "Nothing to process" and no dialog appears.
- **Drag and drop:** while a course is open, dropping files onto the main column calls the same import path (Tauri file-drop event or HTML5 drop, whichever the legacy app used; check legacy for `onDragDropEvent` / `drop` handlers and mirror it, or skip with a note if legacy had none).

## 4. Tests (vitest, replacing legacy regex tests)
- Delete `tests/workspace-ui.test.mjs` and `tests/brand-mark.test.mjs`. Replace them with behavior tests:
  - **Welcome:** choose folder → the mockIPC log shows `init_knowledge_repo`, `save_settings` (the new root active), and `init_arbor_db` in that order, then navigation to the first course Overview; with zero courses, the add-class step shows.
  - **Desktop-only:** with `hasTauriInvoke` false, the copy shows and **no invoke** is attempted.
  - **Brand:** the sidebar and welcome render the logo `img` with an empty `alt` and swap light/dark sources by theme (that's what `brand-mark` tested).
  - **Review dialog:**
    - opening from the store renders a row per pending file with prefilled ranges and alignment notes
    - an invalid range shows the legacy error and disables Confirm
    - Confirm sends `start_update` with the exact `selections` (`ranges: null` for blank) and closes
    - a start failure keeps it open
    - Cancel clears the store
    - the log drawer stays closed throughout
  - **Import:** busy state, then success toast, then dialog; and the empty-plan path shows no dialog.
  - **Workspace grouping** (`workspace-ui` covered this): two roots render as two groups; clicking a course in the other root switches root first (assert call order) and lands on its Overview.
- `domain/update.test.ts` for the pure helpers.

## 5. Acceptance (run all, report real results)
- `npm test`, `npm run lint`, `npm run build` (entry gzip; the review dialog must not be in the entry chunk).
- **Needs visual check (Claude):**
  - welcome (light/dark, 700/1100/1600)
  - the review dialog with 3+ files including alignment notes and an error
  - the Add files busy state and toast

## Commit
Focused commits on `ui/06-welcome-library`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.
