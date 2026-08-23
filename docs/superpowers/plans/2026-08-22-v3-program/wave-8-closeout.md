# Version 3 closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the study loop, heading scroll, and living docs so Version 3 can be tagged after a recorded Mac E2E run.

**Architecture:** Keep the existing progress JSON shape (`seen`, `correct`, `wrong`). Grade buttons write those fields. Quiz review remembers submitted choices by question id for the session. Markdown headings get slug ids so source chips can scroll. Docs and the program overview already describe this wave; implementation must match them.

**Tech Stack:** TypeScript desktop (`desktop/src/*.ts`, `desktop/index.html`), node:test in `desktop/tests/*.mjs`, Tauri only if a command signature changes (it should not).

**Issue:** [#42](https://github.com/MrF1ow/Arbor/issues/42). Spec: [`docs/superpowers/specs/2026-08-23-v3-closeout-design.md`](../../specs/2026-08-23-v3-closeout-design.md). Parent: [overview.md](overview.md).

## Global Constraints

- Package versions stay `2.1.0` until the tagged Wave 8 implementation commit (`pyproject.toml`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `arbor_worker.__version__`).
- Do not publish `3.1.0`. Do not backfill `v2.2.0` through `v2.8.0`.
- Chat, Anki, pretty canvas, extra providers, and due-date SRS stay out.
- Progress files stay gitignored under `.arbor/progress/`.
- Flip and Next do not increment flashcard `seen` after this wave. Again / Wrong / Mastered do.
- Each quiz question id is scored at most once per open session.

---

### Task 1: Flashcard grade domain

**Files:**
- Modify: `desktop/src/flashcards.ts`
- Test: `desktop/tests/flashcards.test.mjs`

**Interfaces:**
- Consumes: `FlashcardProgress`, `FlashcardReview`, `incrementSeen` (today increments `seen` only)
- Produces: `gradeFlashcard(progress, id, grade)` where `grade` is `"again" | "wrong" | "mastered"`. Returns a new progress map. `advanceAfterGrade(review)` returns the next card face down.

- [ ] **Step 1: Write the failing test**

Add to `desktop/tests/flashcards.test.mjs`:

```javascript
test("grades again, wrong, and mastered without mutating prior progress", async () => {
  const { gradeFlashcard, parseFlashcardProgress } = await subject();
  const prior = {
    fc_11111111: { seen: 2, correct: 1, wrong: 1 },
  };

  const again = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "again");
  assert.deepEqual(again.fc_11111111, { seen: 3, correct: 1, wrong: 1 });

  const wrong = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "wrong");
  assert.deepEqual(wrong.fc_11111111, { seen: 3, correct: 1, wrong: 2 });

  const mastered = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "mastered");
  assert.deepEqual(mastered.fc_11111111, { seen: 3, correct: 2, wrong: 1 });

  assert.deepEqual(prior.fc_11111111, { seen: 2, correct: 1, wrong: 1 });
  assert.deepEqual(gradeFlashcard({}, "fc_new", "again").fc_new, {
    seen: 1,
    correct: 0,
    wrong: 0,
  });
});

test("advance after grade moves to the next card face down", async () => {
  const { createReview, flipReview, advanceAfterGrade } = await subject();
  const flipped = flipReview(createReview(deck));
  const next = advanceAfterGrade(flipped);
  assert.equal(next.index, 1);
  assert.equal(next.flipped, false);
});
```

Keep the existing `incrementSeen` test. Callers will stop using `incrementSeen` from the UI. Leave the helper in the module so old tests still pass.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/flashcards.test.mjs`

Expected: FAIL with `gradeFlashcard is not a function` (or equivalent named export missing).

- [ ] **Step 3: Write minimal implementation**

In `desktop/src/flashcards.ts`:

```typescript
export type FlashcardGrade = "again" | "wrong" | "mastered";

export function gradeFlashcard(
  progress: FlashcardProgress,
  id: string,
  grade: FlashcardGrade,
): FlashcardProgress {
  const current = progress[id] ?? { seen: 0, correct: 0, wrong: 0 };
  return {
    ...progress,
    [id]: {
      seen: current.seen + 1,
      correct: current.correct + (grade === "mastered" ? 1 : 0),
      wrong: current.wrong + (grade === "wrong" ? 1 : 0),
    },
  };
}

export function advanceAfterGrade(review: FlashcardReview): FlashcardReview {
  return nextReview(review);
}
```

`nextReview` already sets `flipped: false`. Reuse it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npm test -- tests/flashcards.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/flashcards.ts desktop/tests/flashcards.test.mjs
git commit -m "feat(study): add flashcard again/wrong/mastered grades"
```

---

### Task 2: Flashcard grade UI

**Files:**
- Modify: `desktop/index.html` (deck controls)
- Modify: `desktop/src/main.ts` (grade click handlers, stop incrementing seen on flip/next)
- Modify: `desktop/src/styles.css` only if the new buttons need the same class as existing controls
- Test: `desktop/tests/flashcards-ui.test.mjs`

**Interfaces:**
- Consumes: `gradeFlashcard`, `advanceAfterGrade` from Task 1
- Produces: buttons `#flashcard-again`, `#flashcard-wrong`, `#flashcard-mastered`. Hidden until the card is flipped. Flip / Previous / Next / Shuffle do not call `incrementSeen`.

- [ ] **Step 1: Write the failing test**

In `desktop/tests/flashcards-ui.test.mjs`, add the three ids to the existing `for` list:

```javascript
    "flashcard-again",
    "flashcard-wrong",
    "flashcard-mastered",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/flashcards-ui.test.mjs`

Expected: FAIL with `missing #flashcard-again`

- [ ] **Step 3: Write minimal implementation**

In `desktop/index.html`, inside `.flashcard-controls` after Flip, add:

```html
                    <button type="button" class="btn-secondary" id="flashcard-again" hidden>Again</button>
                    <button type="button" class="btn-secondary" id="flashcard-wrong" hidden>Wrong</button>
                    <button type="button" class="btn-primary" id="flashcard-mastered" hidden>Mastered</button>
```

In `desktop/src/main.ts`:

- Import `gradeFlashcard` and `advanceAfterGrade`.
- Query the three buttons next to the other flashcard controls.
- In `renderCurrentFlashcard`, set `hidden = !flashcardReview.flipped` on the three grade buttons.
- Replace `markCurrentFlashcardSeen` usage on flip/next. Delete the `markCurrentFlashcardSeen` calls from the Flip and Next listeners. Keep Previous/Next as navigation only.
- Add one handler used by all three buttons:

```typescript
function gradeCurrentFlashcard(grade: "again" | "wrong" | "mastered") {
  if (!flashcardReview || !flashcardReview.flipped) return;
  flashcardProgress = gradeFlashcard(
    flashcardProgress,
    currentCard(flashcardReview).id,
    grade,
  );
  persistFlashcardProgress();
  flashcardReview = advanceAfterGrade(flashcardReview);
  renderCurrentFlashcard();
}
```

Wire `click` on each button to that function with the matching grade.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && npm test -- tests/flashcards-ui.test.mjs tests/flashcards.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/index.html desktop/src/main.ts desktop/tests/flashcards-ui.test.mjs
git commit -m "feat(desktop): grade flashcards with again, wrong, mastered"
```

---

### Task 3: Quiz session answers

**Files:**
- Modify: `desktop/src/types.ts` (`QuizReview` answers map)
- Modify: `desktop/src/quiz.ts`
- Test: `desktop/tests/quiz.test.mjs`

**Interfaces:**
- Consumes: current `submitChoice`, `nextReview`, `previousReview`
- Produces: `QuizReview.answers: Record<string, number>` mapping question id to the submitted choice index. `nextReview` / `previousReview` restore `selected` and `submitted` from `answers`. `submitChoice` does not change progress when `answers[id]` already exists.

- [ ] **Step 1: Write the failing test**

Read `desktop/tests/quiz.test.mjs` and add (keep the existing pack fixture already in that file; if the local names differ, use the same pack the file already builds):

```javascript
test("submit scores a question once per session even after next and previous", async () => {
  const {
    createReview,
    submitChoice,
    nextReview,
    previousReview,
    currentQuestion,
  } = await subject();
  const review = createReview(pack);
  const firstId = currentQuestion(review).id;

  const first = submitChoice(review, 1, {});
  assert.equal(first.progress[firstId].seen, 1);

  const moved = nextReview(first.review);
  const back = previousReview(moved);
  assert.equal(back.submitted, true);
  assert.equal(back.selected, 1);

  const again = submitChoice(back, 2, first.progress);
  assert.equal(again.review.selected, 1);
  assert.equal(again.progress[firstId].seen, 1);
  assert.equal(again.progress[firstId].wrong, first.progress[firstId].wrong);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/quiz.test.mjs`

Expected: FAIL because `previousReview` currently sets `submitted: false` and a second `submitChoice` increments `seen`.

- [ ] **Step 3: Write minimal implementation**

In `desktop/src/types.ts`, add `answers: Record<string, number>` to both `QuizReview` union members.

In `desktop/src/quiz.ts`:

```typescript
export function createReview(pack: QuizPack): QuizReview {
  return {
    questions: [...pack.questions],
    index: 0,
    selected: null,
    submitted: false,
    answers: {},
  };
}

function reviewAtIndex(review: QuizReview, index: number): QuizReview {
  const question = review.questions[index];
  const selected = review.answers[question.id];
  if (selected === undefined) {
    return {
      questions: review.questions,
      index,
      selected: null,
      submitted: false,
      answers: review.answers,
    };
  }
  return {
    questions: review.questions,
    index,
    selected,
    submitted: true,
    answers: review.answers,
  };
}

export function nextReview(review: QuizReview): QuizReview {
  return reviewAtIndex(
    review,
    (review.index + 1) % review.questions.length,
  );
}

export function previousReview(review: QuizReview): QuizReview {
  return reviewAtIndex(
    review,
    (review.index - 1 + review.questions.length) % review.questions.length,
  );
}

export function submitChoice(
  review: QuizReview,
  choiceIndex: number,
  progress: QuizProgress,
): { review: QuizReview; progress: QuizProgress } {
  const question = currentQuestion(review);
  if (review.answers[question.id] !== undefined) {
    return { review: reviewAtIndex(review, review.index), progress };
  }
  const current = progress[question.id] ?? { seen: 0, correct: 0, wrong: 0 };
  const correct = choiceIndex === question.answer_index;
  const answers = { ...review.answers, [question.id]: choiceIndex };
  return {
    review: {
      questions: review.questions,
      index: review.index,
      selected: choiceIndex,
      submitted: true,
      answers,
    },
    progress: {
      ...progress,
      [question.id]: {
        seen: current.seen + 1,
        correct: current.correct + (correct ? 1 : 0),
        wrong: current.wrong + (correct ? 0 : 1),
      },
    },
  };
}
```

Keep `selectChoice` refusing changes when `review.submitted` is true.

Fix any other `createReview` assertions in `quiz.test.mjs` that compare the whole review object and now miss `answers`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npm test -- tests/quiz.test.mjs`

Expected: PASS (full quiz file)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types.ts desktop/src/quiz.ts desktop/tests/quiz.test.mjs
git commit -m "fix(study): score each quiz question once per session"
```

---

### Task 4: Heading ids and source-chip scroll

**Files:**
- Create: `desktop/tests/markdown.test.mjs`
- Modify: `desktop/src/markdown.ts`
- Modify: `desktop/src/main.ts` (`setCourseView` / `loadDigestPreview` accept an optional heading and scroll)

**Interfaces:**
- Consumes: `renderMarkdown(source)` which today returns `{ html, pageChip }`
- Produces: `headingId(text: string): string`. `h2`/`h3` tags include `id="{slug}"`. `setCourseView(course, "notes", path, heading?)` scrolls `#preview [id=slug]` after render.

- [ ] **Step 1: Write the failing test**

Create `desktop/tests/markdown.test.mjs`:

```javascript
import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return await import("../src/markdown.ts");
}

test("headingId slugs and renderMarkdown stamps h2 ids", async () => {
  const { headingId, renderMarkdown } = await subject();

  assert.equal(headingId("Glycolysis"), "glycolysis");
  assert.equal(headingId("Net ATP (per glucose)"), "net-atp-per-glucose");
  assert.equal(headingId("A  -- B"), "a-b");

  const { html } = renderMarkdown("## Glycolysis\n\nCytoplasm.\n");
  assert.match(html, /<h2 id="glycolysis">Glycolysis<\/h2>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: FAIL with `headingId is not a function`

- [ ] **Step 3: Write minimal implementation**

In `desktop/src/markdown.ts`:

```typescript
export function headingId(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

Change the `h2` / `h3` pushes to:

```typescript
      const title = trimmed.slice(3);
      parts.push(`<h2 id="${headingId(title)}">${inlineFormat(title)}</h2>`);
```

For `h3` use `trimmed.slice(4)` the same way.

In `desktop/src/main.ts`, `setCourseView` is `(course, mode, notesPath?)`. Add a fourth argument `heading?: string | null`. Pass it through `loadCourseContent` into `loadDigestPreview`. After `previewEl.innerHTML` is set, if `heading` is non-empty, run `previewEl.querySelector(`[id="${CSS.escape(headingId(heading))}"]`)?.scrollIntoView({ block: "start" })`.

Flashcard, quiz, and graph source-chip clicks already call `setCourseView` with a path. Add `source.heading`. Missing heading keeps today's top-of-file behavior.

The existing `quiz.test.mjs` case `nextReview(submitted).submitted === false` stays true (that is question 2, unanswered). `previousReview(nextReview(submitted))` must restore question 1 as submitted. Update that file's last assertions if they still assume Previous after Next is a blank question 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && npm test -- tests/markdown.test.mjs && npm test`

Expected: PASS (markdown file, then full desktop suite)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/markdown.ts desktop/src/main.ts desktop/tests/markdown.test.mjs
git commit -m "feat(desktop): scroll source chips to digest headings"
```

---

### Task 5: Living docs

**Files:**
- Modify: `README.md` (remove Coming soon; list study modes, semantic search, Graph, citations)
- Modify: `desktop/README.md` item 13 (Generate enabled, grade buttons, Graph tab)
- Modify: `PROJECT.md` Version 3 shipped vs remaining
- Modify: `CHANGELOG.md` Unreleased (Wave 8 bullets). Do not rewrite the frozen 2.1.0 section except the one line that still says later releases will add flashcards if you find it under Unreleased, not under 2.1.0.
- Modify: `docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md` presentation table: grade buttons and heading scroll are required, not "later"

**Interfaces:**
- Consumes: Wave 8 spec copy
- Produces: docs that a classmate can read without being told the app is still Coming soon

- [ ] **Step 1: Edit README What's in 2.1.0 vs Unreleased**

Keep the 2.1.0 table as the tagged shell. After it, add a short **On `main` (unreleased)** section: flashcards, quiz, semantic search, Graph, figures, citation badges. State that grade buttons and heading scroll are Wave 8. Delete the sentence "Flashcards and Quiz tabs are placeholders (Coming soon)."

- [ ] **Step 2: Edit desktop README checklist item 13**

Replace "empty state with a disabled Generate button" with: empty Generate when no deck; Flip then Again / Wrong / Mastered when a deck exists; Quiz Submit; Graph tab.

- [ ] **Step 3: Edit PROJECT.md Version 3**

Move the Wave 1–7 feature names into a **Shipped on `main` (package still 2.1.0)** list. **Required for `v3.0.0` remaining** is only Wave 8 plus recorded Mac E2E. Link the closeout spec and issue #42.

- [ ] **Step 4: Edit the study artifacts format spec**

Replace "and heading if we add anchor IDs later" with: source chips open Notes and scroll to the heading id. Flashcard presentation includes Again / Wrong / Mastered after Flip.

- [ ] **Step 5: Commit**

```bash
git add README.md desktop/README.md PROJECT.md CHANGELOG.md \
  docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md
git commit -m "docs: match Version 3 living docs to closeout remainder"
```

---

### Task 6: Mac E2E study-loop checklist

**Files:**
- Modify: `docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md`

**Interfaces:**
- Consumes: existing ingest checklist
- Produces: additional unchecked items for Wave 8. Do not check them from this Linux environment.

- [ ] **Step 1: Append study-loop checks**

Add a section **Study loop (Wave 8)** with these boxes, after the ingest list:

- [ ] Flashcards Generate on a course with a digest (fake provider if no Codex model, Codex if a model is selected)
- [ ] Flip, then Again / Wrong / Mastered. Next card is face down. Progress file updates under `.arbor/progress/`
- [ ] Quiz Generate, Submit, Previous, Submit again. Score for that question does not increase
- [ ] Source chip on a card with a heading opens Notes scrolled to that heading
- [ ] Search overlay Semantic toggle returns a hit and opens Notes
- [ ] Graph Generate, click a source chip, Notes opens
- [ ] Check citations. An invented card back shows Unverified. Honest cards do not

Keep the record-date / macOS / commit instruction.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md
git commit -m "docs: extend Mac E2E checklist for the study loop"
```

---

### Task 7: Package bump only on the tagged implementation

**Files:**
- Modify: `python/pyproject.toml`, `python/src/arbor_worker/__init__.py`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `CHANGELOG.md`

Do this in the last implementation PR, not in a docs-only PR.

- [ ] **Step 1: Set every package version to `2.2.0`**

Same four files as the versioning rule. CHANGELOG: move Unreleased waves 1–8 under `## 2.2.0`. Git tag `v2.2.0` is a human release step after merge.

- [ ] **Step 2: Run the verification suite**

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test
cd desktop && npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add python/pyproject.toml python/src/arbor_worker/__init__.py \
  desktop/package.json desktop/src-tauri/Cargo.toml CHANGELOG.md
git commit -m "chore: package Arbor 2.2.0"
```

Do not tag `v3.0.0` in this task. That tag waits for the Mac E2E record in `mac-e2e.md`.
