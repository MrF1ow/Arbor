# PR 3: Stored chat threads

Branch `ux/03-threads`, stacked on `ux/02-streaming`. Plan: `README.md`. **The agent rules in `../ui-6.0/README.md` apply in full:** no browser, never launch the app window, no live provider runs.

Worktree: `/home/flow/Projects/personal/Arbor/.worktrees/ux-stack`.

## Today

- **Storage:** one append-only file per course, `.arbor/users/<git-user>/chat/<course>.jsonl` (`chat_history_path` in `desktop/src-tauri/src/commands.rs` ~1517).
- **"New chat"** appends a `{"role":"session"}` line, and `visibleTranscript` hides everything before the last one. So history exists but can't be browsed.
- **Rust commands:** `read_chat_history`, `append_chat_lines`, `clear_chat_history`.
- **UI:** `chat-view.tsx` owns the whole send pipeline: the Tauri `Channel`, appends and live state. It also does fragile history "adoption" with signatures and refs.
- **Sync:** `.arbor/users/*/chat/` is already excluded from library sync (`python/src/arbor_worker/sync.py`), so threads stay private.

Model: T3 Code. Threads belong to a project (here, a course) and are listed newest first. A thread is titled from its first message, can be renamed and deleted, and keeps its own draft.

## 1. Storage and Rust (new module `desktop/src-tauri/src/chat_threads.rs`, registered in `lib.rs`)

**Layout:** `.arbor/users/<git-user>/chat/<course>/`:
- `index.json`: `{"version":1,"threads":[{"id","title","mode","created_at","updated_at"}]}`. `mode` is `"ask"` or `"explain"`; timestamps are RFC 3339 UTC.
- `<id>.jsonl`: one JSON chat line per line. Roles are `user` and `assistant` only. Session lines are no longer written.

**Thread id format:** `t-YYYYMMDDTHHMMSSZ-xxxxxx` (6 lowercase hex). Validate with `^t-\d{8}T\d{6}Z-[0-9a-f]{6}$` on every command. Reuse `validate_chat_course` and `git_user_dirname`, and reject any path with `..`, as `chat_history_path` does.

**Writes:**
- `index.json` is written atomically (temp file in the same dir + rename).
- All index read-modify-write operations hold one process-wide `static CHAT_INDEX_LOCK: Mutex<()>`.
- `.jsonl` appends use `OpenOptions::append`.

**Commands** (all `async`, wrapped in `spawn_blocking_cmd*` like their neighbours; every one runs `ensure_migrated(root, course)` first):

| Command | Returns | Behaviour |
|---|---|---|
| `list_chat_threads(root, course)` | `Vec<ThreadMeta>` | Sorted by `updated_at` desc. |
| `create_chat_thread(root, course, mode)` | `ThreadMeta` | Title `"New chat"`; `created_at` = `updated_at` = now. |
| `read_chat_thread(root, course, thread)` | `Vec<Value>` | Missing file → empty. Skip unparsable lines, as `read_chat_history` does. |
| `append_chat_thread_lines(root, course, thread, lines)` | `ThreadMeta` | Validate roles (`validate_chat_line_role`) and that the thread exists in the index. Append; set `updated_at` = now. If the title is still `"New chat"` and an appended line is a `user` line, set the title from it (see below). |
| `rename_chat_thread(root, course, thread, title)` | `ThreadMeta` | Trim; 1..=120 chars, else `Err`. |
| `set_chat_thread_mode(root, course, thread, mode)` | `ThreadMeta` | `validate_chat_mode`. PR 4 uses this. |
| `delete_chat_thread(root, course, thread)` | `()` | Remove the index entry and the file. |
| `delete_all_chat_threads(root, course)` | `()` | Remove the course's chat dir. |

**Title rule:** collapse whitespace; if longer than 60 chars, cut at the last space before 60 and append `…`. Put it in a small pure fn with unit tests.

**Migration** (`ensure_migrated`; idempotent; runs under the lock):
- Call the existing `chat_history_path(root, course)`. It already performs the older `.arbor/chat` → per-user move. If that file exists and the course dir has no `index.json`:
  - split it on `role == "session"` lines;
  - drop segments with no `user` or `assistant` line;
  - per segment, create a thread:
    - `created_at` = the first line's `ts`, else now; `updated_at` = the last line's `ts`, else now;
    - id derived from `created_at` plus random hex;
    - `mode` = the last user line's mode if it is `ask` or `explain`, else `ask`;
    - title from the first user line;
  - write all thread files, then the index, then rename the legacy file to `<course>.jsonl.migrated`.
- The old `quiz` mode needs no special handling beyond that fallback.

**Remove the old commands** `read_chat_history`, `append_chat_lines` and `clear_chat_history`: their registration in `lib.rs`, their `ipc.ts` command names, and the queries. Keep `chat_history_path` because migration uses it. Update or remove the Rust tests that covered the old commands. Keep their path-safety assertions by porting them to the new commands.

**Rust tests** (tempdir):
- create → append user line → the title is set and `updated_at` advances;
- list ordering;
- rename validation;
- delete and delete-all;
- invalid thread ids, including traversal attempts, are rejected;
- migration of a file with 3 segments: one empty, one with a `quiz` line, one normal → 2 threads with correct titles and modes, the legacy file renamed, and a second call doing nothing.

## 2. Send pipeline moves out of the component: `desktop/src/lib/chat-runner.ts`

Create a module (not a component, so `invoke` is allowed) that owns sending:

```ts
sendChatMessage(opts: {
  queryClient, root, course, threadId: string | null, mode, question, providerId, providerLabel, modelId,
  history: Array<{role:string;content:string}>,
}): Promise<{ threadId: string }>
```

It ports today's `sendMessage` from `chat-view.tsx` exactly:
- the auth gate (`fetchAuthStatus`) and its messages;
- the "Select a model in Settings." check;
- statuses `Retrieving` → `Answering` → `Done`;
- `auth_failed` / `error` / `worker_exit` handling;
- the `chatAuthErrorMessage` fallbacks.

The runner itself is responsible for:
1. **Lazy thread creation:** if `threadId` is null, call `create_chat_thread` first. A thread is never created until the first send, so there are no empty threads.
2. Appending the user line with `append_chat_thread_lines` **before** starting the worker.
3. On `chat_done`, appending the assistant line to **the thread captured at send time**, never "whatever is on screen now".
4. Keying live state by `chatLiveKey(root, course, threadId)`, which now has 3 parts.
5. Invalidating the `chatThreads(root, course)` and `chatThread(root, course, threadId)` query keys after each append.

**It must keep working after the `ChatView` that started it unmounts** (the user switches threads or tabs mid-answer).

Move the existing status logic from `ChatView` into the live store, so it is per thread (`setChatLiveStatus(key, …)`). The component only reads it.

## 3. Queries (`desktop/src/lib/queries/chat.ts`, `keys.ts`)

- Queries: `useChatThreads(root, course)` and `useChatThread(root, course, threadId)` (disabled when the id is null).
- Mutations, with invalidation: `useRenameChatThread`, `useDeleteChatThread`, `useDeleteAllChatThreads`, `useSetChatThreadMode`.
- Remove the old `useChatHistory`, `useAppendChatLinesMutation`, `useClearChatHistoryMutation` and `qk.chatHistory`.
- `src/test/mock-handlers.ts`: implement every new command in memory, including the title rule, so `dev:mock` and the tests work. Seed `cell-biology` with 3 threads that have distinct titles and times. One of them should contain an explain answer with a loose numbered list.

## 4. UI

**Route** (`routes/course.$course.chat.tsx`):
- Add the search param `thread?: string`.
- Change the `ChatView` key to `${root}|${course}|${thread ?? "new"}`.
- **No `thread` param:** show the "new chat" state; don't auto-select. Exception: if the user arrived from the Chat tab with no params at all and threads exist, `replace`-navigate to the most recent thread, so that "come back to chat" lands where they were.
- A `prompt` param (Explain weakest topic) always starts in the new-chat state.

**Thread list panel:** `components/chat/chat-threads-panel.tsx`, on the left of the chat view.
- Collapsible like `NotesIndex`: same width and the same `ui-store` pattern (`chatThreadsOpen`, persisted).
- **Header:** "Chats" `SectionLabel`, a **New chat** `IconButton` (navigates to no `thread`), and a hide button.
- **Search:** an `Input` that filters titles client-side, case-insensitively.
- **Rows:** a `ListRow` with the title and a relative time (reuse an existing relative-time helper in `src/domain` if there is one; otherwise add a pure one with tests). The active row is highlighted. A row with an answer in flight shows a small spinner or pulse.
- **Row menu** (`DropdownMenu`, `MoreHorizontal` icon button shown on hover/focus):
  - Rename → a `Dialog` with an `Input`, prefilled, Enter saves;
  - Delete → an `AlertDialog` ("Delete this chat? This cannot be undone."). Deleting the active thread navigates to new-chat.
- **Footer:** "Delete all chats" (ghost, destructive) → an `AlertDialog` (`Delete all chats for {course display name}? This cannot be undone.`).
- **Empty state:** "No chats yet".

**Chat view** (`chat-view.tsx`):
- Remove the toolbar's **New chat** and **Clear history** buttons; the panel replaces them.
- Remove all the history-adoption refs and signature logic. Lines come from `useChatThread(...)`. While the thread is in flight, render the server lines plus the live bubble.
- The course `Select` stays.
- The mode toggle stays where it is (PR 4 moves it). Its value comes from the thread's `mode`, or local state for a new chat. Changing it on an existing thread calls `set_chat_thread_mode`.
- **Drafts:** a persisted Zustand store, `stores/chat-drafts-store.ts`, keyed `root\0course\0(threadId ?? "new")`. The textarea reads and writes it. It's cleared on successful send, and the `"new"` draft moves to the new thread id on lazy creation.
- **Composer disabled:** only when **this** thread is in flight. Other threads stay usable, and concurrent answers in different threads are allowed.
- After the first send from new-chat, `replace`-navigate to `?thread=<new id>`.
- The empty transcript keeps the current `EmptyState`.
- Keep PR 1's scroll behaviour and PR 2's `LiveAnswer`. `LiveAnswer` takes `threadId`.

`domain/chat.ts`:
- `visibleTranscript` and `buildSessionLine` become unused. Remove them, and their tests.
- `workerHistory` takes the thread's lines directly.

## 5. Tests (vitest, `src/routes/chat.test.tsx` and new files)

Rewrite the chat route tests for threads. Each of these must work:
- the list renders seeded threads newest first;
- clicking a row shows its transcript;
- New chat → send → a thread appears titled from the question, and the URL has `thread=`;
- rename and delete through the menus;
- delete-all;
- search filtering;
- switching threads mid-stream: the answer lands in the original thread, not the visible one, and the live bubble shows when you switch back;
- the draft survives switching threads and is cleared on send;
- the mode persists per thread;
- `?prompt=` auto-sends once into a new thread.

Keep the existing auth-gate, error and citation-chip tests passing; adapt them to the new commands.

## 6. Checks

Wrap each in `timeout 600` and paste the tail with `EXIT=$?`:
- `cd desktop && npm test`
- `npm run lint`
- `npm run build`
- `cd desktop/src-tauri && cargo test`. This is the full Rust suite, because the commands moved.
- `cd python && uv run pytest -q`

Commit in logical commits:
1. Rust module and migration
2. runner and queries
3. UI
4. tests

---

## Execution plan

| Step | Agent | Task |
|---|---|---|
| 1 | Composer 2.5 | Implement §1–§5, run §6, commit. |
| 2 | Claude | Rerun the suites and skim the diff. |
| 3 | Grok 4.7 | QA, review only. Focus: migration correctness and idempotency; path traversal in thread ids; index races under the lock; the runner writing to the captured thread after unmount; draft handoff; query invalidation; anything still calling the removed commands. |
| 4 | Composer 2.5 | One fix round. |
| 5 | Claude | Audit plus a headless preview on `dev:mock`: list, switching, a mid-stream switch, rename/delete, drafts, light and dark. Then push and open a stacked PR. |
