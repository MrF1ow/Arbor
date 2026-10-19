# PR 8: Flashcards

Branch `ui/08-flashcards`, stacked on `ui/07-notes`. Master plan §4.4 (tabs, 38px grade buttons), §7.1 (study-writes queue), §8, §11 row 8, and Appendix B item 4. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design reference:** `docs/design/2026-10-18-ui-arbor-paper.html`. Read the source for `section.view.cards`, `.cards-bar`, `.progress`, `.card`, `.grades`, and `.kbd`.
- **Legacy reference:** `desktop/src/legacy/main.ts`, plus the markup in `desktop/legacy.html` (~126–161):

  | Legacy code | Line |
  |---|---|
  | `updateStudyWriteStatus` / `showStudyWriteDroppedNotice` | ~430–450 |
  | `refreshStudyEnabled` | ~635 |
  | `refreshFlashcardDueLabel` | ~1605 |
  | `setFlashcardDeckToggle` | ~1610 |
  | `flashcardSessionForMode` | ~1616 |
  | `renderCurrentFlashcard` | ~1627 |
  | `loadFlashcards` | ~1671 |
  | `gradeCurrentFlashcard` | ~1729 |
  | `startFlashcardJob` | ~1770 |
  | `loadCitations` | ~2062 |
  | the generate/refresh handlers | ~3739–3750 |
  | the flashcard button handlers | ~3954–4017 |
- **Pure logic:** already in `src/domain/flashcards.ts`. **Reuse it; don't reimplement it.**

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Route and data (`course.$course.flashcards.tsx` → `components/flashcards/flashcards-view.tsx`)
- **Keep the existing `card` search param** (PR 7 make-card sends `?card=<id>`).
- **On mount:** `await flushStudyWrites(3000)` once (per mount, keyed by root and course, like PR 7's Overview), then read:
  - the deck: `useStudyJson(root, course, "flashcards.json")` parsed with `parseFlashcardDeck`. If `deck.course !== course`, treat it as missing, as legacy did.
  - the due data: `useCourseOverview(root, course).data.due` (`due_ids`, `deck_count`). That's the same query as the Overview, so there's no extra `study_progress` call.
  - the stale flag: `useStudyArtifactStale(root, course, "flashcards")`.
  - the citations report: `useStudyJson(root, course, "citations.json")` parsed with `parseCitationsReport`; null when missing.
- **Review state** is feature-local `useReducer`/`useState` built on the domain functions:
  - `createReview`, `cardsForIds`, `flipReview`, `nextReview`, `previousReview`
  - `requeueCurrentCard`, `dropCurrentCard`, `advanceAfterGrade`, `applyGradeToDueIds`, `shuffleCards`

  Initialize once per loaded deck, not on every query refetch. A background refetch must not reset the user's position; re-init only when the course or the deck identity changes.
- **`?card=` focus:** after the session initializes, if `card` is set, find it in the current session. If it isn't there in due mode, switch to the full deck. Then set `index` there, unflipped. Clear the param afterwards with a `replace` navigate, so a reload doesn't re-focus.

## 2. Layout (mockup `.view.cards`)
A centered column, `min(680px, 100%)`, with the reading pane scrolling as in PR 7.
- **Cards bar:**
  - an underline `Tabs` deck toggle: "Due today · {n}" and "Full deck · {deck_count}". The legacy labels were "Due today (n)" / "Full deck (n)"; use the mockup's middle-dot form. The due count updates live as you grade (`applyGradeToDueIds`).
  - a 3px progress bar (index+1 / total, token colors)
  - the count text "{i} / {total}"
- **Status line under the bar** (render only what applies):
  - the **stale** badge "Digests updated since last generation." (`Chip` or faint text with the `RefreshCw` icon)
  - the **`UnsavedBadge`**: a small outline button showing `useStudyWriteStatus().label` ("N unsaved · Retry"), only when `label` is non-null; clicking calls `retry()`. Build it as `components/app/unsaved-badge.tsx` so PR 9 Quiz reuses it.
  - a **Refresh from digests** button, which starts the flashcard job with `force: true`
- **Card** (mockup `.card`): a surface with border, radius, and shadow, `min-h-80`, padding as in the mockup, and `cursor-pointer`; clicking anywhere flips it.
  - the side label: italic serif, faint, "Question" / "Answer"
  - the front: serif ~23px (add a token or a utility in `index.css` if one doesn't exist; no arbitrary values)
  - when flipped, the back below a dashed top border, in the reading font and muted color, as in the mockup (it reveals the answer below the question, not a swap)
  - **footer:**
    - left: a source `Chip` button, `digest · heading · p. page`, which navigates to that digest with `?heading=` via the PR 7 helpers (`resolveDigestSlug`)
    - an **Unverified** citation badge when `failedIdsFor(report, "study/flashcards.json")` has the card, with the failure `reason` as a tooltip
    - tags joined with " · "
    - right: "Click or press Space to flip" with a `Kbd`
- **Grade row** (mockup `.grades`): 3 outline buttons at `lg` (38px) in a 3-column grid, each a label plus a `Kbd`:
  - **Again** `1` (label in `text-destructive`)
  - **Wrong** `2`
  - **Mastered** `3` (label in `text-success`)

  Shown only when flipped; before flipping, show the Flip primary button in that row ("Flip", or "Show front" when flipped, as in legacy).
- **Nav row:** Previous, Next, and Shuffle as ghost/outline buttons with `ChevronLeft`/`ChevronRight`/`Shuffle` icons, next to or under the grade row (match the mockup density; Shuffle and Prev/Next are legacy features the mockup omits).
- **Empty states:**
  - no deck: an `EmptyState` with the legacy copy `No flashcards yet for {course}. Generate a deck from your digests.` and a primary **Generate** button. Use the course display name in place of the slug, but keep the sentence otherwise verbatim.
  - an empty session: "No cards due today." in due mode, "No cards in deck." in full mode, with the grade buttons hidden. In due mode, also offer a "Study full deck" link button.

## 3. Keyboard (new in 6.0; scoped to this view)
| Key | Action |
|---|---|
| `Space` | flip |
| `1` | Again (only when flipped) |
| `2` | Wrong (only when flipped) |
| `3` | Mastered (only when flipped) |
| `←` | previous |
| `→` | next |

- Ignore the keys while focus is in an input, textarea, or contenteditable, or while any dialog is open.
- One `keydown` listener on `window`, registered in an effect with cleanup. `preventDefault` on Space so the page doesn't scroll.
- Add these to the exported shortcut table in `lib/shortcuts.ts` under a "Flashcards" group (Settings → Shortcuts renders it in PR 14).

## 4. Grading (§7.1: optimistic, through the study-writes queue)
Port `gradeCurrentFlashcard`, keeping its exact due vs full-deck semantics:
- **due mode:** `again` → `requeueCurrentCard`; anything else → `dropCurrentCard`
- **full mode:** `again` → `requeueCurrentCard`; anything else → `advanceAfterGrade`
- update the due ids with `applyGradeToDueIds`
- then `useEnqueueStudyWrite()({ key: `${course}:${card.id}:${Date.now()}`, root, course, args: { root, course, action: "grade", id, result, digest, heading: heading ?? "" } })`

The next card **must render before** `study_progress` resolves. Never `await` the write. Also `setQueryData` on `qk.courseOverview(root, course)` to update `due.due_ids`/`count` optimistically, so the Overview stat and the deck toggle agree. The queue's `onSent` invalidation then reconciles.

## 5. Generate / refresh (port `startFlashcardJob`)
- **Gates:** viewer write-block (`viewerBlocksWrite` plus the hint); no model → "Select a model in Settings." inline; the auth gate through `fetchAuthStatus(provider, true)`, which on failure appends `signedOutJobMessage(...)` to the job log as legacy did (the log must **not** open).
- Start through `useStartFlashcardJobMutation(root)` with `{ course, force, model, provider }`. On success, append `Flashcard job {id} started.`; on failure, `Flashcard generation failed to start: {error}`.
- **Disable while a study job runs:** legacy `studyJobRunning`. Use `job-store` status `running` as the signal.
- When the job finishes, the events bridge already invalidates the study queries. Verify that flashcards and the stale flag refetch, and add the missing invalidation if not.

## 6. Tests (vitest; delete `tests/flashcards-ui.test.mjs` and port its intent; replace the flashcard half of `tests/issue-97-phase4.test.mjs`)
- **Optimistic grading:** with a mockIPC `study_progress` handler for `action: "grade"` that **never resolves**, flip, press `3`, and the next card is shown immediately. The `study_progress` call has the exact args (`action`, `id`, `result`, `digest`, `heading`, `writeId` present).
- **Due vs full semantics:**
  - due + Again requeues (the card comes back later)
  - due + Mastered drops it, and the due count decrements
  - full + Wrong advances
- **Toggle:** the labels show the counts, and switching rebuilds the session.
- **Keyboard:** Space flips; 1/2/3 are ignored before flipping; the arrows navigate; keys are ignored while typing in an input.
- **`?card=` focus:** it lands on that card (switching to the full deck if needed) and the param is cleared.
- **Source chip** → the notes digest route with `heading`.
- **Unverified badge** from a fixture `citations.json`.
- **Stale badge** when `study_artifact_stale` is true.
- **Unsaved badge:** with failing writes (a mock rejecting with a transient error), "1 unsaved · Retry" appears, and clicking it triggers a flush (another `study_progress` attempt).
- **Empty deck:** the copy and Generate. Generate when signed out → the signed-out log line, no `start_study_job`, `logOpen` false. Generate when signed in → `start_study_job` with `flashcardJobArgs(…, force false)`. Refresh → `force true`. Viewer → disabled.
- **Background refetch** of the deck doesn't reset the position.

## 7. Acceptance (run all, report real results)
- `npm test` (must exit 0), `npm run lint`, `npm run build` (entry gzip ≤ 250 KB; the flashcards route is code-split by the router plugin).
- No new `style-allow` without a reason in the report.
- **Needs visual check (Claude):**
  - the view vs the mockup at 700/1100/1600, light and dark
  - flipped vs unflipped
  - the grade row and Kbd alignment
  - the empty states
  - the badges
  - make-card → Flashcards focus

## Commit
Focused commits on `ui/08-flashcards`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.
