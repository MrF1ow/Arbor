# Version 3 desktop shell

Date: 2026-08-22

Status: shipped in **3.0.0** (2026-08-22). Supersedes the 2.0.0 single-column UI.

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
┌──────────┬────────────────────────────────────────────────┐
│ Library  │  Biology    [Notes] [Flashcards] [Quiz]  [🔍]  │
│  Biology │────────────────────────────────────────────────│
│  Chem    │                                                │
│          │     ← main pane content changes per mode →     │
│ Jobs     │                                                │
│ Settings │────────────────────────────────────────────────│
│          │  [Update knowledge]   job: succeeded  3:41p    │
└──────────┴────────────────────────────────────────────────┘
```

Default window: 1100×760, min 900×640. Resizable.

**Sidebar (220px).** App name, course list from the Knowledge root (folder names), Jobs, Settings. Selected course is a row in Library, not only a title in the main header.

**Course header.** Course name on the left. Mode tabs on the right: **Notes**, **Flashcards**, **Quiz**. Search icon at the far right. Modes switch what the main pane shows; they do not add sidebar rows or a permanent right column.

**Main pane.** Content for the active course mode:

| Mode | Main pane shows | Ships in |
|------|-----------------|----------|
| **Notes** (default) | `course.md` index, then digest preview on click. Readable serif type, page markers as chips. | Shell (3.1) |
| **Flashcards** | Deck for the selected course. Card flip, progress, shuffle. | 3.3+ |
| **Quiz** | Question flow for the selected course. | 3.4+ |

Flashcards and Quiz are course modes, not top-level places. Opening Biology → Flashcards should feel like opening Biology → Notes. The shell ships the tab bar early; modes beyond Notes can show a calm empty state until their feature lands.

**Bottom inspector (collapsed by default).** Update, review table, live job log. Opens when the user clicks Update, when folder watch fires, or when a job is running. The black full-width terminal is not the home screen.

**Search.** Icon in the course header opens search (popover or inline bar). Hits navigate to the course, switch to Notes mode, and scroll the matching digest. Same FTS backend as 2.0.0.

**No permanent right sidebar.** Study modes take the full main pane. An optional collapsible context panel in Notes mode (outline, “make card from selection”) is a later refinement, not part of this layout.

Auth badge lives in the sidebar footer or the inspector, not as a hero pill under the title.

## Look

Mac-native first. The DMG is the download. Linux from source can look slightly less native.

Approved palette: **sage & cream** (see [`docs/mockups/v3-shell.html`](../../../mockups/v3-shell.html)).

| Token | Hex | Role |
|-------|-----|------|
| `--cream-bg` | `#FAF6EF` | Main reading surface |
| `--cream-sidebar` | `#F3EDE3` | Sidebar wash |
| `--cream-elevated` | `#FDFBF7` | Cards, header |
| `--cream-border` | `#E4DDD1` | Hairlines |
| `--sage-accent` | `#5C7A61` | Primary actions, auth-ok |
| `--sage-deep` | `#3D5243` | Headings, pressed states |
| `--sage-muted` | `#8FA88F` | Secondary labels |
| `--sage-tint` | `#E8EFE9` | Selected rows, chips |
| `--ink` | `#2A3028` | Body text |
| `--ink-muted` | `#6B7368` | Secondary text |

- UI chrome: `-apple-system` / `ui-sans-serif`.
- Reading pane: `ui-serif` for digest headings and body.
- Radius 8px. No gradients. No neon log unless the inspector is open.
- Light is the default. Follow `prefers-color-scheme` for dark, with the same hierarchy, not a black box with green type.

Primary button is **Update knowledge**. Secondary is Cancel. Confirm in the inspector is the same green, full width of the inspector, not a tiny table-footer button.

## Navigation that Version 3 and 4 plug into

Two levels:

1. **Sidebar places** — where you are in the app.
2. **Course mode tabs** — what you are doing inside a course.

### Sidebar places

| Place | 2.0.0 equivalent | Later |
|-------|------------------|--------|
| Library → course | none (no browser) | selects course; main header shows mode tabs |
| Jobs | Recent runs table | same, as a place |
| Settings | none in UI | models, watch, auto_update, delete-after-digest |
| Tutor (Version 4) | none | chat with citations; takes main pane like a course mode |

Search is not a sidebar place. It lives in the course header.

### Course modes (main pane tabs)

| Mode | Purpose |
|------|---------|
| Notes | Browse and read digests |
| Flashcards | Study deck for this course |
| Quiz | Practice questions for this course |

Future modes (Concepts, knowledge graph) extend this tab row or replace a tab — they do not get a third column.

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
2. Sidebar + course list from disk. Course header with Notes / Flashcards / Quiz tabs (Flashcards and Quiz empty for now). Main pane shows `course.md` preview in Notes mode.
3. Inspector for Update / review / log / jobs.
4. Settings place that writes `.arbor/settings.json`.
5. Flashcards mode — wire tab to real deck UI and generation.
6. Quiz mode — same pattern.
7. Embeddings, concepts, knowledge graph — new modes or extensions on Notes, not layout changes.

Each step should still run the Mac V2 E2E ingest path. If a shell change breaks Confirm or watch, it is not done.

## Success

A classmate who has never seen the repo can download 3.x, pick a folder, and believe this is a notes app that happens to ingest lectures. They should not see a log until they start an Update.
