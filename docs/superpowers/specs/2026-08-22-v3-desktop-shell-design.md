# Version 3 desktop shell

Date: 2026-08-22

Status: design. Not in 2.0.0.

## Problem

2.0.0 is a working ingest tool. The window is 720×640. Everything lives in one column: folder picker, search, format guidance, model, auth badge, Update, review table, a black terminal log, then job history. A student downloading this from GitHub sees a debug panel, not a study app.

Version 3 in PROJECT.md is flashcards, quizzes, embeddings, and a knowledge graph. Those features need a place to live. Stacking them on the current screen makes the weirdness worse. The shell has to come first.

Version 4 is chat. The same shell should have a slot for a tutor panel so we do not redesign twice.

## Who it is for

A college student on a Mac. They already export GoodNotes to PDF. They will tolerate Gatekeeper once. They will not tolerate an app that looks like an internal build. The Knowledge folder on disk stays the source of truth. The app is how they browse and update it.

## What stays

- Tauri v2, TypeScript, no React requirement in this spec. Vanilla is fine if the layout is real. A small view layer is allowed if it earns the navigation.
- Codex CLI still external.
- Markdown on disk still source of truth. SQLite stays derived.
- Watch → review by default. Auto-run stays opt-in.
- The Update / Confirm / range-edit flow. It moves into a drawer or inspector. It does not disappear.

## Layout

Default window: 1100×760, min 900×640. Resizable.

```
┌─────────────┬──────────────────────────────────────────────┐
│ Arbor       │ Biology                          [Search]    │
│             ├──────────────────────────────────────────────┤
│ Library     │                                             │
│  Biology    │  course.md / digest preview                 │
│  Chemistry  │  (readable type, page markers as chips)     │
│             │                                             │
│ Jobs        │                                             │
│ Settings    │─────────────────────────────────────────────│
│             │  [Update knowledge]   job: succeeded  3:41p │
└─────────────┴──────────────────────────────────────────────┘
```

**Sidebar (220px).** App name, course list from the Knowledge root (folder names), Jobs, Settings. Selected course is a row, not a breadcrumb in the title only.

**Main.** Preview of `course.md` by default. Clicking a digest in that index opens that file. This is the Version 3 "course browser" and "markdown preview" called out as out-of-scope for Version 2.

**Bottom inspector (collapsed by default).** Update, review table, live job log. Opens when the user clicks Update, when folder watch fires, or when a job is running. The black full-width terminal is not the home screen.

**Search.** Top of the main pane. Hits navigate to the course and scroll the matching digest. Same FTS backend as 2.0.0.

Auth badge lives in the sidebar footer or the inspector, not as a hero pill under the title.

## Look

Mac-native first. The DMG is the download. Linux from source can look slightly less native.

- UI chrome: `-apple-system` / `ui-sans-serif`.
- Reading pane: `ui-serif` for digest headings and body. That is the "notes" feel without shipping a font file.
- Paper background `#f4f1ea`, ink `#1c1917`, hairline borders `#e4e0d7`.
- Accent: one green, `#2f6f4e`, for primary actions and the auth-ok state. Not a second accent.
- Radius 8px. No gradients. No neon log unless the inspector is open.
- Light is the default. Follow `prefers-color-scheme` for dark, with the same hierarchy, not a black box with green type.

Primary button is **Update knowledge**. Secondary is Cancel. Confirm in the inspector is the same green, full width of the inspector, not a tiny table-footer button.

## Navigation that Version 3 and 4 plug into

The sidebar is a list of **places**, not a list of features.

| Place | 2.0.0 equivalent | Later |
|-------|------------------|--------|
| Course | none (no browser) | preview, then flashcards / quiz for that course |
| Search | search box | semantic search later, same slot |
| Jobs | Recent runs table | same, as a place |
| Settings | none in UI | models, watch, auto_update, delete-after-digest |
| Tutor (Version 4) | none | chat with citations, same window |

Flashcards are a mode on a course, not a new top-level product. Opening Biology → Flashcards should feel like opening Biology → Notes.

## Settings in the app

2.0.0 still requires editing `.arbor/settings.json` by hand. Version 3 Settings place writes that file:

- Watch folder (on by default)
- Auto-run after watch (off by default)
- Delete sources after digest (off by default)

Models stay `.arbor/models.json` with the same dropdown, just moved into Settings.

## Out of scope for the shell

- Flashcard generation itself
- Embeddings and a vector index
- Chat
- A marketplace, tabs of plugins, or a custom titlebar that fights Tauri
- Shipping Inter / a design-system kit. System fonts on purpose.

## Build order

1. Window size, type, color, spacing. Same one-column content, less "terminal." Proves the look without navigation risk.
2. Sidebar + course list from disk. Main pane shows `course.md` preview.
3. Inspector for Update / review / log / jobs.
4. Settings place that writes `.arbor/settings.json`.
5. Then flashcards and the rest of Version 3 as course modes.

Each step should still run the Mac V2 E2E ingest path. If a shell change breaks Confirm or watch, it is not done.

## Success

A classmate who has never seen the repo can download 3.x, pick a folder, and believe this is a notes app that happens to ingest lectures. They should not see a log until they start an Update.
