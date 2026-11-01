# Issue #95: macOS DMG worker fails to start; provider CLIs not detected

Target release: **0.5.1** (patch). Branch: `fix/issue-95-macos-worker`.

## Root causes

1. **Signing (confirmed in the issue).** Tauri signs the bundle ad-hoc (`APPLE_SIGNING_IDENTITY: "-"`) with hardened runtime on, its default. The PyInstaller onefile `arbor-worker` sidecar unpacks `Python.framework/.../Python` into `_MEI…` at runtime. With hardened runtime, library validation refuses to map it ("different Team IDs"), so the worker exits 255 before Python starts. Every worker call then fails with `worker produced no output`: library, settings, weak topics, models, and auth.
2. **CLI discovery from a GUI launch.** Apps started from Finder get launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Rust `augmented_path_from` (desktop/src-tauri/src/worker.rs) adds only `~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`. Python `extra_bin_dirs` (python/src/arbor_worker/auth.py) adds `~/.grok/bin` too. CLIs installed through nvm, volta, bun, npm-global prefixes, or `~/.claude/local` are still missed.
3. **Misleading UI.** When the worker can't start, `refreshAuth` (desktop/src/main.ts) throws away the error and shows "auth check failed", which reads like a sign-in problem.

## Changes

### A. Signing (fixes cause 1)
- `desktop/src-tauri/tauri.bundle.json`: add `"macOS": { "hardenedRuntime": false }` under `bundle`. Tauri CLI 2.11 supports this key (see config.schema.json). This build is ad-hoc signed and not notarized, so it gives up nothing. A Developer ID or notarized build later will need hardened runtime plus entitlements (`com.apple.security.cs.disable-library-validation`) and PyInstaller `--codesign-identity`. Note that in a comment in the plan or docs only; JSON has no comments.

### B. Release smoke gate (catches cause 1 in CI)
- New `scripts/smoke-macos-bundle.sh <path-to-.app-or-.dmg>`:
  - If given a `.dmg`, `hdiutil attach -nobrowse -readonly` to a temp mountpoint and detach on exit through a trap.
  - `codesign -dv --verbose=4 <app>/Contents/MacOS/arbor-worker`: fail if the flags include `runtime`.
  - `arbor-worker --version` must exit 0 and print the version from `desktop/src-tauri/tauri.conf.json`.
  - `arbor-worker list-providers` must exit 0 and print one valid JSON line (check it with `python3 -c 'import json,sys; json.loads(...)'`).
  - Use `timeout`/`gtimeout` if one exists. Otherwise run the step plainly; GitHub's step timeout still applies.
- `.github/workflows/macos-dmg.yml` and `release-macos.yml`: after **Build DMG**, add a step that runs the script against the built `.dmg` (`desktop/src-tauri/target/release/bundle/dmg/*.dmg`). In release-macos it must run **before** publishing.

### C. CLI discovery (fixes cause 2)
- Rust `worker.rs`:
  - Add `login_shell_path()`. On macOS only (`cfg(target_os = "macos")`), run `$SHELL` (fallback `/bin/zsh`) with `-ilc 'printf "__ARBOR_PATH__%s__ARBOR_PATH__" "$PATH"'`, stdin null, with a hard 3-second timeout: spawn, poll `try_wait`, kill on timeout. Pull out the text between the markers. Cache the result in a `OnceLock`. Return `None` on any failure. Never block forever.
  - Change `augmented_path_from` to take an optional login-shell PATH. Order: login-shell entries, then home fallbacks (`~/.local/bin`, `~/.grok/bin`, `~/.claude/local`, `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`, `~/.cargo/bin`), then `/opt/homebrew/bin`, `/usr/local/bin`, then current PATH. **Dedupe** entries. Keep it a pure function so it stays unit-testable.
  - `process_path()` and the chat spawn in `commands.rs` (~line 1462) both use the same helper. No more duplicate call sites.
  - Update and add Rust unit tests for ordering, dedupe, and None/empty handling.
- Python `auth.py` `extra_bin_dirs`: add the same home fallbacks so a direct `resolve_cli_command` finds them. Update tests in `python/tests`.

### D. Error reporting (fixes cause 3)
- `worker.rs` `run_worker_json`: when stdout has no JSON and the exit status is non-zero, return `worker failed to start (exit N): <trimmed stderr tail, ≤600 chars>`. Keep `parse_worker_json_output`'s current behaviour for its existing tests, or extend it with an exit-code parameter and update the tests.
- `main.ts` `refreshAuth` catch: capture the error and set `authCheckReason` to `Arbor worker unavailable: <message>`. The badge should read as a worker problem, not "not authenticated". Hide the "Set up {provider}" docs link in this case. Add or adjust a desktop test.

### E. Release 0.5.1
- Bump to `0.5.1` in every file listed in `.cursor/rules/arbor-versioning.mdc` rule 5, plus `python/uv.lock`, `desktop/package-lock.json`, `desktop/src-tauri/Cargo.lock`, and `python/tests/test_cli.py`.
- CHANGELOG `## 0.5.1 — 2026-10-18`: list the fixes and reference #95. Update the "Current package" line.
- Add a row for `v0.5.1` to the versioning rule table.

## Verification
- Local (Linux): `cd python && uv run pytest`; `cd desktop && npm test && npx tsc --noEmit && npm run build`; `mkdir -p desktop/dist && cargo test --manifest-path desktop/src-tauri/Cargo.toml`; `bash -n scripts/smoke-macos-bundle.sh`; `shellcheck` if installed.
- macOS: the `macos-dmg` PR workflow runs the new smoke script against the real ad-hoc-signed DMG. **That is the gate for #95.**
