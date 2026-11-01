# Release 2 — `v0.2.5`: provider registry, Claude CLI, Grok CLI

Branch: `feat/cli-providers`. This is the prerequisite for every live run, because Codex cannot be run here.

## Current state

- `python/src/arbor_worker/provider/base.py` already defines the `CliProvider` protocol (`is_available`, `list_models`, `run(ProviderRequest) -> ProviderResult`).
- Only `CodexCliProvider` and `FakeProvider` exist. `cli.py` hard-codes `choices=["codex", "fake"]`; `commands.py` branches on `args.provider == "codex"`.
- Auth/discovery is Codex-specific in `auth.py` (`resolve_codex_command`, `check_codex_auth`, `gui_path`).
- Rust hard-codes `"codex"` in `worker.rs` (generate args) and "Codex CLI is not authenticated" in `jobs.rs` / `commands.rs`.
- UI: `#codex-status`, `#codex-label`, `#codex-docs`, single `#model` select; models come from `.arbor/models.json` or `DEFAULT_MODELS` (GPT ids).

## Python worker

1. **Generalize discovery** in `auth.py`: `resolve_cli_command(name, which, home, extra_dirs)` and `check_cli_auth(argv, …)`; keep `resolve_codex_command` / `check_codex_auth` as thin wrappers so existing tests stay green. Add `~/.grok/bin` to the extra bin dirs.
2. **Registry** `provider/registry.py`: `PROVIDERS = {"codex": …, "claude": …, "grok": …, "fake": …}`, each entry = class + default models + docs URL + auth argv. `cli.py` builds `choices` from it; `commands.py` uses `make_provider(name, root)` instead of the if-chain.
3. **`provider/claude.py`** — `ClaudeCliProvider`:
   - argv: `claude -p --model <id> --output-format json --tools "" --no-session-persistence --setting-sources "" --strict-mcp-config`, prompt on stdin, `cwd=request.cwd`. Parse `result` from the JSON envelope; non-zero exit or `is_error: true` → `ProviderError`.
   - Images (diagrams, scanned pages): `--input-format stream-json` with base64 `image` content blocks built from `request.image_paths`.
   - Auth: `claude auth status` (exit 0 = ok).
   - **Guard:** `run()` raises `ProviderError("Claude provider disabled inside a Claude Code session")` when `os.environ.get("CLAUDECODE") == "1"`. `is_available()` returns false with the same reason. Unit test covers the guard.
   - Default models: `claude-sonnet-5-5` (Sonnet 5.5), `claude-opus-5-5` (Opus 5.5), `claude-haiku-5-5` (Haiku 5.5).
4. **`provider/grok.py`** — `GrokCliProvider`:
   - argv: `grok -p - -m <id> --output-format json --tools "" --disable-web-search --no-subagents --max-turns 1 --cwd <cwd>` (confirm whether `-p` reads stdin; if not use `--prompt-file <tmp>`). Parse the final assistant text from the JSON.
   - Images: `--prompt-json` with image content blocks.
   - Auth: `grok models` exit 0 and stdout contains "logged in".
   - Default models: `grok-4.7`, `grok-4.7-build-fast`.
   - Verify exact JSON shapes against a real call during implementation and freeze them as fixtures in `python/tests/fixtures/providers/`.
5. **Settings:** `WorkerSettings.provider: str = "codex"`; `.arbor/models.json` gains an optional per-provider map `{"providers": {"grok": [...], "claude": [...]}}` while the old flat `{"models": [...]}` keeps meaning Codex. New worker command `list-providers` → `[{id, label, available, reason, docs_url, models}]`.
6. Tests: argv building, JSON parsing from fixtures, auth success/failure/timeout, `CLAUDECODE` guard, registry choices, settings back-compat. All with injected `runner`/`which`; nothing spawns a real CLI.

## Rust

- `settings.rs`: persist `provider_id` next to `model_id`.
- `worker.rs`: pass `--provider <provider_id>` instead of the literal `"codex"`; update `generate_args_use_codex_and_model_when_selected` and add a grok case.
- `commands.rs`: `list_providers` command; `list_models` takes `provider`. Auth error strings become `"{label} is not authenticated"`.
- `jobs.rs`: auth gate uses the selected provider's `available`/`reason`.

## Desktop UI

- Settings: Provider select above Model; changing it reloads models.
- Top bar: `#codex-status` → `#provider-status` showing "Grok 4.7 · ready" / "Claude · not signed in" with the provider's docs link.
- Rename copy that says "Codex" to the provider label (`auto-update waiting for Codex auth` etc.).
- Tests for the provider select, status badge states, and job args.

## Docs

`README.md` + `desktop/README.md` prerequisites: "one of Codex CLI, Claude Code, or Grok CLI, signed in". `PROJECT.md` providers list marks Codex/Claude/Grok CLI as shipped.

## Live smoke (agent-safe)

With `npm run tauri dev`, select **Grok / grok-4.7**, add one small PDF to a scratch Knowledge folder (`/tmp/arbor-live/Knowledge`), Update, confirm a digest. Never select Claude in an agent session — the guard would refuse anyway. The user can verify Claude themselves from a normal terminal.

Tag `v0.2.5`.
