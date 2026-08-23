# arbor-worker

Python worker for Arbor (package **2.1.0**). Turns new or changed course sources (`.pdf`, `.pptx`, `.docx`) in a
git-tracked Knowledge library into structured markdown digests using the Codex CLI.

`uv run arbor-worker --version` prints `2.1.0`.

## Requirements

- Python >= 3.11, [uv](https://docs.astral.sh/uv/)
- Codex CLI installed and authenticated: <https://developers.openai.com/codex/cli>

## Commands

```bash
uv run arbor-worker --version
uv run arbor-worker check-auth
uv run arbor-worker list-models
uv run arbor-worker plan-update --root /path/to/Knowledge
uv run arbor-worker update --root /path/to/Knowledge --model <model-id> [--plan plan.json]
uv run arbor-worker reindex --root /path/to/Knowledge
```

`plan-update` prints pending sources with fingerprint-based suggestions:

```json
{
  "pending": [{
    "path": "Biology/mega.pdf",
    "course": "Biology",
    "source_type": "pdf",
    "page_count": 300,
    "suggested_ranges": [[151, 300]],
    "alignment_status": "clean_append",
    "previously_digested": true
  }]
}
```

`suggested_ranges` is a list of `[start, end]` pairs (1-based, inclusive).
`alignment_status` is one of `clean_append`, `changed`, `ambiguous`, or `identical`.
Sources without stored fingerprints fall back to a tail-range suggestion when a mega-deck grew.

Feed a subset back into `update` with a plan file:

```json
{
  "selections": [
    { "path": "Biology/mega.pdf", "ranges": [[151, 300]] },
    { "path": "Biology/readings/ch1.pdf", "ranges": null }
  ]
}
```

`ranges` may be `null` or omitted to ingest the whole file. An empty list `[]` means
do no work (the truncation case: file shrank, alignment is `changed`, suggestions are empty).
Each range is processed in order. Cancel is cooperative at range and digest-action boundaries.
`update` without `--plan` uses each pending source's suggested ranges when those
exist, otherwise the whole file. Truncation with empty suggestions still does no work.

A confirmed PPTX range that is not the entire deck forces the image fallback path so the
window is real pages, not whole-file extracted text. That path needs LibreOffice (`soffice`).

All commands print JSON / JSONL to stdout.

## `update` event schema (JSONL)

Every line is a JSON object with `type` and `ts` (ISO-8601 UTC). Types:

| type | key fields |
|------|-----------|
| `run_started` | `root`, `model_id`, `provider` |
| `nothing_to_process` | — |
| `course_started` | `course_dir`, `sources` |
| `source_started` | `course_dir`, `source`, `ranges` (`[[start, end], …]`) |
| `source_done` | `course_dir`, `source`, `digest` |
| `source_failed` | `course_dir`, `source`, `message` |
| `source_deleted` | `course_dir`, `source` |
| `course_synthesis_started` | `course_dir`, `digest_count` |
| `course_synthesis_done` | `course_dir` |
| `course_synthesis_failed` | `course_dir`, `code`, `message` |
| `course_done` | `course_dir`, `digests` |
| `stage` | `course_dir`, `source`, `stage` (`prepare`/`generate`), `status`, `detail?`, `action?` (`create`/`patch`/`regenerate`) |
| `chunk_started` | `course_dir`, `chunk_id`, `page_start`, `page_end`, `index`, `total` |
| `chunk_done` | `course_dir`, `chunk_id`, `page_start`, `page_end`, `index`, `total` |
| `chunk_failed` | `course_dir`, `chunk_id`, `page_start`, `page_end`, `code`, `message` |
| `synthesis_started` | `course_dir`, `chunk_count` |
| `synthesis_done` | `course_dir` |
| `synthesis_failed` | `course_dir`, `code`, `message` |
| `warning` | `course_dir`, `message` |
| `cancelled` | `after_sources` |
| `committed` | `commit`, `courses` |
| `run_done` | `processed`, `failed`, `skipped` |
| `auth_failed` | `reason`, `docs_url` |
| `error` | `message` |

## Large-PDF chunking

Image-based lectures (PDF, or PPTX image fallback) with more than
`pdf_chunk_threshold_pages` (default 25) pages are split into fixed page windows
(`pdf_chunk_size_pages`, default 25), processed with bounded concurrency
(`pdf_chunk_concurrency`, default 2), and synthesized into one dated digest.
Per-chunk status and digests live in `_arbor_cache/<source_hash>/chunks.json` and
`chunk-NNNN.md`, so an interrupted or failed run resumes only the incomplete
chunks (and re-runs synthesis) on the next `update`. The manifest record for that digest stores `generate_mode`, and for chunked runs
`chunk_count`, in `arbor-course.json`.

Exit codes for `update`: `0` all succeeded, `1` at least one source failed, `3` Codex not authenticated.

## Course layout and incremental ingest

Each immediate child directory of the Knowledge root is a **course**. Sources may
sit anywhere under it. Successful runs write `digests/YYYY-MM-DD.md`, append a
record to the committed `arbor-course.json`. A course with one digest gets a short
local `course.md` index (no Codex call). Two or more digests are rolled up with the
provider.

A source is pending when it is new, its whole-file hash changed, or a `sources`
entry has empty fingerprint slots after a partial ingest. Manifests with no
`sources` map still treat a hash match as current. `plan-update` compares
per-page fingerprints in `arbor-course.json` (`version` 2 `sources`) to suggest
dirty or leftover page ranges. On a clean append, the review panel pre-fills the
new tail (e.g. `151-300`). A failed two-digest rollup still saves digest files,
writes a link-only `course.md`, and commits so the next Update does not create
duplicates.

### Manifest (`arbor-course.json`)

- `records[]` — one entry per digest window (`start_page`, `end_page`, `digest_file`, …)
- `sources{path}` — durable per-page fingerprints (`page_fingerprints`, `fingerprint_kind`, …)

Fingerprints survive `delete_sources_after_digest`: deleted PDFs/PPTX files can be
re-added later and aligned by content.

### Digest page markers

New and regenerated digests wrap content in HTML comment markers:

```markdown
<!-- arbor-pages:40-55 -->
…section content…
<!-- /arbor-pages:40-55 -->
```

Overlapping updates **patch** the matching marker block in place. The provider is asked
for that owning span (and its page images), not only the overlap. Missing or invalid
markers trigger a full regenerate of that digest file.

Set `delete_sources_after_digest` in `<root>/.arbor/settings.json` to remove source
files after they are digested (default `false`).

## Manual live check (real Codex)

With Codex authenticated on macOS or Linux:

```bash
uv run arbor-worker check-auth          # {"authenticated": true, ...}
mkdir -p /tmp/K && cd /tmp/K && git init -q && git commit -q --allow-empty -m init
mkdir -p Biology && cp ~/some-lecture.pdf Biology/mega.pdf
uv run arbor-worker plan-update --root /tmp/K
uv run arbor-worker update --root /tmp/K --model <model-id>
```

Expect `Biology/digests/<date>.md`, `Biology/course.md`, `Biology/arbor-course.json`, and a `digest:` commit.
