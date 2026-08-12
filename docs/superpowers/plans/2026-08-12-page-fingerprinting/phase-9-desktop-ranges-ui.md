# Phase 9: Desktop ranges review UI

Back-link: [overview.md](overview.md)

## Goal

Replace the single start-page input with editable range lists driven by plan suggestions, and pass ranges through Tauri into the worker plan file.

## Changes

- Modify `desktop/src/types.ts` and `desktop/src/main.ts` for `suggested_ranges`, `alignment_status`, and range collection on Confirm.
- Adjust styles as needed for multi-range editing (keep the existing single-screen review; no settings surface).
- Modify `desktop/src-tauri/src/commands.rs` `Selection` / plan body to emit `ranges` instead of `start_page`.
- Update any desktop Rust tests; ensure `plan_update` still streams worker JSON unchanged aside from schema.
- Ambiguous status: show short note and weak/empty prefill; blank ranges still mean full-file ingest.

## Data structures

- Frontend `PendingSource` mirrors worker plan dict ranges
- `Selection`: `{ path: string, ranges: [number, number][] | null }`

## Verification

**Static.** `cd desktop/src-tauri && cargo test` and `cd desktop && npm run build`

**Runtime.** Manual checklist in [testing.md](testing.md): open review on clean-append fixture; confirm pre-selected tail range; Confirm writes plan with ranges; progress log shows range work. **Gap:** no in-repo `control-ui` skill for Tauri; manual only unless the team adds one later.
