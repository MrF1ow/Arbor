# PROJECT.md

# Arbor

**Academic Knowledge System**

> A local-first desktop application that transforms educational content into a structured, searchable knowledge base using AI.

---

# Vision

The goal of this project is to make learning nearly effortless.

Instead of manually organizing notes, summarizing lectures, creating flashcards, and maintaining documentation, the application automates the entire pipeline while allowing the user to stay in complete control.

The system should:

* Import learning material
* Process it intelligently
* Generate structured knowledge
* Organize everything automatically
* Allow future AI interactions with that knowledge

The application should feel like a personal AI research assistant that continuously improves your knowledge library.

---

# Core Principles

## Local First

The user's data belongs to them.

Everything should exist locally before any optional cloud synchronization.

The application should function without an internet connection except when AI providers require one.

---

## AI Agnostic

The project should never depend on one AI provider.

Supported providers should eventually include:

* Codex CLI
* OpenAI API
* Anthropic Claude
* Google Gemini
* Ollama
* LM Studio
* Future providers

Every provider should implement the same interface.

The rest of the application should never know which provider produced the output.

---

## Modular

Every major capability should be implemented as an independent "Skill."

Skills can be added, removed, upgraded, or replaced without affecting the rest of the system.

Examples:

* PDF Processing
* PowerPoint Processing
* OCR
* Flashcard Generation
* Quiz Generation
* Diagram Extraction
* Git Sync
* Citation Validation

---

## Extensible

Future contributors should be able to add:

* new AI providers
* new importers
* new exporters
* new skills

without modifying existing code.

---

# Goals

The application should eventually be capable of:

* Reading PDFs
* Reading PowerPoint slides
* Reading Word documents
* Reading images
* OCR
* Summarization
* Knowledge extraction
* Markdown generation
* Metadata generation
* Flashcard creation
* Quiz creation
* Knowledge graph generation
* Search
* Git integration
* Automatic scheduling
* AI chat over personal knowledge

---

# Technology Stack

## Desktop UI

Tauri

Reason:

* Lightweight
* Native performance
* Cross-platform
* Small executable size
* Excellent Rust integration

---

## Backend Orchestrator

Rust

Responsibilities:

* Application lifecycle
* Window management
* Settings
* Process management
* Worker supervision
* Job queue
* File watching
* Plugin loading
* IPC with frontend

Rust should not contain AI logic.

Rust is responsible for orchestration.

---

## Worker

Python

Responsibilities:

* AI interaction
* Scheduling
* Document parsing
* OCR
* Markdown generation
* Knowledge extraction
* Skill execution
* Embeddings
* Flashcards
* Quiz generation

Python was selected because the AI ecosystem already exists.

Rewriting these capabilities in Rust would significantly slow development.

---

## Storage

Local filesystem.

Suggested structure:

```
Knowledge/

    Biology/
        Lecture 01/
            lecture.md
            metadata.json
            flashcards.json
            quiz.json

    Chemistry/

    Anatomy/

    Nursing/
```

---

## Optional Database

SQLite

Only for:

* indexing
* search
* cache
* job tracking

The database should never become the source of truth.

Markdown remains the source of truth.

---

## Git

Optional.

Git can automatically version the knowledge library.

Benefits:

* history
* rollback
* synchronization
* collaboration

---

# High Level Architecture

```
User

↓

Tauri Desktop UI

↓

Rust Orchestrator

↓

Job Queue

↓

Python Worker

↓

Skills

↓

Providers

↓

Generated Knowledge

↓

Markdown
JSON
Flashcards
Quiz
Git
```

---

# Python Worker

The worker should not become a monolithic script.

Instead:

```
python/

    worker.py

    scheduler.py

    providers/

    skills/

    jobs/

    parsers/

    models/

    utils/
```

---

# Providers

Providers abstract AI models.

```
providers/

    codex_cli.py

    openai_api.py

    claude.py

    gemini.py

    ollama.py

    lmstudio.py
```

Each provider returns the exact same object.

Example:

```
KnowledgeResult

markdown

metadata

flashcards

quiz

citations

tags
```

This allows switching AI providers without modifying downstream code.

---

# Skills

Skills are independent modules.

Example:

```
skills/

    pdf.py

    powerpoint.py

    summarize.py

    flashcards.py

    quiz.py

    citations.py

    diagrams.py

    git_sync.py
```

Each skill:

Input

↓

Processing

↓

Output

Skills should never call each other directly.

The job system coordinates execution.

---

# Job Queue

Every action becomes a Job.

Instead of:

```
Button

↓

Run Everything
```

Use:

```
Button

↓

Create Job

↓

Queue

↓

Worker

↓

Completed
```

Benefits:

* retries
* cancellation
* progress bars
* scheduling
* concurrency
* logging

---

# Suggested Pipeline

```
Import File

↓

Extract Text

↓

Clean Text

↓

AI Processing

↓

Knowledge Digest

↓

Markdown

↓

Metadata

↓

Flashcards

↓

Quiz

↓

Git Commit
```

Each stage should be replaceable.

---

# Version Roadmap

Package releases (`0.1.0`, `0.2.0`, `1.0.0`, `2.0.0`, …) are in [`CHANGELOG.md`](CHANGELOG.md).

**Done vs tested** lives in [`docs/implementation-checklist.md`](docs/implementation-checklist.md). That file is the gate: a product version does not start until the previous version’s implementation and its Mac batch are recorded. GitHub issues are mapped under each version below with their original acceptance criteria.

## Version numbering

**Product milestones** (Version 1–5 below) are capability eras. **Git tags** track what is shipped.

| Tag | Product milestone | Meaning |
|-----|-------------------|---------|
| `v1.0.0` | Version 1 | Shipped |
| `v2.0.0` | Version 2 | Shipped — automation on the v1 UI |
| `v2.1.0`, `v2.2.0`, … | Version 3 **in progress** | Incremental releases toward Version 3 |
| `v3.0.0` | Version 3 | **Reserved** — tag only when every Version 3 feature below ships **and** the Version 3 Mac batch is recorded |
| `v4.0.0` | Version 4 | Tutor milestone (future). Do not start until Version 3’s Mac batch is recorded. |

Do not tag `v3.0.0` for the shell alone, a single wave, or partial delivery. The desktop shell shipped in **`v2.1.0`** as the first step of Version 3 work. Later steps are `v2.2.0`, `v2.3.0`, … Never publish `3.1.0` or `3.2.0` as package versions.

Cursor rule: [`.cursor/rules/arbor-versioning.mdc`](.cursor/rules/arbor-versioning.mdc).

### Test gates (how versions unlock)

Local/VM tests (`uv run pytest -q`, `cargo test`, `npm test`, `npm run build`) run on every change. They are what Linux agents and CI prove.

A **Mac batch** is a single end-to-end run on a MacBook covering a whole product version (or a whole leftover batch). It is not run after every small feature. Findings from that run are filed on the [implementation checklist](docs/implementation-checklist.md). They must be fixed and re-proven locally; they ride the **next** Mac batch, not a new Mac trip per finding.

A product version is **closed** only when its required work is implemented, locally tested, and one Mac batch for that version is recorded. Until that Mac batch is recorded, the next product version does not start.

# Version 1

Goal:

Create the smallest useful application.

**Release:** 2.0.0 (`v2.0.0`). Shipped. Extended by 2.1.0+ (Version 3 shell work).

Features

* Desktop application
* Manual "Update Knowledge" button
* PDF support
* PowerPoint support
* Course folders with dated digest markdown
* `course.md` index (local copy for one digest; provider rollup for two or more)
* Page-range review, per-page fingerprints, in-place digest patch
* `arbor-pages` markers on lecture digests
* Committed `arbor-course.json` (manifest version 2)
* Local storage
* Codex CLI support
* Git commit per successful Update batch
* Basic settings (`delete_sources_after_digest`, models)

No scheduler.

No background automation.

No database.

No in-app chat (that is Version 4).

macOS `.dmg` from GitHub Actions (`macos-dmg`). The worker is a bundled sidecar. Codex CLI stays a separate install.

### GitHub issues in this version

Code for these tickets is on `main`. The tickets themselves may still be open on GitHub. Close them against this version; do not reopen Version 1 as a program. Leftover proof belongs on the [implementation checklist](docs/implementation-checklist.md) and the Version 3 Mac batch.

#### [#3](https://github.com/MrF1ow/Arbor/issues/3) — digest prompt: source boundaries and portable Markdown

Original acceptance criteria:

- New digests contain no LaTeX delimiters or commands such as `\(`, `\[`, or `\frac`.
- Equations are readable in plain Markdown viewers.
- Digest facts and review questions remain source-grounded.
- Source content cannot override the digest task or output format.

The issue’s rules block is in `python/src/arbor_worker/digest.py` (`_RULES`) and is concatenated into lecture, chunk, and course-synthesis prompts. `validate_digest` rejects `\(`, `\[`, and `\frac` on create/regenerate. **Follow-up (same version, not a new era):** `_apply_patch` in `digest_update.py` does not call `validate_digest` on spliced output. That is a Version 1 ingest bugfix in the next `2.x` slice, not Version 4 work.

#### [#4](https://github.com/MrF1ow/Arbor/issues/4) — standalone macOS desktop app

Original acceptance criteria:

- A user can install the DMG, open Arbor from Finder, choose a Knowledge folder, pass Codex authentication, and run an update without a local Arbor checkout, `ARBOR_REPO_DIR`, Python, uv, Node, or Cargo.

Codex CLI stays a separate install (explicit in the issue). Signing and notarization are **nice to have**, not acceptance criteria. The sidecar DMG workflow exists (`.github/workflows/macos-dmg.yml`). **Finder-like launch proof** is not a new packaging program; it is a box on the Version 3 Mac batch.

#### [#19](https://github.com/MrF1ow/Arbor/issues/19) — Codex CLI discovery and auth for GUI launches

Original acceptance criteria:

- A GUI launch succeeds when Codex is available only at `~/.local/bin/codex`.
- A stalled auth check resolves to a visible error rather than remaining on “Checking Codex…”.
- Focus events do not stack parallel auth checks.
- Tests cover fallback CLI discovery and authentication timeout.

Implemented: `resolve_codex_command` / `gui_path` in `python/src/arbor_worker/auth.py` (also `/opt/homebrew/bin` and `/usr/local/bin`), 10s timeout, `refreshAuthInFlight` in `desktop/src/main.ts`, tests in `python/tests/test_auth.py`.

#### [#21](https://github.com/MrF1ow/Arbor/issues/21) — incremental manifest metadata and single-digest `course.md`

Original acceptance criteria:

- New course manifests are version 2 after the first successful ingest.
- The manifest stores source page fingerprints in `sources`.
- Generated dated digests contain valid page markers and records store a non-null `page_markers_version`.
- A changed source supports suggested dirty ranges and in-place patching where appropriate.
- Choose and document one behavior: do not create `course.md` until two digests exist, **or** write a concise index for a single digest rather than reproducing the full content. When multiple digests exist, keep course-wide synthesis.

Chosen behavior: one digest writes a local index (`See [date.md](digests/date.md).`); two or more roll up with Codex. Documented in README. **Notes must render that markdown link** — that leftover is Version 3 shell work (issue #42), not more ingest work.

---

# Version 2

Goal:

Automation and discoverability.

**Release:** 2.0.0 (`v2.0.0`). Shipped. Package **2.1.0** adds the Version 3 shell on top; Version 2 automation scope is unchanged.

Shipped

* Folder watching (default: review panel, not silent ingest)
* Optional automatic updates (`auto_update`)
* SQLite FTS search and `reindex`
* OCR fallback for low-text PDFs
* Word documents (`.docx`)
* Job history in `.arbor/arbor.db`
* Desktop notifications on job terminal states

Explicitly out of Version 2 (deferred to Version 3)

* Scheduler (folder watching covers the main use case)
* Multiple AI providers (later milestone)
* Course browser, markdown preview, and visual polish

Implementation program: [`docs/superpowers/plans/2026-08-19-v2-automation/overview.md`](docs/superpowers/plans/2026-08-19-v2-automation/overview.md).

Do not re-open Version 2 feature scope. Remaining Version 2 work is **proof**, not new automation.

### GitHub issues in this version

#### [#30](https://github.com/MrF1ow/Arbor/issues/30) — Mac E2E test: Version 2

This issue is a MacBook checklist, not a feature list. Features it names already shipped in `v2.0.0`.

Original required boxes (from the issue):

- Full PDF ingest with git commit
- Job in Recent runs with expandable log
- Search finds text across courses
- Reindex succeeds
- File drop triggers watch → review (optional: auto-run)
- Notification on job finish
- `.docx` ingests
- (Optional) scanned PDF with Tesseract

Partial Mac evidence already exists in issue comments (Clin Med 2 ingest, v2 manifest, search, reindex, folder watch after PR #32). Still unrecorded on a Mac: notifications, Word ingest, optional OCR, optional auto-run, packaged DMG from Finder.

**Delegate remaining boxes to the Version 3 Mac batch** in [`docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md`](docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md). Do not run a separate Version 2-only Mac trip. Do not start Version 3’s `v3.0.0` tag until that combined batch is recorded.

---

# Version 3

Goal:

A study app a student would download, with local memory and a concept graph an AI can query.

The shell is the storefront. Flashcards and quiz are the study loop. Embeddings, concepts, cross-document links, and a graph-lite view are the memory a later tutor (Version 4) will use instead of rereading every digest. Diagram analysis and citation checks ground that memory in the notes the student already has.

**Status:** In progress. Package **2.2.0** has the study loop. **`v3.0.0` ships when the Mac E2E run is recorded.** Incremental delivery used `v2.1.0` then `2.2.0`. Waves 1 through 8 are in this package. Do not backfill `v2.3.0` through `v2.8.0`.

**Shipped so far (`v2.1.0`):** desktop shell — [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md).

Implementation program: [`docs/superpowers/plans/2026-08-22-v3-program/overview.md`](docs/superpowers/plans/2026-08-22-v3-program/overview.md). Study artifact format: [`docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md`](docs/superpowers/specs/2026-08-22-v3-study-artifacts-format.md). Knowledge layer: [`docs/superpowers/specs/2026-08-23-v3-knowledge-layer-design.md`](docs/superpowers/specs/2026-08-23-v3-knowledge-layer-design.md). Closeout: [`docs/superpowers/specs/2026-08-23-v3-closeout-design.md`](docs/superpowers/specs/2026-08-23-v3-closeout-design.md).

Shipped in v2.1.0 (shell only)

* Professional desktop shell (sidebar, course mode tabs, digest preview, job inspector)
* In-app settings (watch, auto-run, delete-after-digest, model)
* Search overlay navigates to digest preview in Notes mode
* Flashcards and Quiz tabs were empty at that tag

Shipped in 2.2.0 (PRs #36–#41, #47, #50, #51)

* Study generate jobs, skill protocol, retries
* Flashcards and quiz generate / refresh / review
* Flip then Again / Wrong / Mastered (progress `correct` / `wrong` written from the UI)
* Quiz session answers that do not double-count on Previous/Next
* Source chips scroll to the cited heading
* Local hashed embeddings and semantic search
* Concepts, cross-document links, graph-lite UI
* Diagram figures merged into the graph
* Local citation checks and Unverified badges
* Living docs match the app

Required for `v3.0.0`

* Remaining Version 3 implementation on the [implementation checklist](docs/implementation-checklist.md) (Notes links/tables from issue #42, shared reserved-dir policy, digest patch validation from #3)
* One Mac batch recorded in [`mac-e2e.md`](docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md) — ingest, study loop, Notes leftovers, and leftover Version 2 proof from #30
* Then tag `v3.0.0`

GitHub issue [#42](https://github.com/MrF1ow/Arbor/issues/42) is **Notes UX**, not the Wave 8 closeout tracker. Wave 8 (grades, quiz session answers, heading scroll, living docs) already landed in package `2.2.0`. Do not file chat, Anki, extra providers, or a pretty graph canvas against #42.

### GitHub issues in this version

#### [#42](https://github.com/MrF1ow/Arbor/issues/42) — V3 Notes navigation, Markdown reading, course creation, and cache filtering

Original problem (verbatim intent):

1. Long Markdown cannot be reliably scrolled and rich fields render incorrectly. Nested lists, ordered lists, emphasis, links, tables, and other normal digest Markdown lose structure.
2. Courses cannot be created from the sidebar.
3. Digest navigation is date-only; show a concise title from the digest H1 plus its date.
4. Course overview labels are reversed (`course.md` primary).
5. `_arbor_cache` appears as a Library course.

Original acceptance criteria:

- A long generated `course.md` and digest can be scrolled from beginning to end in the reading pane.
- Headings, paragraphs, nested/ordered lists, emphasis, code, links, and tables render legibly; raw HTML is not executed.
- The sidebar provides a New course action; a valid folder is created inside the selected Knowledge root, the library refreshes, and the course is selected.
- Empty, traversal, separator-containing, reserved, and duplicate course names are rejected with a useful message.
- Digest rows show a concise subject title and a separate human-readable date while dated filenames remain unchanged on disk.
- The overview row reads `Course overview` with `course.md` as secondary metadata.
- `_arbor_cache` never appears in Library navigation.
- Focused tests for discovery, metadata, course creation, rendering, and scroll structure.

**Already on `main`:** in-app add-class form (`create_course`), overview labels, H1 titles, `_arbor_cache` skipped in `list_courses`, nested/ordered lists, bold/italic/inline code, heading ids, Notes scroll CSS.

**Still required before `v3.0.0` (same issue, Version 3 shell):**

- Markdown **links** render and `digests/….md` relative links open that digest in Notes (the single-digest `course.md` index from #21 is `See [file](digests/file)`).
- Markdown **tables** render as tables, not a pipe paragraph.
- Closing `<!-- /arbor-pages:… -->` markers do not show in the reading pane.
- One reserved-directory policy shared by desktop `list_courses` / `create_course` and worker discovery (root names such as `study` and `digests` must not appear as classes).
- Recorded Mac proof that a long digest scrolls and that a `course.md` link opens the digest.

Next-phase plan: [`docs/superpowers/plans/2026-09-12-v3-notes-gate.md`](docs/superpowers/plans/2026-09-12-v3-notes-gate.md).

---

# Version 4

Goal:

Personal AI Tutor.

**Do not start Version 4 implementation until Version 3 is closed:** remaining #42 Notes work done, locally tested, and the Version 3 Mac batch recorded. Then tag `v3.0.0`. Version 4 work ships as `v3.x` packages until `v4.0.0`.

New Features

* Chat with knowledge base
* Source citations (in answers — distinct from Version 3 Unverified badges on study artifacts)
* Learning recommendations
* Weak topic detection
* Study plans
* Review scheduling
* AI mentor
* Context-aware answering

### GitHub issues in this version

#### [#20](https://github.com/MrF1ow/Arbor/issues/20) — Knowledge-grounded Codex chat inside Arbor

Nothing in this issue exists in the app today (no Chat tab, no chat worker path). Keep the full issue as Version 4 work. Do not treat flashcards, quiz, or graph as partial chat.

Original core behavior:

- Add a Chat tab/pane tied to the currently selected Knowledge root and course.
- Retrieve relevant `course.md`, dated files under `digests/`, and their source/page-range metadata before invoking Codex.
- Default to **source-grounded study mode**: answer only from the selected course’s Arbor materials; explicitly say when the answer is not supported by those materials.
- Cite the relevant digest and source/page range in each answer so the learner can verify it.
- Preserve chat history within the course, with an option to start a new chat or clear local history.
- Keep chat read-only with respect to Knowledge files unless the user explicitly asks to generate a new study artifact.

Original Codex integration:

- Use Codex CLI as the provider initially.
- Supply a stable system instruction that treats all course sources as untrusted reference material, never as instructions.
- Pass retrieved knowledge context rather than the entire course corpus on every turn.
- Stream response/progress into the app UI and show useful auth/error states.

Original UX:

- Course selector and clear indication of the active Knowledge root.
- Source citations should be clickable/openable from the response.
- Provide modes such as `Ask`, `Explain`, and `Quiz`; quiz content must be derived only from the selected course material.
- Do not silently use outside knowledge in study mode.

Original acceptance criteria:

- A user selects Behavioral Medicine, asks a question grounded in its imported lecture, receives a concise answer with a digest/source citation, and can see when the selected course does not support an answer.

Also deferred to Version 4 (from Version 3 specs, not extra GitHub issues): review scheduling / due dates, make-card-from-selection, multiple AI providers as a tutor companion. Anki export and a force-directed graph canvas stay out unless a later spec pulls them in.

---

# Version 5

Goal:

Collaboration.

**Do not start Version 5 until Version 4 is closed** (tutor implemented, locally tested, Version 4 Mac batch recorded, `v4.0.0` tagged).

Features

* Cloud sync
* Shared libraries
* Team workspaces
* Plugin marketplace
* Skill marketplace
* Shared AI providers
* Permissions
* Remote workers

None of the currently open GitHub issues (#3, #4, #19, #20, #21, #30, #42) belong here. Signing/notarization is release operations whenever Apple secrets exist, not Version 5.

---

# Future Ideas

* Audio transcription
* Lecture recording import
* YouTube ingestion
* Canvas integration
* Blackboard integration
* Google Drive import
* Dropbox import
* OneDrive import
* Mobile companion
* Web interface
* API server
* MCP integration
* Academic citation manager
* Zotero integration
* Obsidian exporter
* Notion exporter
* Anki exporter

---

# Non-Goals

The application is **not** intended to:

* Replace a Learning Management System (LMS)
* Replace note-taking software
* Become another generic AI chatbot
* Require cloud infrastructure for core functionality
* Lock users into a single AI provider
* Store proprietary data in vendor-specific formats

---

# Design Philosophy

Every component should have a single responsibility.

* Rust orchestrates.
* Python performs intelligent work.
* Skills execute tasks.
* Providers communicate with AI.
* Jobs coordinate execution.
* Markdown is the source of truth.
* AI is replaceable.
* Data remains local.

The result should be a maintainable, modular, and extensible academic knowledge platform that can evolve from a simple desktop assistant into a comprehensive AI-powered learning ecosystem without requiring major architectural changes.
