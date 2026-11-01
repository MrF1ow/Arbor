# Issue #97 implementation plan

Analysis and decisions: [`2026-10-18-issue-97-performance.md`](2026-10-18-issue-97-performance.md). This file is the build order.

- **Branch:** `perf/issue-97`. **Worktree:** `/home/flow/Projects/personal/Arbor/.worktrees/perf-issue-97`.
- **Release:** **0.5.2**, a single PR for all four phases. This replaces the 5.1/5.2 split in the analysis.
- **Per phase:** Composer 2.5 implements. Grok 4.7 does QA (it reviews and runs the gates, and makes no edits). Composer 2.5 does one fix round. Claude audits. Then the next phase starts.

## Rules for every phase (implementers and QA)

1. Work **only** in the worktree above. Commit on `perf/issue-97` at the end of each phase with a message `perf(#97): phase N – <summary>`. **Do not push, open a PR, merge, or tag.**
2. Never invoke the Claude CLI. That means no `claude` provider in live runs and no `list-providers` or `check-auth` against real CLIs. Tests use injected runners and fakes. For any live check, use the Grok CLI (`grok-4.7`). Codex can only be tested with fakes.
3. Never touch the user's screen: no `hyprctl dispatch`, no synthetic input, no `grim` on the real outputs. If you need a window, use Xvfb on display `:97`. Otherwise run headless.
4. For teardown, use exact process names (`pgrep -x`, `pkill -x`) wrapped in `timeout 20`. Never `pkill -f`. Write your report **before** any teardown.
5. **Gates.** All of these must pass before you commit:
   ```bash
   (cd python && uv sync && uv run pytest)
   (cd desktop && npm ci && npm test && npm run build)      # npm run build = tsc + vite. Required: npm test does not typecheck
   mkdir -p desktop/dist && cargo test --manifest-path desktop/src-tauri/Cargo.toml
   ```
6. Keep the surrounding style. Match the existing comment density, and don't reformat code you aren't changing.

---

## Phase 1: free the main thread, deadlines, concurrency safety

### 1.1 Benchmark harness (new `scripts/bench-worker.sh`)
- Usage: `bench-worker.sh <worker-command...>`. The worker command may be several words, for example `uv run --project python arbor-worker`. `RUNS` defaults to 10.
- It creates a temp git library: `git init`, an empty commit, and a course folder `bench` containing `.arbor` if needed. It times these commands:
  - `--version`
  - `library-show --root L`
  - `sync --root L --show`
  - `study-progress --root L --course bench --action due` (use whatever argv shape `build_study_progress_argv` produces)
- Output: one line per command in the form `name min median p90 max` (in ms). Use `python3` for the timing so it works on both macOS and Linux bash 3.2.
- **Never** call `check-auth` or `list-providers`.

### 1.2 Async commands (`desktop/src-tauri/src/commands.rs`, `lib.rs`)
- Convert **every** `#[tauri::command]` that spawns a process, runs git, or does filesystem or network I/O to `pub async fn`. In practice that is every command except `get_settings`.
- The body runs inside `tauri::async_runtime::spawn_blocking(move || { …existing sync body… })`, followed by `.await.map_err(|e| e.to_string())?`.
- Keep the sync logic in private `fn …_blocking(...)` helpers when that keeps the diff small and the existing unit tests valid.
- Async commands that take `tauri::State<'_, T>` must return `Result<_, String>` (a Tauri rule). `State` can't move into a `'static` closure. Drop the `State` parameter and clone the `AppHandle` into the closure instead. Inside, re-acquire the state with `app.state::<SharedCoordinator>()`, which is what `start_folder_watch` already does for `Arc<WatchState>`. The frontend never passes state args, so the command signature stays compatible.
- Command names, argument names, and return JSON stay **identical**, so the frontend needs no changes in this phase.
- `start_update`, `start_study_job`, and `start_chat` run their `check-auth` step inside the blocking closure too.

### 1.3 Worker deadlines and bounded concurrency (`desktop/src-tauri/src/worker.rs`)
- `run_worker_json(app_dir, sub_args, extra_env)` keeps its signature. Internally it calls a new `run_worker_json_with_deadline(…, deadline: Duration)`:
  - Spawn with `stdout` and `stderr` piped and `stdin` null.
  - Drain both pipes on two threads.
  - Poll `child.try_wait()` every 10 ms until the deadline. On expiry, `child.kill()`, then `wait()`, and return `Err(format!("worker timed out after {}s: {}", secs, sub_args[0]))`.
  - No new crate is needed. If you do add `wait-timeout`, keep it to that one crate.
- `fn worker_deadline(sub_args) -> Duration`:
  - `check-auth`: 15 s
  - `list-models`: 20 s
  - `list-providers`: 30 s
  - `sync`, unless the args contain `--show`: 120 s
  - `reindex`: 300 s
  - `skill-install` and `skill-run`: 300 s
  - Everything else: 30 s
  - Unit-test this mapping.
- A global spawn limiter allows at most **3** concurrent local `run_worker_json` children. Use a `Mutex<usize>` plus `Condvar` in a `static` `OnceLock`. Streaming job threads (`update`, `generate`, `embed`, `chat`) are **not** limited.
- Unit tests, `#[cfg(test)]`, Unix only:
  - A fake worker (`sh -c 'sleep 30'`) gets a 1 s deadline. Assert the timeout error and that it returns in < 3 s.
  - A fake worker that prints JSON gets parsed as before.
  - 5 concurrent calls never have more than 3 children in flight. Count them with a test hook or an `AtomicUsize` high-water mark.

### 1.4 Per-command timing log
- If `ARBOR_PERF=1`, `run_worker_json` writes `eprintln!("[arbor-perf] {sub0} {ms}ms exit={code}")` after each call.

### 1.5 Progress-write safety (`python/src/arbor_worker/study_progress.py`)
- `_write_atomic`: name the temp file `.{name}.tmp-{os.getpid()}-{threading.get_ident()}-{uuid4().hex[:8]}`.
- Add a context manager `progress_lock(root, course)` that does `fcntl.flock(LOCK_EX)` on `<root>/.arbor/locks/progress-<course>.lock`. Create the directory, and make sure `.arbor/locks/` is gitignored, using the existing `cache.ensure_gitignored` pattern if it fits.
- Hold the lock around the **read-modify-write** in `study_progress_grade`, `study_progress_quiz`, and the migration writes.
- On Windows (no `fcntl`), skip the lock. The app ships for macOS and Linux.
- Tests in `python/tests/test_study_progress.py`: 2 threads × 20 grades on different card ids leave 40 entries, with none lost. A temp-file name collision is impossible: monkeypatch `uuid4` and assert the names differ.

### Phase 1 acceptance
- All gates are green.
- `grep -c "pub fn" commands.rs` for commands: only `get_settings` stays sync.
- Run the bench script against `uv run --project python arbor-worker`, and paste its output into the report.

---

## Phase 2: onedir packaging and a performance gate in CI

### 2.1 `scripts/bundle-worker.sh`
- Build `--onedir` instead of `--onefile`. Keep every other flag.
- Output goes to `desktop/src-tauri/binaries/arbor-worker-dir/`, holding `arbor-worker` and `_internal/`. Remove any stale onefile `arbor-worker-*` files in `binaries/` so the old resolution path can't pick them up.
- `ARBOR_WORKER_ONEFILE=1` keeps the old onefile build, written to the old path. It is a one-release fallback.
- On Darwin, after the build, re-sign every Mach-O in the folder ad-hoc. Find files with `file` matching `Mach-O`, run `codesign --force --sign - <f>` on each, and finish with `codesign --force --sign - <folder>/arbor-worker`. No hardened runtime (`--options` is not passed), per the #95 decision.
- `desktop/src-tauri/binaries/.gitignore` already ignores everything in `binaries/`, so nothing needs adding.

### 2.2 Bundle config (`desktop/src-tauri/tauri.bundle.json`)
- Replace `externalBin` with `"resources": { "binaries/arbor-worker-dir/": "arbor-worker/" }`. Keep `targets` and `macOS.hardenedRuntime: false`.
- In the `.app`, the worker lands at `Contents/Resources/arbor-worker/arbor-worker`.

### 2.3 Resolution (`desktop/src-tauri/src/worker.rs`)
- `packaged_sidecar()`: first try `exe_dir/../Resources/arbor-worker/arbor-worker` (macOS `.app`), then `exe_dir/arbor-worker/arbor-worker` (Linux and Windows layouts), and only then the existing `sidecar_path_in(exe_dir)` onefile lookup.
- Factor this into a pure `fn sidecar_candidates(exe_dir: &Path) -> Vec<PathBuf>` with unit tests over temp dirs, for both the folder layout and the onefile fallback.

### 2.4 Smoke and bench in CI
- `scripts/smoke-macos-bundle.sh`:
  - Find the worker at `Contents/Resources/arbor-worker/arbor-worker`, falling back to `Contents/MacOS/arbor-worker`.
  - Run the signing check on that file, and fail if any Mach-O in the folder has the runtime flag.
  - Then run a **performance gate**: 1 warm-up, then 5 timed `--version` runs. Print every time and fail if the median is > 1500 ms.
  - Keep the version and `list-providers` JSON checks.
- `.github/workflows/macos-dmg.yml`:
  - After the build, add a step that runs `bash scripts/bench-worker.sh <app>/Contents/Resources/arbor-worker/arbor-worker` on the mounted DMG's app. Mount it the way the smoke script does, or have the smoke script call the bench script. Append the output to `$GITHUB_STEP_SUMMARY`.
  - Also build a onefile worker (`ARBOR_WORKER_ONEFILE=1 bash scripts/bundle-worker.sh` into a separate temp path, so it doesn't overwrite the onedir output). Run the bench script on it and append it to the summary as **"onefile (before)"**. This gives the before and after numbers on macOS.
- `release-macos.yml`: same bundle and smoke steps. No bench needed.

### Phase 2 acceptance
- All gates are green.
- On Linux: run `bash scripts/bundle-worker.sh`, then `bash scripts/bench-worker.sh desktop/src-tauri/binaries/arbor-worker-dir/arbor-worker`. The `--version` median should be ~150 ms. Paste the output.
- The macOS proof comes from the PR's `macos-dmg` job summary. Claude checks it before merging.

---

## Phase 3: persistent worker for short requests

### 3.1 Python `arbor-worker serve` (new `python/src/arbor_worker/serve.py`, registered in `cli.py`)
- Protocol: NDJSON on stdio.
  - Request: `{"id": int, "argv": [str], "env": {str: str}}`.
  - Response: `{"id": int, "exit": int, "stdout": str, "stderr": str}`.
- At startup:
  - `proto = os.fdopen(os.dup(1), "w", buffering=1)`, then `os.dup2(2, 1)`. Child processes such as git, or any C-level write, can then never corrupt the protocol stream.
  - Pre-import `arbor_worker.commands`.
- Per request:
  - Check the allow-list.
  - Snapshot `os.environ`, apply `env`, and run `cli.main(argv)` with `contextlib.redirect_stdout/redirect_stderr` into `StringIO`. Catch `SystemExit` (use its code) and `BaseException` (exit 70, traceback on stderr).
  - **Restore `os.environ` exactly**, including removing added keys.
  - Write one response line.
- **Allow-list:** `library-show`, `sync` **only with** `--show`, `study-progress` (all actions), `study-plan`, `append-card`, `list-models`. (`skill-index` was dropped in the Phase 3 audit: it can fetch over the network and serve is serial.) Anything else gets `exit 64` and `stderr: "not serve-eligible"`.
- Requests are handled one at a time on the main thread.
- Idle exit: if there has been no request for 600 s, exit 0. Use `select` on stdin with a timeout. EOF on stdin exits 0.
- `serve` must not require `--root`.
- Tests (`python/tests/test_serve.py`). Drive `serve` in a subprocess (`sys.executable -m arbor_worker serve`):
  - A round trip of `library-show` on a temp git repo.
  - Env isolation: request A sets `X=1`, and request B can't see `X`.
  - A rejected command gets 64.
  - `SystemExit` is mapped to the exit code.
  - A subcommand that writes to fd 1 through `os.system("echo hi")` doesn't corrupt the stream. Test this by calling an internal helper with a monkeypatched `cli.main`, or via a hidden `--selftest-fd1` flag gated by the env var `ARBOR_SERVE_TEST=1`.
  - The idle timeout is configurable through `ARBOR_SERVE_IDLE_SECS`, for the test.

### 3.2 Rust `WorkerPool` (new `desktop/src-tauri/src/worker_pool.rs`)
- `pub struct WorkerPool { inner: Mutex<Option<Server>>, next_id: AtomicU64 }`, registered in `lib.rs` with `.manage(Arc<WorkerPool>)`.
- `Server { child: Child, stdin: ChildStdin, pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Resp>>>> }`.
  - A reader thread parses the stdout lines and sends each response to its `pending` entry.
  - On EOF or a parse error, it fails every pending request with `Err("worker server exited")` and marks the server dead.
- `pub fn request(&self, app_dir, sub_args, env, deadline) -> Result<serde_json::Value, String>`:
  1. Lock and spawn if needed. Use `resolve_worker_argv(..., &["serve"], packaged_sidecar())` and the same `PATH` as `run_worker_json`.
  2. Register the id, write the line, and unlock.
  3. `recv_timeout(deadline)`.
  4. Parse `stdout`, `stderr`, and the exit code with the **existing** `parse_worker_json_output`, so the behavior matches spawn mode byte for byte.
  - On timeout: kill the server, set it to `None`, and return a timeout error.
  - On exit 64: fall back to `run_worker_json`.
  - On server death: if the request is a **read** (anything except `study-progress grade|quiz` and `append-card`), respawn and retry once. Otherwise return the error and let the frontend queue retry.
- `pub fn prewarm(&self, app_dir)`: spawns the server on a background thread.
- `fn serve_eligible(sub_args) -> bool` mirrors the Python allow-list. Unit-test it.
- `ARBOR_WORKER_NO_SERVE=1` turns the pool off, and every call takes the spawn path.
- `commands.rs::run_worker_json_app`: if `serve_eligible`, call `app.state::<Arc<WorkerPool>>().request(...)`, passing the `worker_env_pairs` as `env`. Otherwise use the existing spawn path. `run_worker_json_inherit` uses the pool too when eligible, with empty env.
- Add a `prewarm_worker` command, called by the frontend once at startup after `get_settings`, or call it from `lib.rs` `setup`.
- Rust tests use a fake `serve` written as a small shell or python script, set through `ARBOR_WORKER_CMD`:
  - Ordering under concurrency (10 threads).
  - A timeout kills and respawns the server.
  - A crash during a read is retried once and succeeds.
  - A crash during a `study-progress grade` is **not** retried.
  - Exit 64 falls back to spawn.

### Phase 3 acceptance
- All gates are green.
- A new bench mode, `scripts/bench-worker.sh --serve <worker-cmd>`, times 30 warm `library-show` requests through one `serve` process, driven by a `python3` client. Paste its output; the warm median should be ≤ 20 ms on Linux.

---

## Phase 4: do less work, the snappy study loop, the release

### 4.1 Python
- `cli.py`: if `argv` is exactly `["--version"]` (or `sys.argv[1:]` is), print `__version__` and return 0 **before** importing `provider.registry` or `study_progress`. Move those imports into `build_parser()` (or into the functions that use them). Keep the existing `test_cli.py` passing.
- `study-progress --action overview` returns `{"due": <due doc>, "weak": <weak doc>, "recommend": <recommend doc>}`, built from the existing functions with a single commit-if-dirty. Also accept it in Rust `build_study_progress_argv`, with no extra args. Add tests in both languages.

### 4.2 Rust sign-in cache (`commands.rs`)
- `static AUTH_CACHE: OnceLock<Mutex<HashMap<String, (Instant, serde_json::Value)>>>`, keyed by provider id plus transport. Remote SSH roots use the key `ssh:<host>:<provider>`.
- `fn cached_auth(app, transport, provider_id, force: bool) -> Result<Value, String>`:
  - Return the cached value if it is younger than **60 s** and `!force`.
  - Otherwise run the existing check and store the result. Errors are not cached.
- `check_auth` command: add `force: Option<bool>`. `start_update`, `start_study_job`, and `start_chat` call `cached_auth(…, false)`.
- `pub fn invalidate_auth(provider_id)`. Call it when a job fails as not authenticated. The streamed failure is produced at `worker.rs` ~623 (`"{provider_label} is not authenticated"`) and summarized in `jobs.rs` ~228. Invalidate where the worker stream sees it. Also call it from `save_settings` when `provider_id` changed.
- No background polling of any kind.
- Unit-test the TTL logic with an injectable clock (`fn cached_auth_with(now: Instant, …)`).

### 4.3 Frontend (`desktop/src/main.ts` + new modules)
- **Providers.**
  - `loadProviders` no longer invokes `list_providers`. Build the picker from `pickerProviders(PROVIDER_FALLBACK)`.
  - Only the effective provider (the library's pinned provider, else `settingsProviderId`) is checked, by `refreshAuth`.
  - Remove the `list_providers` invoke from the UI. Keep the Rust command and the Python CLI.
- **Models.**
  - Add a cache `Map<string, Model[]>` keyed by `${knowledgeRoot ?? ""}|${providerId}`.
  - `loadModels(selected, { refresh = false } = {})` invokes `list_models` only on a cache miss or when `refresh` is set.
  - Invalidate the cache:
    - after `library_set_provider`
    - after saving an Ollama or LM Studio base URL
    - on a root switch (the key already changes)
- **Auth.**
  - `refreshAuth({ force = false } = {})` passes `force` to `check_auth`.
  - A provider change passes `force: true`.
  - The focus listener keeps calling `refreshAuth()`. Rust answers from its cache within 60 s, so there is no spawn.
  - Don't flash "Checking…" when the answer comes back in < 150 ms. Set the label only after a 150 ms timer.
- **refreshSyncUi(opts: { provider?: boolean } = {})**:
  - Run `sync_show`, `get_knowledge_settings`, and `library_show` (through `refreshLibraryShow`) concurrently with `Promise.allSettled`.
  - Call `applyEffectiveProviderForActiveRoot()` only if `opts.provider` is set.
  - Pass `{ provider: true }` from startup (`loadSettings`) and from `switchKnowledgeRoot`. Opening **Settings** calls `refreshSyncUi()` without it.
- **Course overview.**
  - New `loadCourseOverview(root, course)`: one `study_progress` `overview` call, memoized per `${root}|${course}` until it is invalidated.
  - `loadStudyRecommendations`, the weak-topics loader, and the flashcard `due` read all take their data from it.
  - The flashcard loader runs its `read_study_json`, overview, and `study_artifact_stale` calls concurrently with `Promise.all`.
- **Study write queue (new `desktop/src/study-writes.ts`, pure and unit-testable):**
  ```ts
  export type StudyWrite = { key: string; root: string; course: string; args: Record<string, unknown> };
  export function createStudyWriteQueue(deps: {
    send: (w: StudyWrite) => Promise<void>;          // invoke("study_progress", w.args)
    storage: Pick<Storage, "getItem" | "setItem">;   // localStorage; key "arbor.pendingStudyWrites"
    onStatus: (s: { pending: number; failing: boolean }) => void;
    delays?: number[];                               // default [1000, 5000, 30000], then keep repeating 30000
    now?: () => number; setTimer?: …;                // injectable for tests
  }): { enqueue(w: StudyWrite): void; flush(timeoutMs?: number): Promise<void>; restore(): void; pending(): number };
  ```
  - Writes are sent **in order, one at a time**. The queue is persisted to storage after every change, and `restore()` replays it at startup (after the root is known).
  - `onStatus` reports `failing: true` once the head write has been failing for **≥ 5 s**.
  - `flush()` resolves when the queue is empty or the timeout passes.
  - Successful writes for a course invalidate that course's overview memo.
- **Wiring.**
  - `gradeCurrentFlashcard`: compute the next card state **first**, render it, then `enqueue` the grade. Remove the `await invoke` and the `flashcardGradeInFlight` gating. Keep the guard against double-grading the same card: a card that has been graded is no longer current.
  - Quiz submit: replace the `progressWrite` promise chain with `enqueue`.
  - `append_card` ("make card") stays a direct call. It returns the new card id that the UI needs, but it must be off the main thread, which Phase 1 handles.
  - Before `switchKnowledgeRoot` and before any overview reload, call `await queue.flush(3000)`.
  - The UI shows a small "N unsaved · Retry" pill only while `failing`. Retry calls `flush`. Use existing classes and colors, and put it next to the existing flashcard and quiz status text.
- Tests:
  - `desktop/tests/study-writes.test.mjs`, a real unit test of the module: ordering, retry with backoff, persistence and restore, `failing` after 5 s with an injected clock, and `flush`.
  - Update the source-grep UI tests that break because of the changes above, **only where the old behavior was intentionally removed**. Keep their intent.
  - Add a grep test asserting that `main.ts` has no `invoke("list_providers"` / `invoke<…>("list_providers"`.

### 4.4 Release 0.5.2
- Bump every `0.5.1` package version to `0.5.2`:
  - `python/pyproject.toml`
  - `python/src/arbor_worker/__init__.py`
  - `python/tests/test_cli.py` (if it pins the version)
  - `desktop/package.json` and `desktop/package-lock.json` (top-level `version` fields only)
  - `desktop/src-tauri/Cargo.toml` and `Cargo.lock` (the `desktop` package entry)
  - `desktop/src-tauri/tauri.conf.json`
  - `README.md`, `desktop/README.md`, `python/README.md`, and `PROJECT.md`, where they state the current version
- `CHANGELOG.md`: a `## 0.5.2 — <date>` section in the existing style. Update the "Current package" header line. List the user-visible changes: no more beachball, faster loads, the sign-in cache, only the chosen provider is checked, instant flashcard and quiz advance, onedir worker. Reference #97.
- Don't change historical plan docs.

### Phase 4 acceptance
- All gates are green.
- `rg -n '"list_providers"' desktop/src` returns nothing.
- Report the output of `bench-worker.sh` (spawn) and `bench-worker.sh --serve`.

---

## Claude's audit checklist (after each phase's fix round)

- Read the full diff of the phase (`git diff <prev-phase-commit>..HEAD`).
- Rerun all three gates myself. For Phase 4, also `rg` for leftover sync commands, `list_providers` invokes, and `await invoke("study_progress"` in the grade path.
- Concurrency: no lock held across a blocking spawn, no `Mutex` poisoned on panic paths (use `lock().unwrap_or_else(|e| e.into_inner())`), and no unbounded thread growth.
- Persistence: grades are never dropped silently, and the queue survives a reload.
- No new dependency beyond what the plan names.
- macOS: the PR's `macos-dmg` job summary shows the onedir worker bench and the onefile one. The median `--version` gate passes.
