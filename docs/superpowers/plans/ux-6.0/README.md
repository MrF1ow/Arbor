# 0.6 UX pass (before the v0.6.0 tag)

This plan comes from the MacBook E2E feedback on v0.5.19. The goal is working UX; visual polish comes in a later round. Ship it as a stacked PR series in `.worktrees/ux-stack`, one branch per PR (`ux/NN-name`), each based on the one before. The workflow is the same as `ui-6.0/`: Claude plans, Composer 2.5 implements, Grok 4.7 does QA, Composer makes one fix round, then Claude audits, including a headless browser check on `npm run dev:mock`. Delegates never open a browser and never touch the real display.

T3 Code references are pinned to `pingdotgg/t3code@b9aaff46`.

## Decisions (2026-10-22)

| # | Decision |
|---|---|
| D1 | Dictation uses macOS's own dictation. A mic button starts it. It's hidden on Linux and Windows. Offline Whisper may come later. |
| D2 | Provider usage follows T3 Code: each provider reports its own usage windows (see PR 7). |
| D3 | The calendar (exam dates linked to lectures, which drive study plans) goes on the roadmap after v6. |
| — | Remove only the chat's Quiz *mode* (the Ask/Explain/Quiz switch). The Quiz tab, quiz generation, quiz jobs and quiz progress all stay unchanged. Old `quiz` chat lines get no special handling. |

## PR map

| PR | Branch | Covers |
|---|---|---|
| 1 | `ux/01-chat-fixes` | Remove chat quiz mode; fix list numbering; selection colour; auto-scroll |
| 2 | `ux/02-streaming` | Real token streaming from the providers |
| 3 | `ux/03-threads` | Stored chat threads |
| 4 | `ux/04-composer` | Ask/Explain switch in the composer, slash commands, mic button |
| 5 | `ux/05-study-resume` | Flashcards and quiz resume where you left off, plus Restart |
| 6 | `ux/06-course-icons` | Icon picker for courses |
| 7 | `ux/07-provider-usage` | Click a provider in the sidebar to see the usage you have left |
| — | — | Tag v0.6.0 after a Linux live run. Dictation needs a manual Mac check. |

---

## PR 1: Chat fixes

- **Remove the chat's quiz mode (chat only).** Don't touch the Quiz tab, `components/quiz/`, `domain/quiz.ts`, quiz jobs or `skills/quiz`.
  - `desktop/src/domain/chat.ts`: `ChatMode = "ask" | "explain"`, and update `CHAT_MODES`.
  - The Quiz `ToggleGroupItem` in `components/chat/chat-view.tsx`.
  - `validate_chat_mode` in `desktop/src-tauri/src/commands.rs`.
  - `_MODE_SENTENCES["quiz"]` in `python/src/arbor_worker/chat.py`.
  - The empty-state copy in `chat-transcript.tsx` ("Use Explain or Quiz modes…").
  - Tests and mock handlers.
  - The "Generate study artifact" row stays. It starts jobs; it isn't chat quiz.
- **Numbered lists** (`desktop/src/domain/markdown.ts`):
  - A blank line currently calls `closeAllLists`, so every item of a loose list opens a new `<ol>` that starts at 1. Instead, defer the close: on a blank line, look ahead to the next non-blank line. If it's a list item at an indent the open stack can take, keep the list open.
  - Keep the first number of an ordered list and write `<ol start="n">` when n ≠ 1.
  - Tests: a loose `1. / 2. / 3.` list renders as one `<ol>` with three `<li>`; `3. 4.` renders as `start="3"`; nested bullets under a numbered item still work; notes page markers are unchanged.
- **Selection colour** (`desktop/src/index.css`):
  - Add a `--selection` token in light and dark: about 30% olive (`color-mix(in oklab, var(--primary) 30%, transparent)`).
  - Point `::selection` at it.
  - Make sure selection reads clearly on `bg-muted` user bubbles and on `.prose-arbor`.
- **Auto-scroll** (`chat-view.tsx`):
  - Stop following the bottom while the user has a non-collapsed selection inside the transcript, or has scrolled up.
  - Resume following when they scroll back to the bottom or send a message.

## PR 2: Streaming

Today the worker calls `provider.run()`, which returns the whole reply, and sends one `chat_done`. The UI already handles `chat_delta`, but nothing sends it.

- **Provider interface** (`python/src/arbor_worker/provider/base.py`):
  - Add an optional `stream(request, on_delta) -> ProviderResult`.
  - Add a helper `supports_stream(provider)`.
  - Providers without it fall back to `run()`.
- **Per provider:**

  | Provider | How it streams |
  |---|---|
  | Claude CLI | `--output-format stream-json --include-partial-messages --verbose`; read `stream_event` text deltas. Keep the `result` message as the final text. |
  | Grok CLI | `--output-format streaming-messages-json --include-partial-messages`; read `stream_event` text deltas. |
  | Ollama, LM Studio, OpenAI-compatible, OpenAI API, Anthropic API | Server-sent streaming through `http_transport` |
  | Codex | Stays on `run()` (no token deltas). |
  | Fake | A scripted stream for tests |

  Use a line reader with `subprocess.Popen` and keep the current timeout and kill behaviour. Injected runners keep the unit tests hermetic.
- **Worker** (`chat.py`): call `stream` when it's available, and send `chat_delta` for each delta. Hold back a trailing partial line that could be the `supported: …` line, so it never reaches the UI.
- **UI:**
  - `LiveAnswer` renders the live text with `renderAnswerHtml`. Throttle re-renders to one per animation frame.
  - Citation markers render as plain `[n]` until `chat_done` arrives.
  - Only `LiveAnswer` re-renders per delta (master plan §8).
- **Live check:** Grok CLI with `grok-4.7`, on Xvfb only, per the memory rules.

## PR 3: Threads

Today each course has one file, `.arbor/users/<me>/chat/<course>.jsonl`. "New chat" only appends a `session` line, which hides the earlier turns.

T3 Code model: threads belong to a project, are listed newest first, take their title from the first message, keep a draft per thread, and can be renamed, archived and deleted.

- **Storage:**
  - Messages: `.arbor/users/<me>/chat/<course>/<thread-id>.jsonl`.
  - Index: `.arbor/users/<me>/chat/<course>/index.json`, an array of `{id, title, mode, created_at, updated_at}`.
  - The thread id is a time-sortable string such as `2026-10-22T…-<rand>`.
  - Writes are atomic. The Rust commands validate ids the same way they already validate course names.
  - Chat stays outside sync: it's already in the ignore list (`.arbor/users/*/chat/`).
- **Migration (Rust):** on the first read of a course whose old `<course>.jsonl` exists:
  - split it on `session` lines into threads, dropping empty segments;
  - title each thread from its first user line;
  - keep the old file as `.bak`, reusing `migrate_derived_file`.
- **Commands** (all scoped to root, course and thread):
  - `list_chat_threads`
  - `create_chat_thread`
  - `read_chat_thread`
  - `append_chat_lines`
  - `rename_chat_thread`
  - `delete_chat_thread`
  - `delete_all_chat_threads`

  `start_chat` is unchanged apart from taking a thread id for the history.
- **UI:**
  - A thread list panel on the left of the chat view, collapsible like the notes index. It has search, "New chat", and rename/delete in a row menu.
  - The route gains a `thread` search param.
  - The live store is keyed by `root\0course\0thread`, so an answer keeps streaming into its own thread while you browse others.
  - Each thread's draft is kept in a persisted Zustand store.
  - "Clear history" becomes per-thread Delete, plus "Delete all chats for this course".
- **Titles:** the first 60 characters of the first question. A model-written title can come after v6.

## PR 4: Composer

- **Ask/Explain switch:**
  - The toolbar `ToggleGroup` goes. Its replacement is a small chip in the composer footer, left of Send (T3 Code style).
  - Typing `/explain ` or `/ask ` at the start of a message switches mode and removes the prefix. A small popover suggests these commands when the message starts with `/`.
  - Shift+Tab in the composer toggles the mode.
  - The mode is saved on the thread (`index.json`).
  - The `mode=explain` search param from "Explain weakest topic" still works.
- **Dictation (D1, macOS):**
  - A mic `IconButton` in the composer, shown only on macOS. It focuses the textarea, then calls a Tauri command that sends AppKit `startDictation:` through `NSApp`.
  - The app's Edit menu has to exist on macOS so that dictation and Emoji & Symbols show up. If Tauri's default menu isn't installed, install the standard one.
  - Info.plist gains `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`. Check whether the hardened-runtime entitlements need `com.apple.security.device.audio-input`.
  - The macOS DMG smoke in CI can't test dictation, so it's on the user's Mac checklist.

## PR 5: Study resume

Grades and progress are saved to disk. The review position (card order, index, flipped state, the quiz's selected and submitted answers) is component state, so it resets on unmount.

- **Store:** a persisted Zustand store, `stores/study-session-store.ts`.
  - Keyed by root, course, kind (`flashcards` | `quiz`) and the deck or quiz *identity*. Reuse the existing `sessionIdentity` logic in `quiz-view.tsx` and the equivalent for flashcards.
  - It holds the serialisable review object plus, for flashcards, `deckMode`.
- **Restore:** on mount, if the saved identity matches the current one, restore it; otherwise start fresh. If the deck or quiz is regenerated, the identity changes and the saved session is dropped.
- **Restart button:** in each view's header, behind a confirm. It clears the saved session and calls `createReview`/`sessionForMode`.
- **Lessons from earlier work:** past localStorage restores lost data (0.5.2 audit). Write a unit test for the round trip and for an identity mismatch, and check the restore by switching tabs in the browser.

## PR 6: Course icons

- **Storage:** `.arbor/courses.json` in the knowledge root, `{ "<course>": { "icon": "<key>", "color": "<token>" } }`. It syncs with the library. Reading and writing go through Rust and validate the course name, with atomic writes.
- **Icon set:** about 40 lucide icons in `domain/course-icons.ts`, mapping each key to a component and a label (sciences, math, languages, arts, law, CS, medicine, business and so on). Store only the key; unknown keys fall back to `BookOpen`.
- **Colours:** 6–8 tokens that work in light and dark.
- **Picker:** a popover grid from the course header and from the course row's menu in the sidebar.
- **Where it shows:** the sidebar course row (`app-sidebar.tsx:71`), the course header, the chat course select, the search palette, and the welcome course list.

## PR 7: Provider usage (D2, modelled on T3 Code)

T3 Code has each provider driver produce one shape. `provider-core/src/server/usageLimits.ts`:

```
UsageLimits = { checkedAt, windows: Window[], unavailable?: { reason: "unsupported" | "probeFailed", message? } }
Window      = { id, kind: "session" | "weekly" | "monthly" | "other", label, usedPercent, resetsAt?, windowDurationMins? }
```

Providers are probed every 5 minutes, and updates sent during a turn are merged in.

- **Sources** (Python `arbor_worker/usage.py`, one reader per provider, all with injected runners and transports for tests):

  | Provider | Source in T3 Code | Arbor reader |
  |---|---|---|
  | Claude CLI | Agent SDK `get_usage` control request: `five_hour` → Session, `seven_day` → Weekly, `model_scoped` → per-model Weekly, spend → Monthly spend. Also `rate_limit_event` messages during a turn (`claudeUsageLimits.ts`). | Run `claude` with `--input-format stream-json --output-format stream-json`, send the `get_usage` control request on stdin, map the reply the same way. The SDK marks this API experimental, so any parse failure gives `probeFailed`, never an error. After PR 2, also read `rate_limit_event` from chat streams. |
  | Codex | `codex app-server` JSON-RPC `account/rateLimits/read` (primary/secondary windows, plan type) (`codexUsageLimits.ts`). | Start `codex app-server` briefly, send one read, map with the same rules (free or go plan → monthly). The user has no Codex subscription, so test with fakes only. |
  | Grok CLI | Reads `~/.grok/auth.json` (honours `GROK_HOME` and `GROK_AUTH`), then `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with the CLI's bearer token, mapping `creditUsagePercent` and `currentPeriod` to a Weekly or Monthly window. It skips API-key auth and custom auth or endpoint configs (`provider-grok/src/server/usageLimits.ts`). | Port it exactly, including the skip rules and the "0% when the percentage is missing but the period is valid" rule. The token goes only to xAI's own endpoint. A live check is possible on this machine. |
  | API keys, Ollama, LM Studio | — | `unsupported`. |

- **Worker command:** `usage <provider>` returns the JSON above. Rust exposes it as `read_provider_usage(provider)`. For a remote (SSH) worker, the reader runs on the worker host, because that's where the CLI is logged in.
- **UI:**
  - The sidebar `ProviderStatusLine` becomes a button that opens a popover.
  - The effective provider comes first, then any other signed-in providers.
  - Each window shows a bar with "% left", "resets in …", and a pace mark (the share of time left in the window), as in T3's `UsageLimits.tsx` `WindowBar`.
  - It shows "Checked …" with a Refresh button. `unsupported` reads "This provider doesn't report usage limits"; `probeFailed` reads "Couldn't read usage".
  - It's refetched while the popover is open and every 5 minutes in the background, using a query `staleTime`.
- **Out of scope:** T3's full Usage page (token and cost history, price tables).

---

## Roadmap after v6 (add to PROJECT.md)

**Calendar:**
- events per course (exam, quiz, assignment, other), each with a date and linked digests or lectures;
- a calendar route;
- study plan generation that counts back from the next event and only covers its linked lectures.

The groundwork already exists: `study_plan.py` already takes an `exam_date`.

Also on the roadmap: offline Whisper dictation for Linux and Windows, and model-written thread titles.
