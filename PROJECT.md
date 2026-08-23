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

Package releases (`0.1.0`, `0.2.0`, `1.0.0`, `2.0.0`, …) are in [`CHANGELOG.md`](CHANGELOG.md). They now match the Version 1–5 product slots: **1.0.0** is Version 1, **2.0.0** is Version 2.

# Version 1

Goal:

Create the smallest useful application.

**Release:** 1.0.0 (`v1.0.0`). Shipped. The current download is 2.0.0.

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

**Current release:** 2.0.0 (`v2.0.0`). Superseded by **3.0.0** for the desktop package; worker behavior unchanged.

Shipped

* Folder watching (default: review panel, not silent ingest)
* Optional automatic updates (`auto_update`)
* SQLite FTS search and `reindex`
* OCR fallback for low-text PDFs
* Word documents (`.docx`)
* Job history in `.arbor/arbor.db`
* Desktop notifications on job terminal states

Explicitly out of Version 2

* Scheduler (folder watching covers the main use case)
* Multiple AI providers (later milestone)
* Course browser, markdown preview, and visual polish (shipped in Version 3 shell, `v3.0.0`)

Implementation program: [`docs/superpowers/plans/2026-08-19-v2-automation/overview.md`](docs/superpowers/plans/2026-08-19-v2-automation/overview.md).

---

# Version 3

Goal:

A shell a student would trust, then knowledge enhancement on that shell.

**Current release (shell):** 3.0.0 (`v3.0.0`). The desktop shell shipped in 3.0.0. See [`docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md`](docs/superpowers/specs/2026-08-22-v3-desktop-shell-design.md).

Shipped in 3.0.0

* Professional desktop shell (sidebar, course mode tabs, digest preview, job inspector)
* In-app settings (watch, auto-run, delete-after-digest, model)
* Search overlay navigates to digest preview in Notes mode
* Flashcards and Quiz tabs (Coming soon placeholders)

New Features (not yet shipped)
* Flashcards
* Quiz generation
* Concept extraction
* Diagram analysis
* Citation verification
* Cross-document linking
* Knowledge graph
* Embeddings
* Semantic search

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
