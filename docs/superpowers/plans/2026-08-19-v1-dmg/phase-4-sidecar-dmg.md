# Phase 4: Sidecar worker and DMG workflow

Back-link: [overview.md](overview.md)

## Goal

A packaged Mac app runs `arbor-worker` from a Tauri sidecar, not `uv`. A GitHub Actions `macos-latest` job builds a DMG.

## Changes

- `scripts/bundle-worker.sh` (PyInstaller onefile)
- `tauri.bundle.json` merge config for `externalBin` and the `dmg` target, so `tauri dev` still uses `uv`
- `worker.rs` prefers an existing sidecar binary, then `ARBOR_WORKER_CMD`, then `uv`
- `.github/workflows/macos-dmg.yml`
- README download vs clone

## Data structures

Argv stays `Vec<String>`. Sidecar path is an optional extra input to `resolve_worker_argv`.

## Verification

Rust unit test: sidecar path used when the file exists. This agent cannot run `tauri build --bundles dmg`. The workflow is the lever. Codex is not bundled.
