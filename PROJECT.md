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

## Version numbering

**Product milestones** (Version 1–5 below) are capability eras. **Git tags** track what is shipped.

| Tag | Product milestone | Meaning |
|-----|-------------------|---------|
| `v1.0.0` | Version 1 | Shipped |
| `v2.0.0` | Version 2 | Shipped — automation on the v1 UI |
| `v2.1.0`, `v2.2.0`, … | Version 3 **in progress** | Incremental releases toward Version 3 |
| `v3.0.0` | Version 3 | **Reserved** — tag only when every Version 3 feature below ships |
| `v4.0.0` | Version 4 | Tutor milestone (future) |

Do not tag `v3.0.0` for the shell alone, a single wave, or partial delivery. The desktop shell shipped in **`v2.1.0`** as the first step of Version 3 work. Later steps are `v2.2.0`, `v2.3.0`, … Never publish `3.1.0` or `3.2.0` as package versions.

Cursor rule: [`.cursor/rules/arbor-versioning.mdc`](.cursor/rules/arbor-versioning.mdc).

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

macOS `.dmg` from GitHub Actions (`macos-dmg`). The worker is a bundled sidecar. Codex CLI stays a separate install. See GitHub issue #4.

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

* Mac E2E study-loop run recorded on issue [#42](https://github.com/MrF1ow/Arbor/issues/42) or in [`mac-e2e.md`](docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md)
* Then tag `v3.0.0`

---

# Version 4

Goal:

Personal AI Tutor.

New Features

* Chat with knowledge base
* Source citations
* Learning recommendations
* Weak topic detection
* Study plans
* Review scheduling
* AI mentor
* Context-aware answering

---

# Version 5

Goal:

Collaboration.

Features

* Cloud sync
* Shared libraries
* Team workspaces
* Plugin marketplace
* Skill marketplace
* Shared AI providers
* Permissions
* Remote workers

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
