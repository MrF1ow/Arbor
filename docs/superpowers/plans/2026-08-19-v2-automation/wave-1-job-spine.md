# Wave 1: Job spine

**Status:** in progress (PR 1)

## Goal

Every Update is a tracked, single-flight job with persisted JSONL events and a minimal history panel.

## Data shapes

- `Job` row in `.arbor/arbor.db`
- `JobCoordinator` mutex in Tauri state (one active run)

## PRs

| PR | Work | Verify |
|----|------|--------|
| 1.1 | SQLite init, `jobs` + `job_events` tables | Pick folder, `.arbor/arbor.db` exists |
| 1.2 | Job create, single-flight mutex, wire `start_update` | Second Update while running returns error |
| 1.3 | Append JSONL lines to `job_events`; finish on worker exit | Job row terminal status after run |
| 1.4 | History panel in desktop UI | Past runs visible after restart |

## Files

- `desktop/src-tauri/src/db.rs`
- `desktop/src-tauri/src/jobs.rs`
- `desktop/src-tauri/src/commands.rs`
- `desktop/src-tauri/src/worker.rs`
- `desktop/src/main.ts`, `desktop/index.html`
