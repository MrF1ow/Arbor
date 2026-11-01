# Roadmap completion — Version 3 close through Version 5

**Date:** 2026-10-17
**Starting point:** `main` at `9cd2747`, package `0.2.3`, tag `v0.2.3`.
**Goal:** finish every remaining roadmap item in [`PROJECT.md`](../../../../PROJECT.md) — Version 3 close, Version 4 (tutor), Version 5 (collaboration) — and tag `v0.3.0`, `v0.4.0`, `v0.5.0` along the way.

## Decisions that change the existing gates

1. **Mac batches no longer gate tags.** The gate becomes a recorded **Linux live run** of the real Tauri app on this machine (see [linux-live-run.md](linux-live-run.md)). Mac proof becomes optional and non-blocking; open Mac boxes move to a "Mac (optional)" column. `PROJECT.md` → *Test gates* and the checklist *Gates* table are rewritten in release 1 so the docs never contradict the tags.
2. **Codex is not testable here** (no subscription). Live runs use the **Grok CLI** provider. Codex stays supported and unit-tested with fakes.
3. **Arbor never calls Claude Code from a Claude Code session.** The Claude CLI provider is added for the user, but agents never select it in a live run. Enforced in code: the Claude provider refuses to run when `CLAUDECODE=1` is in the environment (set by Claude Code for child processes), with the message "Claude provider disabled inside a Claude Code session". Unit tests use an injected runner and never spawn `claude`.
4. One PR per release slice, branch off `main`, squash-merge, then tag. Every PR runs the local command set:

   ```bash
   cd python && uv run pytest -q
   cd desktop/src-tauri && cargo test
   cd desktop && npm test && npm run build
   ```

## Release map

| # | Tag | Era | Slice | File |
|---|-----|-----|-------|------|
| 1 | `v0.2.4` | V3 | Brand: new tree mark everywhere; gate policy rewrite | [r1-brand-and-gates.md](r1-brand-and-gates.md) |
| 2 | `v0.2.5` | V3 | Provider registry + Claude CLI + Grok CLI providers, provider picker in Settings | [r2-providers.md](r2-providers.md) |
| 3 | **`v0.3.0`** | V3 close | Linux live run of the whole V1–V3 surface with Grok; fix findings; close issues | [r3-v3-close.md](r3-v3-close.md) |
| 4 | `v0.3.1` | V4 | Chat worker: retrieval + grounded prompt + citations (CLI only) | [v4-tutor.md](v4-tutor.md) |
| 5 | `v0.3.2` | V4 | Chat tab: history, streaming, modes, clickable citations | [v4-tutor.md](v4-tutor.md) |
| 6 | `v0.3.3` | V4 | Review scheduling (due dates from grades) + weak-topic detection | [v4-tutor.md](v4-tutor.md) |
| 7 | `v0.3.4` | V4 | Study plans, recommendations, make-card-from-selection | [v4-tutor.md](v4-tutor.md) |
| 8 | `v0.3.5` | V4 | API/local providers: Ollama, LM Studio, OpenAI API, Anthropic API | [v4-tutor.md](v4-tutor.md) |
| 9 | **`v0.4.0`** | V4 close | Tutor acceptance live run (grounded, cited, refuses unsupported) | [v4-tutor.md](v4-tutor.md) |
| 10 | `v0.4.1` | V5 | Git remote sync (the local-first "cloud sync") | [v5-collaboration.md](v5-collaboration.md) |
| 11 | `v0.4.2` | V5 | Shared libraries + team workspaces | [v5-collaboration.md](v5-collaboration.md) |
| 12 | `v0.4.3` | V5 | Skill/plugin packages + marketplace index | [v5-collaboration.md](v5-collaboration.md) |
| 13 | `v0.4.4` | V5 | Permissions + shared provider profiles | [v5-collaboration.md](v5-collaboration.md) |
| 14 | `v0.4.5` | V5 | Remote workers | [v5-collaboration.md](v5-collaboration.md) |
| 15 | **`v0.5.0`** | V5 close | Two-machine collaboration live run | [v5-collaboration.md](v5-collaboration.md) |

Each tag: bump `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, `python/pyproject.toml` (+ `uv.lock`), add a `CHANGELOG.md` section, update the checklist rows, merge, `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`. The existing `release-macos.yml` keeps building DMGs on tags; nobody waits on a Mac run.

## Issue disposition

| Issue | Closes at |
|-------|-----------|
| #3, #19, #21, #42, #57, #30 | `v0.3.0` (code already on `main`; Linux live run is the proof) |
| #4 | `v0.3.0` (DMG built by CI; Finder proof optional) |
| #20 | `v0.4.0` |
| New issues filed per V5 slice | their slice tag |

## Open decisions (defaults chosen; override before the slice starts)

- **Cloud sync backend (r10):** default is git remotes (GitHub/Gitea/any SSH remote). No hosted Arbor service. Keeps "Markdown is the source of truth" and the non-goal "require cloud infrastructure".
- **Marketplace (r12):** default is a static JSON index in a git repo, packages installed from git URLs with a pinned commit. No payment, no hosted registry.
- **Remote workers (r14):** default is the same `arbor-worker` binary run over SSH (`ssh host arbor-worker …` with the existing NDJSON event stream). No new daemon protocol.
