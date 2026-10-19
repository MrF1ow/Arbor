# PR 4: Data layer (IPC, queries, events, stores, study writes, mock mode)

Branch `ui/04-data-layer`, stacked on `ui/03-primitives`. Master plan §7 and **§7.1 (the 5.1.0 behavior must not regress)**, §9 (mock mode), §11 row 4, Appendix A. Read `README.md` in this folder first: **no browser, never launch the app window.**

The legacy implementation is the source of truth for behavior: `desktop/src/legacy/main.ts`. Port the logic; don't import from `src/legacy`.

## Goal
Build every piece of non-visual plumbing the screens need, fully tested with `mockIPC`, plus a `dev:mock` mode so the app runs in a plain browser with fixture data. **No UI beyond a tiny proof on the placeholder page.** The shell is PR 5.

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. `src/lib/ipc.ts`
- `invoke<T>(cmd: Command, args?)` and `listen<T>(event, handler)` wrap `@tauri-apps/api`, guarded by `hasTauriInvoke` from `~/domain/tauri`. Outside Tauri, reject with `TAURI_UNAVAILABLE`.
- `type Command` is a string-literal union of every command the UI calls (master plan Appendix A, 5.1.0 list, **excluding `list_providers`**). The type must make `invoke("list_providers")` a compile error. Add a `// @ts-expect-error` test.
- **Preserve error strings exactly.** `isTransientStudyWriteError` and `authCheckWorkerFailureReason` match on them. Normalize to `Error` with the original message; don't wrap or prefix it.
- Also port the legacy `open`/`confirm` dialog wrappers (`legacy/main.ts` ~lines 127–160) as `ipc.openDialog` / `ipc.confirmDialog`.

## 2. Query keys and hooks: `src/lib/queries/`
- `keys.ts` is one key factory, e.g. `qk.courses(root)`, `qk.digests(root, course)`, `qk.markdown(root, path)`, `qk.courseOverview(root, course)`, `qk.settings()`, `qk.knowledgeSettings(root)`, `qk.auth(provider, root)`, `qk.models(provider, root)`, `qk.jobs(root)`, `qk.jobEvents(jobId)`, `qk.library(root)`, `qk.sync(root)`, `qk.chatHistory(root, course)`, `qk.studyJson(root, course, kind)`, `qk.quizProgress(root, course)`, `qk.studyPlan(root, course)`, `qk.skillIndex()`, `qk.providerSecret(provider)`, `qk.syncConflict(root)`.
- **One file per domain:** `library.ts`, `notes.ts`, `study.ts`, `settings.ts`, `auth.ts`, `jobs.ts`, `sync.ts`, `skills.ts`, `workers.ts`, `chat.ts`. Each exports a `useX` hook per **read** command and a `useXMutation` per **write** command. Mutations invalidate exactly the keys their command affects (mirror what legacy reloads after each call).
- Arg and result types come from `~/domain/types` (add types there if missing; keep `domain/` React-free).
- `src/lib/query-client.ts` creates the `QueryClient` with defaults: `staleTime: 30_000`, `retry: 1` for queries, `retry: 0` for mutations, `refetchOnWindowFocus: false` by default. Auth overrides that; see §7.1.

### §7.1 rules: each one gets a unit test
| Rule | Implementation (legacy reference) |
|---|---|
| Auth is cached 60 s; concurrent checks coalesce; refocus within 60 s does nothing; no polling | `useAuth(provider, root)`: `staleTime: 60_000`, `refetchOnWindowFocus: true`, no `refetchInterval`. Port `runRefreshAuth` / `refreshAuthRequestKey` / `refreshAuth` (legacy ~3101–3160), including the worker-unavailable vs signed-out reason handling (`~/domain/provider`). |
| The UI never calls `list_providers`; the picker uses the static list | Move `PROVIDER_FALLBACK` (legacy ~2933) to `~/domain/provider.ts` as an exported constant. `useProviderOptions()` returns `pickerProviders(PROVIDER_FALLBACK)` synchronously (no query). |
| Models cached per provider and root; refreshed only on provider change, root switch, or the refresh button | `useModels(provider, root)`: `staleTime: Infinity`, plus `refreshModels()`, which invalidates `qk.models(provider, root)`. Port `loadModels` + `invalidateModelsCacheForCurrentRoot` (legacy ~3070, 418). |
| Settings reads run in parallel; the effective provider is applied only on startup, root switch, or provider/library change | `refreshSyncUi` (legacy ~2117) becomes separate queries. Expose `useApplyEffectiveProvider()`, an effect hook keyed on `[root, providerId, libraryProvider]`, porting `applyEffectiveProviderForActiveRoot` (legacy ~955). It must not run because Settings mounted. |
| One overview call per root and course | `useCourseOverview(root, course)` → `invoke("study_progress", { root, course, action: "overview" })` (legacy ~1385). Invalidated by study writes (`onSent`), `job-finished` for that course, and `files-changed` for that root. |

## 3. Study writes: `src/lib/study-writes.tsx`
- `StudyWritesProvider` creates **one** queue with `createStudyWriteQueue` from `~/domain/study-writes` (unchanged module) at startup:
  - `send` = `invoke("study_progress", …)` with the write's args, exactly like legacy `enqueueStudyWrite` (legacy ~450–505)
  - `storage = window.localStorage` (key `arbor.pendingStudyWrites`)
  - `onStatus` updates a zustand `study-writes-store` (`pending`, `failing`)
  - `onSent` invalidates `qk.courseOverview(root, course)` (and quiz progress for quiz writes)
  - `onDropped` calls `toast.error(...)` with the legacy copy from `showStudyWriteDroppedNotice` (legacy ~441)
- On mount, replay pending writes from storage, as the legacy startup does.
- `useEnqueueStudyWrite()` returns `enqueue(write)`. It **never awaits** the worker.
- `useStudyWriteStatus()` returns `{ pending, failing, retry }` for the future `UnsavedBadge`. Port the label logic from `updateStudyWriteStatus` (legacy ~430): "N unsaved · Retry".
- **Do not** use react-query mutation retry for these.
- Tests:
  - an enqueue doesn't block (a never-resolving `mockIPC` handler still returns immediately and records pending = 1)
  - a transient failure retries
  - pending writes persist and replay
  - a dropped write shows a toast

## 4. Events: `src/lib/events.tsx`
- `WorkerEventsBridge` mounts once and subscribes to `arbor://progress`, `arbor://job-finished`, and `arbor://files-changed` (legacy `subscribeWorkerEvents` ~4234).
  - **progress** → `jobStore.append(line)`. Port `renderEvent` (legacy ~4123) into a **pure** function `formatWorkerEvent(ev)` in `~/domain/worker-events.ts`, with a test, that turns the payload into a log line plus an optional step/status for the status pill.
  - **job-finished** → `jobStore.finish(result)`, then invalidate digests, course overview, study JSON, flashcards, quiz, graph, citations, and jobs for that root/course. Port `handleJobFinished` (legacy ~4262) **including the auto-embed / auto-quiz chaining** as calls to the relevant mutations. Keep the logic in a testable function `onJobFinished(finished, deps)`.
  - **files-changed** → invalidate library, courses, and digests for that root, **respecting the 5 s `suppressWatchUntil` window** (legacy 393, 2751, 3210). Expose `suppressWatch(ms)` so imports can call it.
- Tests: each event → the expected store calls and `invalidateQueries` keys (spy on the query client), and the suppress window.

## 5. Stores: `src/stores/`
- **`ui-store.ts`** (extend; persisted `arbor.ui`; keep `appearance` validation): `sidebarOpen: boolean = true`, `logOpen: boolean = false`, `logHeight: number = 200`, `notesIndexOpen: boolean = true`, `lastCourse: { root: string; course: string } | null`. Setters plus `toggleSidebar`/`toggleLog`. **There is deliberately no "last digest"** (master plan D9: courses always open on the Overview).
- **`job-store.ts`** (not persisted):
  - `activeJobId`, `status: "idle"|"running"|"failed"|"done"`, `step: string|null`
  - `lines` as a **ring buffer capped at 5,000**, `unread: number`
  - `append(line)` increments `unread` only while `ui-store.logOpen` is false
  - `markRead()`, `start(jobId)`, `finish(result)`
  - **Nothing in this store opens the log** (master plan §6.3)
- **`study-writes-store.ts`**: `{ pending, failing }`.
- **`selection-store.ts`**: the make-card selection snapshot (text, heading, page, digest), ported from legacy `makeCard*` state (~417–426). Used in PR 7.
- **Settings sync for appearance:** `useAppearanceSync()` loads `get_settings().appearance` into ui-store on startup and saves through the `save_settings` mutation when it changes (legacy `loadSettings`/`persist` ~3003, 3049). Leave the `// PR 4` note from PR 2 resolved.

## 6. Providers wiring
`src/routes/__root.tsx` mounts (inside the existing `ThemeProvider`, `TooltipProvider`, and `Toaster`; **don't duplicate those**): `StudyWritesProvider`, `WorkerEventsBridge`, and the appearance sync. `QueryClientProvider` stays in `main.tsx` using `query-client.ts`.

## 7. Mock mode: `npm run dev:mock`
- Add the script `"dev:mock": "vite --mode mock"`. In `main.tsx`, before rendering, when `import.meta.env.MODE === "mock"`, dynamically import `~/test/mock-ipc` and install it. **Production builds must not include it.** Verify with a grep of `dist/` for a unique fixture string.
- `src/test/mock-ipc.ts`:
  - uses `mockIPC` (and `mockWindows` if needed) from `@tauri-apps/api/mocks`
  - routes each `Command` to a handler backed by in-memory fixtures in `src/test/fixtures/`
  - supports emitting events, so `arbor://progress` / `job-finished` can be triggered from fixture "jobs" with small `setTimeout` delays to simulate a running Update
- **Fixtures** (realistic, matching the mockup):
  - a library root "Fall 2026" with courses Cell Biology (12 digests), Organic Chemistry II, Linear Algebra, and Medieval Europe, plus a shared root "Shared · Study group"
  - Cell Biology:
    - `course.md`
    - 6+ digests with real-looking markdown, including `<!-- arbor-pages: … -->` ranges, a table, lists, and digest links
    - a flashcard deck (86 cards, 14 due)
    - a quiz pack and progress (78%)
    - a concept graph
    - a study plan with exam date 2026-11-04
    - an overview payload with weak topics (cytoskeleton) and recommendations
    - a job history with one failed and one successful job
    - chat history
    - settings with provider `grok`, model `grok-4.7`
  - `check_auth` returns signed-in after a 300 ms delay
- The same handlers are reused by vitest tests (`src/test/render.tsx` helper: `renderWithProviders(ui, { route?, fixtures? })` wraps the QueryClient, router (memory history), and all providers).

## 8. Placeholder proof
Update `src/routes/index.tsx` (still a placeholder until PR 5) to list course names from `useCourses(root)` for the first root, using the `ListRow` composite. That proves the data path works in `dev:mock` and in tests. Keep it tiny.

## 9. Tests (vitest)
- `ipc.test.ts`: `list_providers` is a type error; error messages are preserved verbatim; it rejects outside Tauri.
- `auth.test.tsx`:
  - two concurrent `useAuth` hooks make **one** `check_auth` call
  - a refocus inside 60 s makes 0 calls
  - a refocus after 60 s (fake timers) makes 1
  - no interval polling
- `models.test.tsx`: no refetch on remount; refetch after `refreshModels()` and after the root changes.
- `providers.test.tsx`: rendering every hook in this PR never invokes `list_providers` (assert through the `mockIPC` call log).
- `apply-effective-provider.test.tsx`: runs on root change, not on unrelated remounts.
- `course-overview.test.tsx`: one call per root/course; invalidated by a study write `onSent` and by `job-finished`.
- `study-writes.test.tsx`: as in §3.
- `events.test.tsx`: as in §4, including auto-embed/auto-quiz chaining and the suppress window.
- `job-store.test.ts`: ring buffer cap; unread only while the log is closed; nothing toggles `logOpen`.
- `worker-events.test.ts` (node or vitest) for the pure formatter.

## 10. Acceptance (run all, report real results)
- `npm test`, `npm run lint`, `npm run build`. Report the main chunk gzip size.
- `grep` proves the mock and fixtures aren't in `dist/`.
- **Don't run `npm run dev:mock`.** Claude will run it and check that the placeholder lists the fixture courses.

## Commit
A few focused commits on `ui/04-data-layer`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push.
