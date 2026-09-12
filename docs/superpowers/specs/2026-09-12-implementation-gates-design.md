# Implementation gates

Date: 2026-09-12

Status: living. Tracker: [`docs/implementation-checklist.md`](../../implementation-checklist.md). Roadmap: [`PROJECT.md`](../../../PROJECT.md).

## Problem

GitHub issues and `PROJECT.md` versions drifted. Issues #3, #4, #19, and #21 still look open even though Version 1 code landed. Issue #42 is Notes UX, but Version 3 docs used it as the closeout tracker. There was no single list of what is implemented, what was tested locally, and what still needs a MacBook batch.

Without that list, a Linux agent can keep shipping Version 4 chat while Version 3 Notes still render `course.md` links as raw markdown, and a Mac run can be demanded after every small PR.

## Decision

Keep **three documents**:

| Document | Owns |
|----------|------|
| `PROJECT.md` Version 1–5 | Capability eras and the original GitHub issue acceptance criteria mapped into those eras |
| `docs/implementation-checklist.md` | Done / local-tested / Mac-batch-tested, blockers from E2E, and the hard gates |
| `docs/superpowers/plans/2026-08-22-v3-program/mac-e2e.md` | The **script** for the current Version 3 Mac batch (how to run it), not the status ledger |

## Gates

**Merge / local gate.** Every change must pass on the VM or CI:

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test && npm run build
```

Linux desktop smoke is allowed as extra local proof. It does not replace the Mac batch.

**Mac batch gate.** One end-to-end run on a MacBook per product version (or per leftover batch that closes that version). Not after every feature. The batch covers the whole era: ingest, study loop, and any leftovers called out on the checklist.

**Version start gate.** Do not begin the next product version until:

1. Required implementation for the current version is done.
2. Local tests for that work are green.
3. One Mac batch for that version is recorded (date, macOS version, commit or DMG tag) on the checklist.

Findings from a Mac batch are appended to the checklist as blockers for the **current** version. Fix them locally. They ride the next Mac batch. Do not schedule a Mac trip per finding.

## What is not a gate

- Signing and notarization (nice to have on issue #4).
- Optional OCR and optional auto-run (prove if present; do not block `v3.0.0` if Tesseract is absent).
- Closing stale GitHub tickets. The checklist can mark work done while GitHub is still open; an operator should close the stale tickets.

## Next phase

Version 3 is the current era. Version 4 (#20 chat) is blocked until the Version 3 Mac batch is recorded.

Implementation plan: [`../plans/2026-09-12-v3-notes-gate.md`](../plans/2026-09-12-v3-notes-gate.md).
