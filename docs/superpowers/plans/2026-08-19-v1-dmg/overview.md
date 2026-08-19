# Arbor 1.0: coverage polish and downloadable DMG

> **Playbook:** poteto-mode figure-it-out + multi-phase plan. Execute in this program. Do not start #20.

**Predicate:** leftover pages stay pending after a partial ingest; a failed course rollup does not orphan digests or duplicate them; course synthesis prompts include digest `_RULES`; Confirm re-checks Codex auth; a macOS GitHub Actions job can build a DMG that launches the worker as a sidecar. Codex CLI stays external.

## Context

0.2.0 on `main` is the Version 1 loop. A classmate still cannot download an app. Partial ingest of pages 3–4 stores the whole-file hash, so leftover pages look current. A two-digest rollup failure leaves digest files with no `arbor-course.json`. Confirm does not re-check auth.

This VM is Linux. It cannot produce a notarized `.dmg`. The packaging phase lands sidecar wiring plus a `macos-latest` workflow. The first downloadable file comes from that workflow, not from this agent.

## Scope

**In**

- `is_current` requires complete fingerprints when a `sources` entry exists
- Plan leftover uncovered pages as suggested ranges
- Save and commit digest records if course synthesis fails; write a link-only `course.md` fallback
- Put digest `_RULES` on the course rollup prompt
- Confirm (and `start_update`) re-check auth
- PyInstaller sidecar, Tauri `externalBin`, GitHub Actions DMG job
- Docs: how to download vs how to run from a clone

**Out**

- #20 chat
- PROJECT.md Version 2 (watchers, search, extra providers)
- Windows/Linux installers
- Bundling Codex
- Apple notarization secrets (workflow can skip signing until secrets exist)

## Constraints

- Python 3.11+ worker, existing pytest
- Tauri v2. Codex remains an external binary
- Fingerprints stay in committed `arbor-course.json`
- `v1` manifests without a `sources` map still treat hash match as current

## Alternatives

1. **Sidecar PyInstaller + GHA macos-latest** (chosen). Matches the deferred desktop plan. Dev still uses `uv`.
2. Embed CPython in the app resources and `uv run` from there. Heavier, still needs a Python layout.
3. Require users to install `uv` even for the DMG. Rejected. That is not a downloadable app.

## Phases

1. [phase-1-incomplete-coverage](phase-1-incomplete-coverage.md)
2. [phase-2-synthesis-and-rules](phase-2-synthesis-and-rules.md)
3. [phase-3-confirm-auth](phase-3-confirm-auth.md)
4. [phase-4-sidecar-dmg](phase-4-sidecar-dmg.md)

## Verification

```bash
cd python && python3 -m pytest -q
cd desktop && npm run build
```

DMG: GitHub Actions `macos-latest` artifact. Flag: no `control-ui` on this Linux agent; desktop Confirm auth is a code-path change plus the existing manual checklist.

## Implementation guidance

- **how** over `planning.py`, `pipeline.py`, and `worker.rs` before edits
- **prove-it-works:** pytest for coverage and synthesis; Rust unit test for sidecar argv
- `/deslop` before commit. **unslop** README and CHANGELOG
- Do not bump package version to 1.0.0 until a DMG artifact exists
