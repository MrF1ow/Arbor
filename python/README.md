# arbor-worker

Python worker for Arbor. Turns new/changed course sources (`.pdf`, `.pptx`) in a
git-tracked Knowledge library into structured markdown digests using the Codex CLI.

## Requirements

- Python >= 3.11, [uv](https://docs.astral.sh/uv/)
- Codex CLI installed and authenticated: <https://developers.openai.com/codex/cli>

## Commands

```bash
uv run arbor-worker check-auth
uv run arbor-worker list-models
uv run arbor-worker plan-update --root /path/to/Knowledge
uv run arbor-worker update --root /path/to/Knowledge --model <model-id> [--plan plan.json]
```

`plan-update` prints `{"pending": [{"path", "course", "source_type", "page_count",
"suggested_start_page", "previously_digested"}]}`. Feed a subset back into `update`
with a plan file:

```json
{ "selections": [{ "path": "Biology/mega.pptx", "start_page": 151 }] }
```

`start_page` may be `null` (or the file omitted) to ingest the whole source.
`update` without `--plan` processes every pending source from page 1.

All commands print JSON / JSONL to stdout.

## `update` event schema (JSONL)

Every line is a JSON object with `type` and `ts` (ISO-8601 UTC). Types:

| type | key fields |
|------|-----------|
| `run_started` | `root`, `model_id`, `provider` |
| `nothing_to_process` | — |
| `course_started` | `course_dir`, `sources` |
| `source_started` | `course_dir`, `source`, `start_page` |
| `source_done` | `course_dir`, `source`, `digest` |
| `source_failed` | `course_dir`, `source`, `message` |
| `source_deleted` | `course_dir`, `source` |
| `course_synthesis_started` | `course_dir`, `digest_count` |
| `course_synthesis_done` | `course_dir` |
| `course_synthesis_failed` | `course_dir`, `code`, `message` |
| `course_done` | `course_dir`, `digests` |
| `stage` | `course_dir`, `source`, `stage` (`prepare`/`generate`), `status`, `detail?` |
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
record to the committed `arbor-course.json`, and re-synthesize `course.md` from all
digests. A source is pending when its hash is absent from `arbor-course.json`, so a
grown mega-deck reappears with `suggested_start_page` set to the first new page.

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
