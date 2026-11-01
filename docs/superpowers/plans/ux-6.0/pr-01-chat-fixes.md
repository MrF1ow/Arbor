# PR 1: Chat fixes

Branch `ux/01-chat-fixes`, stacked on `ux/00-plan` (based on `origin/main` at v0.5.19). See `README.md` in this folder for the overall UX pass. **The agent rules in `../ui-6.0/README.md` apply in full.** Two of them matter most here: no browser, and never launch the app window.

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack` (desktop app in `desktop/`, worker in `python/`).

Baseline on 2026-10-22, before any change:
- `npm test` in `desktop/`: EXIT=0, vitest 54 files and 446 tests passed
- `uv run pytest -q` in `python/`: all passed

## Out of scope: don't touch these

- **The Quiz feature:** the Quiz tab, `src/components/quiz/`, `src/domain/quiz.ts`, quiz jobs, quiz progress commands, and `python/src/arbor_worker/skills/quiz*`. The Quiz feature stays exactly as it is. This PR only removes *chat's* quiz mode.
- **The chat composer's "Generate study artifact" row** (Flashcards/Quiz select and button). Leave it alone.
- **The frozen legacy UI:** `desktop/legacy.html`, `desktop/src/legacy/**`, and the tests that read them (e.g. `tests/chat.test.mjs` "chat tab and panel ids exist…").

## 1. Remove chat quiz mode (chat only)

Remove it completely, with no back-compat for stored `quiz` chat lines. Old lines still render, because the transcript renders by role.

| Where | Change |
|---|---|
| `desktop/src/domain/chat.ts` | `ChatMode = "ask" \| "explain"`, and update `CHAT_MODES`. |
| `desktop/src/components/chat/chat-view.tsx` | Delete the Quiz `ToggleGroupItem`. A `?mode=quiz` search param must fall back to `ask`; `isChatMode` already does this once the type changes. |
| `desktop/src/components/chat/chat-transcript.tsx` | Empty-state copy becomes "Answers cite digests in this course. Use Explain mode for step-by-step replies." |
| `desktop/src-tauri/src/commands.rs` | `validate_chat_mode` accepts only `ask` and `explain`. Add a unit test that `quiz` is rejected. |
| `python/src/arbor_worker/chat.py` | Delete `_MODE_SENTENCES["quiz"]`. |
| `python/src/arbor_worker/commands.py` (~968) | The mode set becomes `{"ask", "explain"}`. |
| `python/tests/test_chat.py` (~289) | Replace the quiz system-prompt assertions with a test that `quiz` is rejected (by the command validation) or absent from `_MODE_SENTENCES`. |
| `desktop/src/routes/chat.test.tsx` (~356) | Rewrite "changes mode in start_chat payload from toggle": start at `?mode=explain`, click Ask, assert `mode: "ask"`. Add a test that `?mode=quiz` lands on Ask, and that no "Quiz mode" button exists in the chat view. |
| Mock handlers and other tests | Grep `src/` (not `legacy/`) for chat quiz-mode assumptions and update them. |

## 2. Numbered lists render as "1. 1. 1."

`desktop/src/domain/markdown.ts`, used by both chat and notes:
- **Bug 1:** a blank line calls `closeAllLists` (the two blank-line branches near line 222–235). In a *loose* list (items separated by blank lines, which LLM "explain" answers usually are), every item opens a new `<ol>`, so each one shows as 1.
- **Bug 2:** `matchListItem` drops the number (`/^\d+\. (.+)$/`).

Fix:
1. **Keep lists open across blank lines.** On a blank line, flush the paragraph but don't close the lists yet. Look ahead to the next non-blank line:
   - If it's a list item (`matchListItem`) and the stack is non-empty, keep the stack open and let the normal list-item path handle that line, nesting by indent as today.
   - If it's an indented continuation (indent > the top list's indent, not a list item), keep the list open and append that text as a paragraph inside the current `<li>`. If that's too invasive, closing is acceptable, but list it in the report.
   - Otherwise close all lists, as today.

   Page markers (`<!-- arbor:pages … -->`) and headings still close lists exactly as before.
2. **Keep the start number.** Store the first item's number on `OpenList` (a `start` field). When it isn't 1, render `<ol start="N">`. `pageAttr()` output stays where it is today.
3. **Ordered and unordered siblings:** if the next item at the *same* indent is a different kind, close the current list and open the new kind (existing behaviour; keep it).

Tests (`src/domain/markdown.test.ts`, or wherever the renderer tests live):
- `"1. a\n\n2. b\n\n3. c"` → exactly one `<ol>` with 3 `<li>`.
- `"3. c\n4. d"` → `<ol start="3">`.
- `"- a\n\n- b"` → one `<ul>`.
- A loose ordered list with nested bullets under item 1 → one outer `<ol>`, with nested `<ul>` inside the first `<li>`.
- A list, a blank line, then a paragraph → the list closes and a `<p>` follows.
- The existing page-marker and notes tests stay green, unchanged.

## 3. Selection colour

`desktop/src/index.css`:
- Add a `--selection` token in **both** the light block and the dark block: `color-mix(in oklab, var(--primary) 30%, transparent)`. Expose it as `--color-selection` in the `@theme` mapping, matching how the other tokens are exposed.
- `::selection { background: var(--selection); color: inherit; }`.

The token must stay distinct from `--muted` (user bubbles) and `--accent`. Raw colours are only allowed in `index.css`; `npm run check:styles` must pass.

Needs visual check (Claude): selection is clearly visible on the transcript prose, user bubbles and notes, in light and dark.

## 4. Don't fight the reader while an answer arrives

`chat-view.tsx`: today the `useLayoutEffect` on `[lines, liveSnapshot.text.length]` jumps to the bottom whenever `stickToBottomRef` is true.
- **While selecting:** skip the jump when `window.getSelection()` is non-collapsed and its `anchorNode` is inside `scrollRef.current`.
- **After send:** set `stickToBottomRef.current = true` in `sendMessage` right after the user line is appended, so your own message always scrolls into view.
- **Unchanged:** the existing near-bottom threshold logic in `onTranscriptScroll`.
- **Test (vitest):** with a selection inside the transcript, a new live delta doesn't change `scrollTop`. Mock `getSelection` if happy-dom can't select.

## 5. Checks before you report

Run each command from its directory and paste the tail of the output with `EXIT=$?`:
- `cd desktop && npm test; echo EXIT=$?`
- `cd desktop && npm run lint; echo EXIT=$?`
- `cd desktop && npm run build; echo EXIT=$?`. This runs tsc; the source-text tests do NOT catch type errors.
- `cd desktop/src-tauri && cargo test chat; echo EXIT=$?`
- `cd python && uv run pytest -q; echo EXIT=$?`

Wrap each suite in `timeout 600`. Afterwards, make sure no orphan `node --test` / vitest processes remain (`pgrep -x node -a`, then look before killing anything; never kill a process group that could include your own shell).

Commit on `ux/01-chat-fixes` in logical commits.

---

## Execution plan (who does what)

| Step | Agent | Task | Exit |
|---|---|---|---|
| 1 | **Composer 2.5** (cursor) | Implement §1–§4 from this brief; run §5; commit locally. | A report with files, commands and `EXIT` lines, plus "needs visual check" items. |
| 2 | **Claude** | Spot-check: rerun the suites myself, `git diff` skim. | Green, or send it back to Composer. |
| 3 | **Grok 4.7** (grok) | QA, review only: read the brief and the diff `ux/00-plan..ux/01-chat-fixes`; rerun the suites; hunt for regressions (notes rendering, page markers, mode params from "Explain weakest topic", anything quiz-related outside chat accidentally touched). No edits. | A findings list with severity and file:line. |
| 4 | **Composer 2.5** | One fix round on Grok's findings (Claude filters out non-issues first). | Report with `EXIT` lines. |
| 5 | **Claude** | Audit: rerun everything; headless T3 preview on `npm run dev:mock` (never the real display) to check list numbering in chat and notes, selection contrast in light and dark, no Quiz mode in chat, the Quiz tab still works, and auto-scroll while selecting. | Push `ux/00-plan` and `ux/01-chat-fixes`, open the stacked PRs, `link_pull_request`. Never merge. |

A T3 watchdog runs every 15 minutes while delegates are active and is deleted when the PR opens. Known Grok habit: it finishes its report but doesn't close the run. Read the child thread and `task_cancel` it.
