# Testing and close-out

> **Status (2026-08-19):** Verification for the program that landed in **0.2.0**. #6 close-out still needs a GitHub comment if that issue is open.

Back-link: [overview.md](overview.md)

## Goal

Prove the three in-scope issues on real artifacts, then close #6 as design-done.

## Changes

- Update `python/README.md` and root `README.md` only where GUI Codex discovery, digest formatting, or single-digest `course.md` now differ from the page-fingerprinting docs pass.
- After fingerprinting phase 8 is on a green PR, comment on #6 that course-centric layout plus fingerprint-suggested ranges is the unit-of-work decision, remaining work lives in #21, and close #6.
- Do not start #4 or #20 from this file.

## Verification matrix

| Case | Where proven |
|------|----------------|
| PATH miss, `~/.local/bin/codex` hit | Phase 1 tests plus `env -i` `check-auth` |
| `codex login status` timeout | Phase 1 unit test with a hung runner |
| Focus does not stack auth checks | Phase 2 manual (no control-ui) |
| Prompt rules + LaTeX reject | Phase 3 pytest |
| Manifest v2 `sources` after ingest | Fingerprinting phase 8 pytest and temp repo |
| Page markers and `page_markers_version` | Fingerprinting phases 5 through 8 |
| One digest → index, two → rollup | Phase 5 pytest and temp repo |
| Review panel ranges | Fingerprinting phase 9 build plus manual |
| #6 closed with pointer | GitHub issue state |

## Manual desktop checklist

1. Launch the Tauri app without a developer-shell PATH that contains Codex. Badge is ready if `~/.local/bin/codex` exists and is logged in.
2. Focus the window repeatedly during a slow check. One check.
3. Import one lecture. `course.md` is short. Manifest is version 2 with fingerprints after wave 2.
4. Append pages to that PDF. Review shows a tail range. Confirm writes a marked digest and does not duplicate the whole course notebook.

## Project commands

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm run build
```

**Surface gap.** No `control-ui` or `control-cli` skill is wired for this Tauri plus worker stack. Manual desktop steps stay in this file until a project verify skill exists.
