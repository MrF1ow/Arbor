# Phase 3: Confirm re-checks auth

Back-link: [overview.md](overview.md)

## Goal

Confirm cannot start an Update after Codex login has expired during the review panel.

## Changes

- `desktop/src/main.ts` Confirm handler calls `refreshAuth` and aborts if not authed
- `commands.rs` `start_update` runs `check-auth` and returns an error if not authenticated

## Data structures

None. Reuse existing auth JSON `{ authenticated, reason, docs_url }`.

## Verification

No `control-ui` here. Rust/TS change plus desktop README checklist: log out while the review panel is open, Confirm stays blocked.
