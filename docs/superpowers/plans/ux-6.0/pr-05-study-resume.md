# PR 5: Flashcards and quiz resume where you left off

Branch `ux/05-study-resume`, stacked on `ux/04-composer`. Plan: `README.md`. **The agent rules in `../ui-6.0/README.md` apply in full:** no browser, never launch the app window, no live provider runs.

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

## Today

Grades and quiz answers are already saved to disk (`write_quiz_progress`, the flashcard progress writes in `lib/study-writes`). But the *session position* is plain component state, so leaving the tab and coming back restarts at card or question 1:
- **Flashcards** (`components/flashcards/flashcards-view.tsx`): `review: FlashcardReview` (cards, index, flipped), `deckMode` and `dueIds`.
- **Quiz** (`components/quiz/quiz-view.tsx`): `review: QuizReview` (questions, index, selected, submitted, answers).

Both views already compute a stable *identity* for the loaded deck or pack:
- flashcards: `${root}|${deckIdentity(deck)}` (course plus the ordered card ids);
- quiz: `packIdentity` (`quiz-view.tsx` ~38).

A new session starts when `identity !== sessionIdentity`.

## 1. Store: `desktop/src/stores/study-session-store.ts`

A Zustand store with `persist` (`name: "arbor.study-sessions"`, `version: 1`), following `ui-store.ts`.

```ts
type SavedFlashcards = { identity: string; savedAt: number; deckMode: "due" | "full"; cardIds: string[]; index: number; flipped: boolean };
type SavedQuiz = { identity: string; savedAt: number; questionIds: string[]; index: number; selected: number | null; submitted: boolean; answers: Record<string, number> };
sessions: Record<string, SavedFlashcards | SavedQuiz>   // key: `${root}\0${course}\0${"flashcards"|"quiz"}`
save(key, value); clear(key)
```

- Store **ids only**, never card or question content.
- Cap the map at 50 entries. On save, drop the oldest by `savedAt`.
- Pure helpers in `desktop/src/domain/study-session.ts`, with unit tests:
  - `snapshotFlashcards(review, deckMode, identity)` and `restoreFlashcards(saved, deck, identity) → { review, deckMode } | null`:
    - `null` on an identity mismatch;
    - rebuilds `cards` from the deck by id, dropping ids that no longer exist;
    - clamps `index`;
    - returns `null` if no cards remain.
  - `snapshotQuiz(review, identity)` and `restoreQuiz(saved, pack, identity) → QuizReview | null`. Same rules. Keep `answers` only for questions that still exist. If the restored index has an answer, `selected` and `submitted` must match it (the same rule as `restoreAt` in `domain/quiz.ts`).

## 2. Flashcards view

- **Start of a session** (the `identity !== sessionIdentity` branch):
  - If `focusCardId` is set (the "Make card" / search deep link), today's behaviour wins: start fresh, focused.
  - Otherwise try `restoreFlashcards(saved, parsedDeck, identity)`. If it restores, use its `review` and `deckMode`; else use today's `sessionWithOptionalFocus`.
  - For due mode: when restoring, intersect `cardIds` with the current due ids (`overview.data.due.due_ids`), so a card graded elsewhere isn't shown again. If nothing remains, start fresh.
- **Save** with an effect: whenever `review`, `deckMode` or `sessionIdentity` changes and a valid session exists, `save(key, snapshotFlashcards(...))`.
- **Restart button** in the view's top action row (next to the existing deck-mode controls):
  - `Button variant="ghost"` with the `RotateCcw` icon, labelled "Restart";
  - it opens an `AlertDialog` ("Restart this deck? Your grades are kept; only your place in the deck resets.");
  - confirming calls `clear(key)` and `setReview(sessionForMode(deck, deckMode, dueIds))`.
- **Switching deck mode** (due ↔ full) keeps today's behaviour (a fresh order) and saves the new state.

## 3. Quiz view

- **Start of a session:** try `restoreQuiz` first; else `createReview(pack)`.
- **Save** on every `review` change.
- **Restart button** in the header row next to "Refresh from digests", with the same `RotateCcw`, label and confirm pattern: "Restart this quiz? Your past answers stay in your stats; the quiz starts again from question 1." Confirming calls `clear(key)` and `setReview(createReview(pack))`.
- The score line ("x / n correct") must reflect the restored `answers`. It already derives from the review.

## 4. Edge cases (each needs a test)

- Leave mid-deck, return → same card and same flipped state.
- Leave mid-quiz on a submitted question, return → same question, still submitted, same selection.
- Regenerated deck or pack (different identity) → starts fresh, and the stale saved entry is overwritten on the next save.
- A different course or root → independent sessions.
- Restart → index 0; the saved entry is cleared, then re-saved at index 0.
- A `focusCardId` deep link beats the saved position.
- A corrupt or unknown persisted value (e.g. missing fields) → ignored, with no crash. Validate in `restore*`.
- **Tab-switch round trip in vitest:** render the flashcards route, advance 2 cards, navigate to Notes, navigate back → card 3 is shown. Do the same for the quiz.

Remember the 5.1.0 lesson: a localStorage restore once lost data. Test that the persisted JSON actually round-trips through the `persist` storage, with a fresh store instance reading what the first one wrote.

## 5. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `npm run lint`
- `npm run build`

Commit in logical commits:
1. domain and store
2. flashcards
3. quiz

---

## Execution plan

| Step | Agent | Task |
|---|---|---|
| 1 | Composer 2.5 | Implement, check, commit. |
| 2 | Claude | Rerun and skim. |
| 3 | Grok 4.7 | QA, review only. Focus: restore races with the existing flush/refetch effects (`queriesSettled`, `lastSyncedDataRef`); due-mode intersections; persisted-data validation; Restart wording and behaviour; nothing else in the views regressed. |
| 4 | Composer 2.5 | One fix round. |
| 5 | Claude | Audit plus a headless preview on `dev:mock`: leave and return on both tabs, Restart, light and dark. Then push and open a stacked PR. |
