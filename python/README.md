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

All commands print JSON / JSONL to stdout. See `src/arbor_worker/events.py` for the
`update` event schema.
