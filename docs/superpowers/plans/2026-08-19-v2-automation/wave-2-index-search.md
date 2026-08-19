# Wave 2: Index and search

**Status:** planned (blocked on Wave 1)

## Goal

Search across courses via SQLite FTS. Index is rebuildable from markdown.

## PRs

| PR | Work | Verify |
|----|------|--------|
| 2.1 | `index_documents` + FTS5 schema; index after successful job | New digest searchable |
| 2.2 | `arbor-worker reindex --root` full rebuild | Delete DB, reindex, search works |
| 2.3 | Richer metadata columns from manifest | Filter by course name |
| 2.4 | Search box + results list | Cross-course query hits |

## Files

- Python `indexer.py` or Rust post-job hook
- `desktop/src/main.ts` search panel
