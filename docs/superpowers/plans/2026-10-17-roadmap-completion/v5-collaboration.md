# Version 5 — collaboration (`v0.4.1` … `v0.5.0`)

`PROJECT.md` lists: cloud sync, shared libraries, team workspaces, plugin marketplace, skill marketplace, shared AI providers, permissions, remote workers. No GitHub issues exist yet — open one per slice when it starts. Defaults below follow the non-goals (no required cloud, no vendor formats, Markdown is the source of truth). Change a default before its slice starts, not mid-slice.

## `v0.4.1` — git remote sync

- Settings → Sync: remote URL per Knowledge root (`git remote add arbor …`), Sync now, optional sync after each committed job.
- Sync = `fetch` → `rebase` (or merge for shared roots) → `push`. Conflicts in Markdown are surfaced in a conflict view listing files; the user picks theirs/mine or opens the file. Derived files (`_arbor_cache`, `.arbor/*.db`, vector DB) are `.gitignore`d and rebuilt after pull (reindex + re-embed jobs).
- Credentials come from the user's git/ssh config; Arbor stores none.
- Tests: Rust/Python against temporary bare repos (clean pull, fast-forward, conflict).

## `v0.4.2` — shared libraries + team workspaces

- A **workspace** is a list of Knowledge roots in app settings, each `personal` or `shared` (shared = has an `arbor` remote and an `.arbor/library.json` with `{name, members[], created_by}`).
- Sidebar groups courses by workspace root; switching roots is one click.
- Join a library: paste a git URL → clone into a chosen folder → added as shared.
- Per-user state (flashcard progress, chat history) moves to `.arbor/users/<git-email>/` so shared roots do not fight over progress.

## `v0.4.3` — skill + plugin packages, marketplace

- Formalize the skill protocol from Version 3 (`skills/base.py`, `skills/manifest.py`) as a package: `arbor-skill.json {id, version, entry, inputs, outputs, permissions}` + Python module.
- Install from git URL at a pinned commit into `~/.local/share/arbor/skills/<id>/`; loaded by the worker's skill registry; never executed without the user confirming the declared permissions.
- Marketplace = a static `index.json` in a git repo (default `MrF1ow/arbor-marketplace`), browsed in Settings → Skills. Plugins (UI-side) are out unless a later spec needs them; "plugin marketplace" ships as the same index with `kind: provider | skill`.
- Ship one first-party package through the marketplace (e.g. Anki export from Future Ideas) to prove the loop.

## `v0.4.4` — permissions + shared provider profiles

- `library.json` members get roles: `owner`, `editor`, `viewer`. Enforcement is advisory in-app (viewers cannot run write jobs or push) plus server-side through the git host's own permissions; document that Arbor cannot enforce beyond the remote.
- Shared provider profile: `library.json.provider = {id, model}` recommended for the library; members can override locally. No credentials are ever shared.

## `v0.4.5` — remote workers

- Worker transport abstraction in `worker.rs`: `Local` (today) and `Ssh {host, worker_cmd, remote_root}`.
- Remote job: rsync the course sources up, run `arbor-worker` over SSH with the same NDJSON events, rsync results back, then the normal local commit.
- Settings → Workers: add host, test connection (runs `arbor-worker --version`).
- Tests: transport trait with a fake; live test against `localhost` over SSH if sshd is available.

## `v0.5.0` — close

Append to [linux-live-run.md](linux-live-run.md). Two "machines" = two Knowledge clones (two OS users or two folders with different `user.email`) against one bare remote:

| # | Box |
|---|-----|
| C1 | A imports a lecture and syncs; B pulls and sees the digest, search and embeddings rebuilt |
| C2 | Both edit the same digest → conflict view → resolved, pushed |
| C3 | Per-user progress isolated |
| C4 | Install the marketplace skill, run it, uninstall |
| C5 | Viewer role cannot run write jobs |
| C6 | Remote worker over SSH to localhost digests a PDF |

Fix findings, bump `0.5.0`, tag **`v0.5.0`**. Update `PROJECT.md` with what shipped and move the remaining Future Ideas into a fresh roadmap.
