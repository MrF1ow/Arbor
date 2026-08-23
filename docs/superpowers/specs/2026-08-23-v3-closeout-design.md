# Version 3 closeout (issue #42)

Date: 2026-08-23

Status: design. Required before `v3.0.0`. Program: [`../plans/2026-08-22-v3-program/overview.md`](../plans/2026-08-22-v3-program/overview.md). Plan: [`../plans/2026-08-22-v3-program/wave-8-closeout.md`](../plans/2026-08-22-v3-program/wave-8-closeout.md).

Tracking issue: [#42](https://github.com/MrF1ow/Arbor/issues/42)

## How this spec was written

Waves 1 through 7 are on `main` (PRs #36 through #41). Package version is still `2.1.0`. The Cursor GitHub App can read pull requests and cannot read issue bodies, so the text of #42 was not available to the planning agent. The remainder below is the Version 3 work that living specs already require and that those PRs left unfinished. If #42 names extra items, add them as Wave 8 PRs. Do not use that as a door to chat, Anki, a pretty canvas, or extra AI providers.

## Problem

A student can generate flashcards, take a quiz, search by meaning, and walk a concept graph. The study loop is still incomplete, the docs still describe the 2.1.0 shell, and `v3.0.0` would be a lie if tagged today.

The flashcard format spec already stores `correct` and `wrong`. The deck only increments `seen` on flip. Quiz Submit scores, then Previous/Next clears `submitted`, so answering the same question again counts twice. Source chips open the digest file and ignore the heading. README and PROJECT.md still say Flashcards and Quiz are Coming soon.

That is not a downloadable study app. It is a feature dump with yesterday's storefront copy.

## Approaches

**A. One closeout wave, then tag.** Finish the study loop, heading scroll, living docs, and the Mac checklist as Wave 8. One package `2.2.0` covers waves 1 through 8. `v3.0.0` waits until that wave and the Mac run are done. Do not backfill `v2.2.0` through `v2.8.0` for PRs that already merged untagged.

**B. Tag `v3.0.0` now.** PROJECT.md's required feature names all have worker and UI code. Rejected. The milestone text is "a study app a student would download." Grade buttons, honest docs, and a recorded Mac run are part of that, not polish after the tag.

**C. Split docs, grading, and E2E into separate program waves.** Too much ceremony for leftover work that shares one desktop surface.

**Chosen: A.**

## What Wave 8 is

### 1. Flashcard grade

After Flip, the card shows three actions: **Again**, **Wrong**, **Mastered**.

| Button | Progress | Then |
|--------|----------|------|
| Again | `seen += 1` | Next card, face down |
| Wrong | `seen += 1`, `wrong += 1` | Next card, face down |
| Mastered | `seen += 1`, `correct += 1` | Next card, face down |

Do not increment `seen` on Flip or Next anymore. Previous/Next still move. They do not grade. Shuffle keeps the same progress map.

Copy matches the format spec: again, wrong, mastered. The JSON fields stay `seen`, `correct`, `wrong`. No due dates. Review scheduling is Version 4.

### 2. Quiz session answers

`QuizReview` remembers the submitted choice per question id for this session. Previous/Next restore that choice and the explanation. Submit on an already scored question is a no-op. Progress counts each id at most once per session.

The on-disk progress file still accumulates across sessions. Opening the course again is a new session.

### 3. Heading scroll

`renderMarkdown` gives `h2` and `h3` an `id` from the normalized heading (lowercase, non-alphanumerics to `-`, collapse repeats). Source chips pass the heading into Notes. After the digest HTML is in the pane, scroll that element into view. Missing heading opens the digest at the top. Same behavior for flashcards, quiz, and graph source chips.

### 4. Living docs

README, `desktop/README.md`, PROJECT.md Version 3, CHANGELOG 2.1.0 notes that still say Coming soon, and the program overview must match `main`. Waves 1 through 7 are shipped code. They are not "no worker code yet."

### 5. Mac E2E

Extend [`mac-e2e.md`](../plans/2026-08-22-v3-program/mac-e2e.md) with Generate / Flip / grade / quiz Submit / semantic search / Graph chip / Check citations. The ingest checks stay. A human records date, macOS version, and commit on a Mac. This Linux agent cannot run that checklist.

## Versioning

Do not publish `3.1.0`. Do not invent seven historical tags for PRs #36 through #41.

| Tag | When |
|-----|------|
| `v2.1.0` | Shell. Already tagged. |
| `v2.2.0` | Waves 1 through 8 on `main` |
| `v3.0.0` | After `v2.2.0` and a recorded Mac E2E run |

Package versions stay `2.1.0` until the Wave 8 implementation PR that is meant to be tagged. This design PR does not bump them.

## Out of Version 3

Unchanged.

- Chat / tutor (Version 4)
- Multiple AI providers
- Scheduler
- Cloud sync
- Anki export
- Force-directed graph canvas
- Remote vector DBs
- Web citation lookup
- Make-card-from-selection (shell spec called this a later refinement)

If #42 lists one of those, it is a Version 4 (or later) issue, not a Wave 8 task.

## Success

A student grades a Biology deck, retakes a quiz question without inflating scores, clicks a heading chip and lands on that section, and the GitHub README describes the app they downloaded. After a Mac run is recorded, tag `v3.0.0`.
