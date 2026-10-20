# PR 11: Chat

Branch `ui/11-chat`, stacked on `ui/10-graph`. Master plan §6 and §8 (streaming re-renders only the live bubble), §11 row 11, Appendix B item 7. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the mockup has no chat view. Build it from the existing language:
  - the reading column (`--reading-max`) for the transcript
  - user turns as compact right-aligned bubbles (muted surface)
  - assistant turns as `.prose-arbor` text (no bubble, like a document reply), with citation chips below
  - a composer docked at the bottom of the main column (a `Textarea` plus a primary Send), with a toolbar row above the transcript
- **Legacy reference:** `desktop/src/legacy/main.ts`, plus the markup in `desktop/legacy.html` (~238–275):

  | Legacy code | Line |
  |---|---|
  | `refreshChatCourseOptions` | ~661 |
  | `setChatModeButtons` | ~677 |
  | `refreshChatControls` | ~686 |
  | `renderChatTranscript` | ~694 |
  | `loadChat` | ~740 |
  | `appendChatLines` | ~759 |
  | `chatAuthErrorMessage` | ~770 |
  | `sendChatMessage` | ~778 |
  | `clearChatTranscriptForRootSwitch` | ~1114 |
  | the handlers | ~3775–3800, ~3930–3952 |
- **Pure logic:** `src/domain/chat.ts`: `visibleTranscript`, `workerHistory`, `chatNotePath`, `citationLabel`, `renderAnswerHtml`, `phaseLabel`, `unsupportedBanner`, `buildUserLine`, `buildAssistantLine`, `buildSessionLine`. **Reuse it.**
- **Query hooks** already exist in `src/lib/queries/chat.ts`.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Route (`course.$course.chat.tsx` → `components/chat/chat-view.tsx`)
- **Keep the `mode` and `prompt` search params** (PR 7 "Explain weakest topic" sends `mode=explain&prompt=…`).
  - On arrival with a `prompt`: set the mode (if it's valid), put the prompt in the composer, and **auto-send once**, as legacy `explainWeakestBtn` did.
  - Then clear both params with a `replace` navigate, so a reload doesn't resend.
  - Guard against double-send in StrictMode with a ref keyed by the prompt.
- **Transcript:** `useChatHistory(root, course)` → `visibleTranscript(lines)`. Keep a local `lines` state that's appended optimistically, as legacy did (`appendChatLines` pushes locally). Re-sync from the query when the course changes.

## 2. Layout
- **Toolbar row:**
  - **course** `Select` (the active root's courses, display names; changing it navigates to that course's chat)
  - **root label** (faint: `workspaceRootLabel`)
  - **mode** `ToggleGroup` / segmented: Ask / Explain / Quiz (`aria-pressed`)
  - **New chat** (appends `buildSessionLine()`, which hides the earlier turns per `visibleTranscript`)
  - **Clear history** (a confirm `AlertDialog`: title "Clear history", body `Delete all chat history for {course}? This cannot be undone.`, a destructive confirm) → `clear_chat_history`
  - All of these are disabled while a request is in flight (legacy `refreshChatControls`).
- **Transcript:** its own scroller, auto-scrolled to the bottom on new content only when the user is already near the bottom (as in the PR 5 log drawer).
  - **User turns:** plain text bubbles.
  - **Assistant turns:**
    - `renderAnswerHtml(content)` in `.prose-arbor`
    - the `unsupportedBanner(supported)` callout (`Info` icon, muted) when present
    - citation `Chip`s with `citationLabel(c)` → `/course/$course/notes/$digest` with `heading` (use `chatNotePath`, `resolveDigestSlug`; a `course.md` path → the Overview)
  - **Empty transcript:** an `EmptyState` with "Ask about {course}" and a line about citations.
- **Live bubble:** while streaming, one assistant bubble shows the accumulated `chat_delta` text as plain text, with a subtle caret or pulse. **Only this component re-renders per delta**: keep the delta text in a small store or a `useSyncExternalStore` / ref + state inside `LiveAnswer`, not in the parent's transcript state (§8).
- **Status line** above the composer, using the legacy phase words:
  - "Retrieving" → "Answering" (`chat_retrieved`) → "Done"
  - errors in destructive text
  - `phaseLabel` where applicable
- **Composer:**
  - a `Textarea` (placeholder "Ask about this course…", auto-grows to about 6 lines) and **Send** (primary)
  - Enter sends; Shift+Enter inserts a newline
  - Send is disabled while in flight or when the input is empty
- **Artifact row** (legacy "Generate study artifact"): a small `Select` (Flashcards / Quiz) plus **Generate study artifact**. Use the PR 10 `useStudyJobLauncher` (flashcards → the flashcard job, quiz → the quiz job, force false) with the same gates.

## 3. Send flow (port `sendChatMessage` exactly)
1. Trim the question; return if it's empty.
2. Run the auth gate (`fetchAuthStatus(provider, true)`). When signed out, the status shows `signedOutJobMessage(label, reason)` and nothing is sent.
3. With no model: status "Select a model in Settings.".
4. Status "Retrieving", in-flight on.
5. `append_chat_lines` with the `buildUserLine(mode, question)` line, appended locally and rendered; clear the input.
6. Create a `Channel` (`@tauri-apps/api/core`) and handle the events:
   - `chat_retrieved` → "Answering"
   - `chat_delta` → append to the live bubble (only if still on the same course)
   - `chat_done` → drop the live bubble; `buildAssistantLine(mode, markdown, supported === true, citations)` → `append_chat_lines` (kept as `pendingAppend`); render; status "Done"
   - `auth_failed` → `signedOutJobMessage(label, reason)`
   - `error` → the message, or "Chat failed."
   - `worker_exit` → await `pendingAppend` (on failure: log `Could not append chat lines: {error}` to the job log, and the status shows `chatAuthErrorMessage(error)`), then in-flight off and drop the live bubble
7. `invoke("start_chat", { onEvent: channel, root, course, question, mode, provider, model, history: workerHistory(lines) })` via `useStartChatMutation`. If it throws: in-flight off, status = `chatAuthErrorMessage(error)`.

**Course switch while streaming:** events for the old course don't touch the new course's view (legacy `currentCourse === course` checks). Key the view by root and course, and keep the in-flight request's closure scoped to its course.

**Root switch:** clear the transcript (legacy `clearChatTranscriptForRootSwitch`); keying by root covers this.

The log never opens programmatically.

## 4. Mock streaming for tests and dev:mock
Add a `start_chat` handler to `src/test/mock-handlers.ts` that streams through the passed channel:
- `chat_retrieved`
- 3 `chat_delta` chunks
- `chat_done` with markdown, `supported: true`, and 1 citation pointing at a fixture digest with a heading
- `worker_exit`

Space them with short timers, and clear them on teardown (the PR 7 timer lesson). `mockIPC` receives the channel serialized; deliver messages via the channel id with Tauri's mock internals. Check `@tauri-apps/api/mocks` and `core.ts` `Channel` for how `onmessage` is dispatched (`transformCallback` / `__TAURI_INTERNALS__.runCallback`), and write a small helper `emitToChannel(channel, message)`. Unit-test the helper.

## 5. Tests (vitest)
- **History renders:** `visibleTranscript` respects session lines; user and assistant turns are distinguishable; citations navigate to the Notes digest with `heading`.
- **Send:**
  - the exact `start_chat` payload (mode, question, provider, model, history = `workerHistory`)
  - `append_chat_lines` is called with the user line, then the assistant line
  - the live bubble shows the streamed text, then is replaced by the final markdown
  - the status goes Retrieving → Answering → Done
  - the controls are disabled in flight and re-enabled after `worker_exit`
- **Enter vs Shift+Enter.**
- **Gates:** signed out → the status copy and no `start_chat`; no model → the copy.
- **Errors:** the `auth_failed` and `error` events show their copy; a `start_chat` rejection shows `chatAuthErrorMessage`.
- **Course switch mid-stream:** the deltas don't leak into the other course.
- **New chat** hides earlier turns. **Clear history:** confirm → `clear_chat_history`; cancel → no call.
- **Explain weakest end-to-end:** from the PR 7 Overview button → the chat auto-sends the exact prompt once in explain mode, and the params are cleared.
- **Mode toggle** changes `mode` in the payload.
- **Artifact row:** Generate study artifact → the flashcards or quiz job args, gated.
- **Perf guard:** the parent transcript doesn't re-render per delta (count renders with a test-only render counter or `React.Profiler`).
- Port any UI assertions from `tests/chat.test.mjs` that are about the DOM. Keep its pure-domain tests (they test `domain/chat.ts`).

## 6. Acceptance (run all, report real results)
- `npm test` (exit 0), `npm run lint`, `npm run build` (entry ≤ 250 KB; chat is code-split).
- **Needs visual check (Claude):**
  - chat at 700/1100/1600, light and dark
  - the transcript with citations and the unsupported banner
  - streaming (live bubble)
  - the composer
  - the clear-history dialog
  - the empty state

## Commit
Focused commits on `ui/11-chat`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.
