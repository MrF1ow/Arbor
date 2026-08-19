# Phase 2: Desktop auth in-flight guard

Back-link: [overview.md](overview.md)

## Goal

Focus events do not stack parallel `check_auth` invokes. A stalled check cannot leave the badge on "Checking Codex…" forever. That timeout is the worker's job from phase 1. This phase only serializes the UI.

## Changes

- Modify `desktop/src/main.ts` so `refreshAuth` is single-flight. A second call while one is in flight is ignored or coalesced to one follow-up. Callers today are startup, `window` `focus`, and the Update click. Cover all three.
- Do not change Rust commands. `check_auth` already shells out to the worker.

Land this before fingerprinting phase 9, which also edits `main.ts`.

## Data structures

- Module-local in-flight flag or chained promise around `refreshAuth`. No new IPC type.

## Verification

**Static.** `cd desktop && npm run build`

**Runtime.** No control-ui skill. Manual: spam window focus while Codex is slow. One in-flight check. Badge leaves "Checking Codex…" when the worker returns or times out. Flag this gap in the PR.
