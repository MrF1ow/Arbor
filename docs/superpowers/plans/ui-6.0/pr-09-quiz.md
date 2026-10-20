# PR 9: Quiz

Branch `ui/09-quiz`, stacked on `ui/08-flashcards`. Master plan §7.1 (study-writes queue), §11 row 9, Appendix B item 5. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the mockup has no quiz view. **Reuse the Flashcards visual system from PR 8** so the two study modes feel like one family: the same `--container-flashcards` column, a cards-bar-style header, a card surface, 38px buttons, `Kbd` hints, the `UnsavedBadge`, the stale line, and the source chip and Unverified badge. Extract any shared pieces out of `flashcards-view.tsx` into `components/study/*` rather than copying them: the study column, the study bar with its progress, the source chip label, and the Unverified badge.
- **Legacy reference:** `desktop/src/legacy/main.ts`, plus the markup in `desktop/legacy.html` (~166–200):

  | Legacy code | Line |
  |---|---|
  | `renderCurrentQuiz` | ~1790 |
  | `loadQuiz` | ~1826 |
  | `startQuizJob` | ~2002 |
  | generate/refresh | ~3747–3753 |
  | the choice/submit/next/prev/source handlers | ~4020–4081 |
- **Pure logic:** `src/domain/quiz.ts`: `parseQuizPack`, `parseQuizProgress`, `createReview`, `currentQuestion`, `sessionScore`, `selectChoice`, `submitChoice`, `nextReview`, `previousReview`, `quizJobArgs`. **Reuse it.**

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Route and data (`course.$course.quiz.tsx` → `components/quiz/quiz-view.tsx`)
- **On mount:** `flushStudyWrites(3000)` once per root and course, then a fresh read (the same post-flush gating pattern PR 8 settled on) of:
  - `quiz.json` via `useStudyJson`, parsed with `parseQuizPack`; a course mismatch means missing
  - `useQuizProgress`, parsed with `parseQuizProgress`
  - `useStudyArtifactStale(…, "quiz")`
  - `citations.json`
- **Review state:** feature-local, built with the domain functions. Initialize it during render on identity change, not in an effect (the PR 8 pattern). A background refetch keeps the index, selection, and submitted state.

## 2. Layout
- **Bar:** "Question {i} of {n}", a progress bar, and the score "{correct} / {total} correct" (`sessionScore`). Below it: the stale line, the `UnsavedBadge`, and **Refresh from digests** (force).
- **Card:**
  - the prompt in the serif `--text-flashcard-q` style
  - **4 choice buttons** in a vertical list, each full-width and left-aligned, with a letter `Kbd` (A–D or 1–4; pick 1–4 for consistency with flashcards). States:
    - selected: primary border / ring
    - after submit: the correct choice gets a success tone and a `Check` icon; the wrong selected choice gets a destructive tone and an `X` icon
    - all choices are disabled after submit
  - after submit: the explanation below a dashed rule (the reading font, muted, like the flashcard answer)
  - footer: the source chip (digest title · heading → Notes at that heading, via the PR 8 helper) and the Unverified badge for `study/quiz.json` with its reason
- **Controls:** Previous (outline), **Submit** (primary, 38px; disabled until a choice is selected and after submit), and Next (outline).
- **Empty state:** an `EmptyState` with `No quiz yet for {course display name}. Generate questions from your digests.` and **Generate**.

## 3. Keyboard (scoped to the view; same guard rules as PR 8: inputs, dialogs, modifier chords, cleanup)
| Key | Action |
|---|---|
| `1`–`4` | select a choice (before submit) |
| `Enter` | submit (when a choice is selected and not yet submitted), otherwise next |
| `←` / `→` | previous / next |

Add these to the shortcut catalog with `group: "Quiz"`.

## 4. Submit (§7.1: optimistic, queued)
Port the legacy submit handler exactly:
- `submitChoice(review, choiceIndex, progress)` → the new review and progress
- only on the first submit of that question: enqueue a study write with `{ root, course, action: "quiz", id, result: "correct" | "wrong", digest, heading: heading ?? "" }`, key `${course}:${id}:${Date.now()}`
- **never await** it
- optimistically `setQueryData` on `qk.quizProgress(root, course)` with the new progress, so the Overview's quiz-accuracy tile agrees; the queue's `onSent` invalidation reconciles

## 5. Generate / refresh (port `startQuizJob`)
Use the same gates and pattern as PR 8 Flashcards:
- viewer block, "Select a model in Settings.", and the auth gate with `signedOutJobMessage` to the log (the log never opens)
- `useStartQuizJobMutation`, then `Quiz job {id} started.` / `Quiz generation failed to start: {error}`
- disabled while a job runs

## 6. Tests (vitest; delete `tests/quiz-ui.test.mjs`; port the quiz half of `tests/issue-97-phase4.test.mjs` to a behavior test)
- **Optimistic submit:** with a never-resolving `study_progress` for `action: "quiz"`, submit → the explanation and the correct/wrong styling show immediately, the score updates, and the exact args are sent (including `heading: ""` for a null heading, and `writeId`). A second submit of the same question doesn't enqueue again.
- **Keyboard:** 1–4 select, Enter submits then advances, the arrows navigate, nothing fires while typing, and Ctrl+1 doesn't select.
- **Unverified badge** with its reason. **Stale badge.** **Unsaved badge** retry.
- **Source chip** → the digest route with `heading`.
- **Empty state** with Generate: the signed-out log line, no job, the log stays closed; when signed in, `start_study_job` with `quizJobArgs(force false)`; Refresh sends `force true`; viewer and no-model cases.
- **Course mismatch** → empty.
- **Background refetch** keeps the position.
- **The quiz progress cache** is updated optimistically.
- **Flashcards still pass** after the shared-component extraction.

## 7. Acceptance (run all, report real results)
- `npm test` (exit 0), `npm run lint`, `npm run build` (entry ≤ 250 KB; quiz is code-split).
- **Needs visual check (Claude):**
  - the quiz at 700/1100/1600, light and dark
  - selected / correct / wrong states
  - the explanation
  - the empty state
  - consistency with Flashcards

## Commit
Focused commits on `ui/09-quiz`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.
