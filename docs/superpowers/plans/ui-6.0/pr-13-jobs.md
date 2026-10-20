# PR 13: Jobs

Branch `ui/13-jobs`, stacked on `ui/12-search`. Master plan §6.3 (the Jobs page reads per-job logs separately from the live drawer), §8 (virtualize job history), §11 row 13, Appendix B item 10. Read `README.md` in this folder first: **no browser, never launch the app window, never run `dev:mock`.**

- **Design:** the mockup has no jobs page. Use the Settings-style page language (`ShellPageHeader`, `SettingsSection` / `SettingRow`, hairlines) and the log drawer's mono log styling. It's a shell page: no course header or action bar (PR 5 route `jobs.tsx`).
- **Legacy reference:** `desktop/src/legacy/main.ts`:
  - `loadJobHistory` ~2848 and `showJobLog` ~2888
  - `updateInspectorStatus` and `statusClass` (grep for them)
  - the cancel path (`cancel_update`)
- **Data:**
  - `useJobs(root)` (`list_jobs`, limit 15) and `useJobEvents(root, jobId)` (`get_job_events`) in `src/lib/queries/jobs.ts`
  - `JobSummary` = `{ id, status, trigger_kind, model_id, started_at, finished_at, error_summary, exit_code }`
  - `JobEventRow` = `{ line, created_at }`
  - the live job state lives in `job-store` (`activeJobId`, `activeUpdateJobId`, `status`, `label`, `step`)

## Work directory
`/home/flow/Projects/personal/Arbor/.worktrees/ui-stack/desktop`

## 1. Page (`routes/jobs.tsx` → `components/jobs/jobs-view.tsx`)
- **Header:** `ShellPageHeader` "Jobs", description "Recent runs from your Knowledge folder." (legacy `index.html`: "Recent runs" / "Job history from your Knowledge folder."; use that wording). A **Refresh** ghost button refetches.
- **Before listing:** call `init_arbor_db { root }` once per root (legacy did this before `list_jobs`), so a fresh root doesn't error.
- **Two-pane layout**, wide ≥ 56rem container (narrow: stacked, with the log below the list):
  - **Left, the job list** (virtualized with `@tanstack/react-virtual` once there are more than 50 rows; the default list is ≤ 15, so the plain list is the common path). Each row is a `ListRow`-style button:
    - status dot plus status text: running = spinner + primary; succeeded = success; failed = destructive; cancelled = muted
    - the job **label**: from `trigger_kind` (`manual` → "Manual update", `watch` → "Folder watch", `study` / skill kinds → "Flashcards" / "Quiz" / …, `embed` → "Embeddings", `citations` → "Citations"). Use a pure helper `jobKindLabel(trigger_kind)`, unit-tested; unknown kinds are title-cased.
    - **started** as a relative time ("5 min ago", with the absolute local time in a tooltip) and the **duration** (`finished_at - started_at`, e.g. "2m 14s"; "running" when unfinished). Pure helpers `formatDuration` and `relativeTime(now)`, tested with fixed clocks.
    - `model_id` faint, if present
    - `error_summary` as a truncated destructive second line for failed jobs
    - the active job (`job-store.activeJobId`) is pinned or highlighted with the 2px bar while selected
  - **Right, the log viewer** for the selected job (`?job=<id>` search param, `replace` navigation; the first job is selected by default):
    - header: label, status, started, duration, and a **Copy log** icon button (clipboard; `toast.success("Copied")`)
    - body: mono `text-2xs` lines from `get_job_events`, each with a faint `created_at` time prefix; virtualized (logs can be thousands of lines); horizontal overflow wraps
    - for the **running** job, live lines append from `job-store.lines` while it's the active job: show the DB events, then follow with the live tail, and refetch events when the job finishes. Auto-scroll only when at the bottom (the log drawer's behavior).
    - empty: "No log lines for this job."
- **Cancel:** when a job is running and it's the active update job, show a **Cancel** (destructive outline) in the log header → `cancel_update` (the existing mutation). Legacy only cancels update jobs; keep that, and show no cancel for study jobs.
- **States:**
  - no root → "No Knowledge folder selected" (legacy copy) with the Choose folder action
  - no jobs → "No runs yet" (legacy)
  - error → `Could not load jobs: {error}` (legacy)
- **Refresh triggers:** invalidate `qk.jobs(root)` on `job-finished` (check that the events bridge already does; add it if not), and when a job starts (`afterStudyJobStarted` / the update start).

## 2. Action bar status (legacy `updateInspectorStatus`)
The PR 5 `StatusPill` idle text "Up to date · {relative time of last job}" should derive from `useJobs(root)[0]`, if it doesn't already. Verify and wire it, and make "Last job failed" link to `/jobs?job=<id>`. Clicking the pill when failed or idle navigates to Jobs.

## 3. Mock data
Extend `list_jobs` / `get_job_events` in the mock handlers:
- about 8 jobs: running (the id matching the mock `start_update` job when one is active), succeeded, failed with `error_summary`, cancelled, and a mix of `trigger_kind`s
- `get_job_events` returns 20–200 lines per job, depending on the id

## 4. Tests (vitest)
- The list renders the label, status, relative time, duration, model, and error line (fixed clock).
- Selecting a job loads its events and updates `?job=`; the default is the first job; the deep link `?job=` selects that job.
- The running active job: live `job-store` lines append under the DB events; a finished event refetches.
- Cancel shows only for the running update job and calls `cancel_update`.
- Copy log writes to the clipboard (mock `navigator.clipboard`).
- The no-root, no-runs, and error copy.
- `init_arbor_db` is called before `list_jobs` (call order).
- The status pill: idle text from the latest job; when failed, the link goes to `/jobs?job=<id>`.
- Pure helpers: `jobKindLabel`, `formatDuration`, `relativeTime`.

## 5. Acceptance (run all, report real results)
- `npm test` (exit 0), `npm run lint`, `npm run build` (entry ≤ 250 KB; jobs is code-split).
- **Needs visual check (Claude):**
  - Jobs at 700/1100/1600, light and dark
  - status colors
  - the log viewer with long lines
  - the running job with the live tail
  - cancel
  - empty states

## Commit
Focused commits on `ui/13-jobs`, each ending `Co-Authored-By: Composer 2.5 <noreply@cursor.com>`. Don't push. Don't create or link pull requests.
