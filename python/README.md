# arbor-worker

Python worker for Arbor. Turns new/changed lecture sources (`.pdf`, `.pptx`) in a
git-tracked Knowledge library into structured markdown digests using the Codex CLI.

## Requirements

- Python >= 3.11, [uv](https://docs.astral.sh/uv/)
- Codex CLI installed and authenticated: <https://developers.openai.com/codex/cli>

## Commands

```bash
uv run arbor-worker check-auth
uv run arbor-worker list-models
uv run arbor-worker update --root /path/to/Knowledge --model <model-id>
```

All commands print JSON / JSONL to stdout.

## `update` event schema (JSONL)

Every line is a JSON object with `type` and `ts` (ISO-8601 UTC). Types:

| type | key fields |
|------|-----------|
| `run_started` | `root`, `model_id`, `provider` |
| `nothing_to_process` | — |
| `lecture_started` | `lecture_dir`, `source` |
| `stage` | `lecture_dir`, `stage` (`discover`/`prepare`/`generate`/`write`), `status` (`start`/`ok`/`fail`), `detail?` |
| `warning` | `lecture_dir`, `message` |
| `lecture_done` | `lecture_dir` |
| `lecture_failed` | `lecture_dir`, `stage`, `message` |
| `cancelled` | `after_lecture` |
| `committed` | `commit`, `lectures` |
| `run_done` | `processed`, `failed`, `skipped` |
| `auth_failed` | `reason`, `docs_url` |
| `error` | `message` |

Exit codes for `update`: `0` all succeeded, `1` at least one lecture failed,
`3` Codex not authenticated.

## Manual live check (real Codex)

With Codex authenticated on macOS or Linux:

```bash
uv run arbor-worker check-auth          # {"authenticated": true, ...}
mkdir -p /tmp/K && cd /tmp/K && git init -q && git commit -q --allow-empty -m init
mkdir -p "Biology/Lecture 01" && cp ~/some-lecture.pdf "Biology/Lecture 01/source.pdf"
uv run arbor-worker update --root /tmp/K --model <model-id>
```

Expect `lecture.md` + `metadata.json` beside the source and a `digest:` commit.
