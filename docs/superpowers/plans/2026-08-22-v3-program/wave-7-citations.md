# Wave 7: Citation verification (`v2.8.0`)

> **Status (2026-10-17):** Landed inside tag `v2.2.0`. There is no `v2.8.0`. Do not execute this plan. Current release is `v2.3.0`. The open gate is the Mac batch in [mac-e2e.md](mac-e2e.md).

Parent: [overview.md](overview.md)

Spec: [knowledge layer](../../specs/2026-08-23-v3-knowledge-layer-design.md)

Depends on Wave 5 (concepts exist). Should also see flashcards/quiz if those shipped. Verification walks whatever artifacts are present.

## Goal

Every generated claim that cites a digest is checked locally against that digest’s text. Failures are visible. Arbor does not fetch the web. A later tutor can refuse to quote an unverified card.

## Data structures

- Event `citation_failed` `{ "path", "id", "reason" }`
- Optional `verified: bool` on cards / nodes. Prefer events + UI badge over rewriting JSON if a field would break older files. If a field is added, bump `schema_version` and keep a one-step upgrader
- Skill `citations` is read-mostly. It must not delete artifacts

## PRs

| PR | Work | Verify |
|----|------|--------|
| 7.1 | `skills/citations.py`. Load flashcards, quiz, concepts. Normalize claim. Substring / token check against cited digest | Fixture. Matching claim passes. Invented claim emits `citation_failed` |
| 7.2 | Missing digest or heading → failed, not crash | Deleted digest file. Job succeeds with failures listed |
| 7.3 | Desktop badges on cards, quiz review, concept chips | Failed card shows badge. Click opens the cited digest anyway |
| 7.4 | Generate / Refresh citations job in inspector | Manual run after editing a digest |

## Files

- Create: `python/src/arbor_worker/skills/citations.py`
- Create: `python/tests/test_skills_citations.py`
- Modify: desktop card/quiz/graph UI for badges, events log

## Verification

**Static.** pytest, cargo test, npm run build.

**Runtime.** Deck with one bogus back. Citations job flags that card only. Honest cards stay clean. Git still has the study files (not deleted). Ingest still works.

## Out of this wave

Web citation lookup. DOI APIs. Rewriting the student’s notes.
