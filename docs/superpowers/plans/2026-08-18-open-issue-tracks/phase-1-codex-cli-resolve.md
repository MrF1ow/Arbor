# Phase 1: Codex CLI resolve and auth timeout

Back-link: [overview.md](overview.md)

## Goal

GUI and worker use one resolved Codex binary. A hung `codex login status` becomes a visible timeout, not a stuck check. `codex exec` uses that same path.

## Changes

- Modify `python/src/arbor_worker/auth.py` to resolve the command with `which("codex")`, then `~/.local/bin/codex` when that path is executable. Put a 10 second timeout on `codex login status`. Surface timeout as `AuthResult.ok is False` with a timeout reason.
- Modify `python/src/arbor_worker/provider/codex.py` so `build_argv` starts with the resolved command, not the string `"codex"`. Availability already goes through `check_codex_auth`. Keep it that way.
- Modify `python/tests/test_auth.py` for PATH hit, home fallback, missing both, timeout, and that `login status` argv uses the resolved path.
- Modify `python/tests/test_provider_codex.py` so `build_argv` `argv[0]` is the resolved command, not the string `"codex"`.

Do not edit the desktop in this phase.

## Data structures

- `resolve_codex_command(which, home: Path | None = None) -> str | None`
- `AuthResult` stays `{ok: bool, reason: str}`

## Verification

**Static.** `cd python && uv run pytest -q tests/test_auth.py tests/test_provider_codex.py tests/test_cli.py`

**Runtime.** No control-ui skill. Approximate a GUI launch by running `env -i HOME="$HOME" PATH="/usr/bin:/bin" uv run arbor-worker check-auth` from `python/` when Codex lives only at `~/.local/bin/codex`. Expect authenticated JSON, not "not found on PATH".
