# Issue #97: main-thread worker waits and repeated worker startup

Status: **analysis done 2026-10-18, plan ready**. Target releases: **5.1.0** (phases 1–2), **5.2.0** (phases 3–4). Scope: `desktop/src-tauri`, `python/`, `scripts/`, small `desktop/src/main.ts` edits. It doesn't depend on the 6.0.0 UI rebuild (`2026-10-18-ui-architecture.md`). See §7 for how the two fit together.

---

## 1. Verdict on the issue's analysis

| # | Issue claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Sync commands block the window thread | **Confirmed** | All 60 `#[tauri::command]` fns in `commands.rs` are sync `pub fn`, with 0 `async fn`. `worker::run_worker_json` (`worker.rs:311`) calls blocking `Command::output()` with no deadline. |
| 2 | Each worker launch is expensive | **Confirmed. The cause is packaging, not Python.** | §2 numbers: onefile costs ~690 ms more per call than onedir on Linux. On macOS the onefile `_MEI…` extraction also writes fresh copies of `Python.framework` and every dylib each launch (see the issue-95 plan), and dyld then registers their code signatures through `fcntl(F_ADDFILESIGS…)`. The issue's sample had 1,549 of 1,692 samples in dyld `__fcntl`, which matches that cost. Fresh files mean fresh vnodes, so nothing is cached between runs. |
| 3 | Eager imports are a high-priority cost | **Mostly incorrect.** Real but small. | `python -X importtime`: `arbor_worker.cli` costs 42 ms in total, and `arbor_worker.commands` costs 102 ms. PyMuPDF, pptx, and docx are **not** imported on the metadata paths. Downgraded to low priority. |
| 4 | Settings fans out into 4 worker calls | **Confirmed, and worse than stated** | `refreshSyncUi` (main.ts:2013) awaits `sync_show`, then `library_show`, then `list_providers`, then `list_models`, one after another. It runs on **startup** (main.ts:2921), on **every root switch** (main.ts:1058), and on Settings (main.ts:516). Startup then adds `check_auth` (main.ts:4191). That makes 5 serial spawns before the first screen settles. `list_models` repeats data that `list_providers` already returned. |
| 5 | Focus, grade, and auth add more launches | **Confirmed** | `focus` triggers `refreshAuth` (main.ts:4184) with no TTL. `gradeCurrentFlashcard` (main.ts:1627) awaits a full worker spawn before the card advances. |
| 6 | Provider discovery probes every backend | **Confirmed** | `cmd_list_providers` (commands.py:96) runs `status()` serially for every provider. CLI probes have a 10 s timeout each (`auth.py:102`), and HTTP providers probe status and models separately. |

**Additional findings not in the issue:**

- **Job starts freeze the window.** `start_update` (commands.rs:2533), `start_study_job` (2661), and `start_chat` (1393) run a synchronous `check-auth` worker spawn inside the command before they spawn the job thread. On macOS that is a ~5 s beachball on every Generate, Update, or chat send, on top of the frontend's own `refreshAuth`.
- **Other main-thread work.** `git_user_dirname` (commands.rs:824) and `init_knowledge_repo` shell out to `git` synchronously on the main thread. Each is cheap, but it is the same defect.
- **Concurrency hazards to fix before going parallel.** `study_progress._write_atomic` names its temp file `.<name>.tmp-<pid>` (study_progress.py:109). Progress updates are read-modify-write with no lock. Today only the frontend's `flashcardGradeInFlight` flag prevents lost updates. Phases 1 and 3 add real concurrency, so they need a per-root write lock and a temp name that is unique per thread.
- **The smoke gate can't catch this.** `smoke-macos-bundle.sh` allows 60 to 120 s per call.

## 2. Measurements (Linux, this machine, 2026-10-18)

Each variant was built with the same PyInstaller flags as `scripts/bundle-worker.sh`, into `/tmp/arbor-perf`. Each command ran 10 times against an empty git library. `claude`, `codex`, and `grok` were never invoked (no `check-auth` or `list-providers`).

| Variant | `--version` median | `library-show` median | `sync --show` median | Size |
|---|---:|---:|---:|---:|
| **Shipped: PyInstaller `--onefile`** | **830 ms** | **902 ms** | **911 ms** | 77 MB |
| PyInstaller `--onedir` | 143 ms | 216 ms | 229 ms | 173 MB |
| Source venv, new process | 64 ms | 138 ms | 144 ms | n/a |
| **Persistent process, warm** (in-process `cli.main`, 30 runs) | n/a | **4.3 ms** (p90 5.0) | **8.9 ms** (p90 10.3) | n/a |

`study-progress --action due` warm: 4.5 ms (p90 5.2). The one-time import when the persistent process starts: 103 ms.

The same onefile binary takes **4.3–5.1 s** on macOS (issue #97), against 0.83 s on Linux. The extra ~3.5 s is macOS-specific: signature registration and validation of the freshly extracted framework. **We have not yet measured onedir on macOS.** Phase 0 measures it in CI before we commit to it.

### What each option buys (Settings open = 4 calls; startup = 5)

| Architecture | Per-call cost (Linux measured / macOS projected) | Settings open | Window frozen? |
|---|---|---|---|
| Today | 0.9 s / ~5 s | 3.6 s / ~20 s | **Yes, for the whole duration** |
| Phase 1 only (async dispatch) | same | same latency | No |
| + Phase 2 (onedir) | 0.2 s / est. 0.3–0.6 s | 0.9 s / est. 1–2.5 s | No |
| + Phase 3 (persistent worker) | ~5–10 ms | ~25 ms + provider probe | No |
| + Phase 4 (fewer calls) | ~5–10 ms | 1–2 calls, cached | No |

Phase 3 is the only option that meets the issue's target of under 200 ms for cached metadata and grade operations, on every platform. Phase 2 alone misses it on Linux (216 ms), and almost certainly on macOS. Phase 2 still matters, because long jobs, chat, and auth probes keep spawning processes.

## 3. Alternatives considered and rejected

| Option | Why not |
|---|---|
| **Port hot read paths to Rust** (library-show, sync show, study-progress due/weak/grade) | Latency would be ~0 ms, but a persistent Python worker already gets ~5 ms, well under the target. Porting duplicates the spaced-repetition scheduling and the library-role logic in two languages, and they will drift. The Rust side already reads some JSON natively (`read_study_json`, `list_courses`). Keep it to pure file reads. |
| **Embed Python in the app (PyO3)** | Same warm latency as a persistent subprocess. In exchange, a crash in PyMuPDF takes down the window, the GIL contends with the app, and macOS signing and packaging get harder. A subprocess keeps the crash isolation we have today. |
| **Nuitka or another compiled worker** | Still pays for a process per call, and the onefile mode has the same extraction problem. It's a big toolchain change for an improvement that onedir plus persistence already exceeds. |
| **Pre-warm one onefile process at launch** | Pays ~5 s once. Every job, auth probe, and chat still pays ~5 s, so it doesn't replace Phase 2. |
| **A Rust cache in front of the spawning worker** | Hides repeat reads but not the first one, and it needs invalidation hooks for every write path. Phase 4 adds targeted caching where it is safe. |

**Recommendation:** stay with the current architecture (Tauri, plus a Python subprocess worker) and make it **two-tier**:

- **Short requests** (reads, metadata, grades, settings) go to one long-lived `arbor-worker serve` process over NDJSON on stdio.
- **Long jobs** (update, generate, embed, chat, remote SSH) keep their current one-process-per-job model. It already streams events and supports cancellation.

The worker is packaged as onedir inside the app bundle.

## 4. Phases

### Phase 0: benchmark harness (prerequisite)

- `scripts/bench-worker.sh <worker-binary> [runs]`: runs `--version`, `library-show`, `sync --show`, and `study-progress due` against a temp git library. It prints min, median, p90, and max, and never invokes provider CLIs.
- `macos-dmg.yml`: build both a onefile and an onedir worker, run the bench on both, and upload the results as an artifact. **This is the macOS proof for Phase 2.** Continue only if onedir's macOS median is ≤ 1 s. Otherwise go straight to Phase 3 and keep onefile for jobs.
- Rust: a `debug`-level log line per command with its duration (`ARBOR_PERF=1`), so latency can be read from the packaged app's log.

### Phase 1: get the main thread free (fixes the beachball) → 5.1.0

Files: `desktop/src-tauri/src/commands.rs`, `worker.rs`, `lib.rs`, `Cargo.toml`.

1. Make every command that spawns a process or does git or file I/O `pub async fn`. Wrap the body in `tauri::async_runtime::spawn_blocking`, so the existing sync helpers stay unchanged and testable. Commands that take `State<'_, …>` must return `Result` (a Tauri async rule). Clone the state's `Arc` before moving it into the closure.
2. `run_worker_json` gets a **deadline**: spawn, read stdout and stderr on threads, then `wait_timeout`. On timeout, kill the child and return `"worker timed out after Ns"`. Defaults are 20 s for metadata, 15 s for auth, and 60 s for `sync_now` and `reindex`. Add the `wait-timeout` crate, or use `tokio::process` with `kill_on_drop(true)`.
3. **Bound concurrency** with a semaphore of 3 around local worker spawns, so a burst from the course overview can't start N processes at ~5 s each.
4. Move the `check-auth` gate in `start_update`, `start_study_job`, and `start_chat` inside the same async path, and reuse the Phase 4 auth cache once it exists.
5. Python: in `study_progress._write_atomic`, add a thread id or uuid to the temp name. Add a per-root progress lock (`fcntl.flock` on `.arbor/progress.lock`). Phase 1 can now run a grade and a quiz write at the same moment, so the lock prevents a lost update.

Regression checks:
- A Rust test that runs a fake worker sleeping 30 s and checks that the timeout fires and the child is killed.
- A Python test where two concurrent grades both persist.
- Manual check on macOS: set `ARBOR_WORKER` to a `sleep 10` script, open Settings, then move and resize the window and switch tabs. There should be no beachball.

### Phase 2: onedir packaging → 5.1.0 (if Phase 0 passes)

Files: `scripts/bundle-worker.sh`, `desktop/src-tauri/tauri.bundle.json`, `worker.rs` (`packaged_sidecar`), `scripts/smoke-macos-bundle.sh`, `release-macos.yml`, `macos-dmg.yml`.

- Build `--onedir`. Ship `arbor-worker/` under `bundle.resources` (Tauri `externalBin` only takes single files). Resolve it from `resource_dir()/arbor-worker/arbor-worker` in `packaged_sidecar`. Keep onefile as a fallback for one release behind `ARBOR_WORKER_ONEFILE=1`.
- Signing: Tauri's ad-hoc signing must cover every Mach-O in the folder. Add a `codesign --force --sign - --deep` pass over the folder before bundling. Hardened runtime stays off, per the #95 decision. For a future Developer ID build, keep the note from the #95 plan about `disable-library-validation`.
- Expect the DMG to grow from ~77 MB to ~173 MB uncompressed, which is less after DMG compression. To cut size, drop `--collect-all pymupdf` in favor of `--collect-binaries pymupdf` plus the data files we actually need. Measure the result.
- Smoke script: assert the `--version` median is < 1 s (macOS) as a **performance gate**, not just a correctness gate.

### Phase 3: persistent worker for short requests → 5.2.0

Python (`python/src/arbor_worker/serve.py`, new):
- `arbor-worker serve` reads one JSON request per line from stdin: `{"id", "argv", "env"}`. It writes one response line `{"id", "exit", "stdout", "stderr"}`. It reuses `cli.main(argv)` with `contextlib.redirect_stdout/stderr` and catches `SystemExit`, so **no command code changes**. The measurements in §2 used exactly this mechanism.
- Requests run one at a time in a single thread. Warm requests take ≤ 10 ms, so serial order is safe and fast, and it also serializes writes.
- The allow-list of serve-eligible commands: `library-show`, `sync --show`, `study-progress *`, `study-plan`, `append-card`, `list-models`, and `skill-index`. Everything else is rejected with `exit: 64` and falls back to a spawn.
- `env` (provider secrets) is applied per request and restored after it. `os.chdir` is never used, and all commands take `--root`.

Rust (`desktop/src-tauri/src/worker_pool.rs`, new):
- `WorkerPool` is held in Tauri state. It lazily spawns `serve` on the first request and pre-warms it after `loadSettings`.
- It keeps a `HashMap<id, oneshot::Sender>` and a writer mutex. A reader thread dispatches responses.
- Per-request deadline: on timeout, kill and respawn the server and fail the in-flight requests.
- On crash or EOF: respawn once and retry **reads only**. Grades and writes are not retried automatically; they return an error, and the UI's existing retry path handles them.
- The server exits after 10 minutes idle, and is killed on app exit (`RunEvent::Exit`).
- `ARBOR_WORKER_NO_SERVE=1` turns the pool off and goes back to spawn-per-call. It is the escape hatch.
- `run_worker_json_app` sends to the pool when the subcommand is on the allow-list. All call sites keep working unchanged.

Regression checks:
- Pool unit tests with a fake `serve` script: ordering, timeout, respawn, and a write that is not retried.
- A Python test for `serve` round-trips and isolation: env vars don't leak between requests, and a `SystemExit` comes back as an exit code.
- Bench target: warm `library-show` and `study-progress grade` under 50 ms end-to-end through Tauri on macOS.

### Phase 4: do less work → 5.2.0

Files: `desktop/src/main.ts`, `python/src/arbor_worker/commands.py`, `cli.py`.

- `refreshSyncUi`: run `sync_show`, `get_knowledge_settings`, and `library_show` with `Promise.all`. Call `applyEffectiveProviderForActiveRoot` only on startup, on a root switch, or after a provider or library change, **not** every time Settings opens.
- **Only the chosen provider is ever checked (decided 2026-10-18).** `loadProviders` (main.ts:2871) calls `list_providers`, which probes the status and models of **every** provider: codex, claude, and grok CLI auth (up to 10 s each), plus ollama and lmstudio over HTTP. The frontend then keeps only `id` and `label` and throws the rest away (main.ts:2877). Those names are already hard-coded in the frontend (`PROVIDER_FALLBACK`, main.ts:2815).
  - The Settings picker is built from that static list, so opening Settings makes no worker call for it.
  - The user picks the provider they use in Settings (`settings.provider_id`, which already exists). That provider, or the shared library's pinned provider when one is set, is the **only** one probed: one `check_auth` and one `list_models`.
  - Remove the `list_providers` call from the UI. Keep the command for the CLI and tests.
- `loadModels`: called only when the chosen provider changes, on a root switch (`.arbor/models.json` may differ), or when the user presses refresh. The result is cached per provider and root. CLI providers read a static catalog file. Ollama and LM Studio query their local server.
- **Sign-in cache, 60 s (decided 2026-10-18).** Keep one `{provider, result, checkedAt}` entry. Any caller (focus, Generate, chat, Update) inside 60 s gets the cached result with no worker call. There is **no background polling**. After 60 s, the next caller that actually needs auth checks again. Changing provider, or a job failing with "not authenticated", clears the cache. Rust keeps the same cache (`AuthCache` in Tauri state), so the job-start gate in `start_update`, `start_study_job`, and `start_chat` reuses it instead of spawning its own `check-auth`.
- **Study writes go through a middleman (decided 2026-10-18).** Every study interaction updates the screen immediately and saves in the background. This covers flashcard grades, quiz answers, and "make card". New module `desktop/src/study-writes.ts`:
  - `enqueue(write)` applies the change to the in-memory state, so the UI advances at once, and appends the write to a queue.
  - One drain loop sends the writes to `study_progress` in order, one at a time per root. That keeps due dates and streaks correct, and the Phase 1 lock still guards the file.
  - On failure it retries with backoff (1 s, 5 s, 30 s). The queue is mirrored to `localStorage`, so pending grades survive a crash or the app quitting and are replayed on the next launch.
  - A small "N unsaved" indicator appears only while writes have been failing for more than ~5 s, with a Retry button. Writes are never dropped silently.
  - The queue is flushed (awaited, with a short deadline) before a root switch and before `due` is re-read, so a re-read never shows stale counts.
  - What changes:
    - `gradeCurrentFlashcard` (main.ts:1617) stops awaiting `invoke` and stops gating on `flashcardGradeInFlight`.
    - The quiz's ad-hoc `progressWrite` chain (main.ts:3897) moves into the queue. Today it only logs failures and loses the answer.
  - **Depends on Phase 1.** Until the commands are async, a "background" `invoke` still freezes the window on the Rust side.
- Course overview: one `study-progress --action overview` call returns due, weak, recommend, and stale flags together, instead of the separate calls at main.ts:1304, 1416, 1574, and 1575.
- `cli.py`: handle `--version` before the registry import. This is cheap (−40 ms per spawn) and is the issue's lazy-import item, at its real size.

## 5. Acceptance benchmarks (before and after, on the packaged macOS DMG via CI, and on Linux locally)

Run each 10 times and record median and p90. The cold run is the first run after a reboot or a fresh install.

| Scenario | Today (macOS) | Target |
|---|---|---|
| Cold app start → course list visible | ~25 s est. (5 serial spawns) | < 2 s |
| Repeated metadata read (`library_show`) | 5.1 s | < 50 ms warm |
| Open Settings | ~20 s est. | < 300 ms (probes stream in after) |
| Course or tab switch | multi-second | < 200 ms to content, panels fill in on their own |
| Flashcard grade or quiz answer → next item | ~5 s | < 50 ms visible, every time, even if the worker is slow or down. Saved in the background. Zero lost writes across a forced quit |
| Window refocus | 5 s auth spawn | 0 spawns if checked < 60 s ago |
| Providers probed when Settings opens | all 5 (codex, claude, grok, ollama, lmstudio) | 0. Only the chosen one, and only when its 60 s sign-in cache is stale |
| Responsiveness during a slow worker (`sleep 10` fake) | beachball | no beachball. Drag, resize, and tab changes respond < 100 ms |

## 6. Risks

- **Onedir signing on macOS.** This is what broke #95. Mitigation: the Phase 0 CI build and the smoke test run against the real DMG before merge, plus the onefile fallback flag for one release.
- **Persistent-worker state leaks** (module-level caches, env). Mitigation: per-request env restore, an allow-list of read and small-write commands, the idle exit, and the `NO_SERVE` escape hatch.
- **Stale caches in the UI.** Mitigation: invalidate on the existing `start_folder_watch` events, on root switch, and after any write command. TTL only for auth and provider status.

## 7. Relation to the 6.0.0 UI rebuild

Phases 1–3 sit entirely in Rust and Python. They carry over to the React UI unchanged, and they are what make react-query's caching actually fast. Phase 4's `main.ts` edits are deliberately small: TTL, `Promise.all`, model reuse, and the optimistic grade. In 6.0.0 they become react-query `staleTime` and `invalidateQueries` settings. Don't wait for 6.0.0 to fix this.
