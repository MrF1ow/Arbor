# Wave 3: Watch, auto-update, notify

**Status:** complete in #26

## Goal

Drop a file into the knowledge folder and Arbor plans (and optionally runs) an update.

## PRs

| PR | Work | Verify |
|----|------|--------|
| 3.1 | Rust `notify` on knowledge root, debounce | Drop PDF, debounced event |
| 3.2 | Debounced handler calls `plan_update`; default notify + review | Toast without auto Codex |
| 3.3 | `auto_update` setting enqueues job with suggested ranges | Silent run when enabled |
| 3.4 | Desktop notifications on job terminal states | OS notification on complete |

## Settings (`.arbor/settings.json`)

- `auto_update`: bool, default `false`
- `watch_enabled`: bool, default `true`
