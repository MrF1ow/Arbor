# Arbor Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `arbor-worker`, a testable Python CLI that scans a git-tracked Knowledge library, turns new/changed PDF/PPTX lecture sources into structured markdown digests via the Codex CLI, and commits successes to git.

**Architecture:** A pure-Python package invoked as a subprocess by the Tauri shell (Plan 2). It exposes three CLI subcommands (`check-auth`, `list-models`, `update`). The `update` command runs a per-lecture staged pipeline (Discover → Prepare → Generate → Write) and a single batch git commit, emitting JSONL progress events on stdout. AI access goes through a `CliProvider` interface; only `CodexCliProvider` (shells out to `codex exec`) is implemented, with a `FakeProvider` for tests. Git is the processed-state store: dirty source files are work; a commit means done.

**Tech Stack:** Python ≥ 3.11, managed with `uv`. `pymupdf` (PDF→PNG render), `python-pptx` (PPTX text). Git and Codex are driven via `subprocess`. Tests use `pytest`.

## Global Constraints

- **Platforms:** macOS and Linux only. No Windows-specific code; use `pathlib` and avoid shell string interpolation.
- **AI access:** Codex CLI only, already installed and authenticated. No API keys, no HTTP AI calls, no `--with-api-key`.
- **Auth first:** `update` MUST verify Codex auth before any scan/render/git work. On failure it emits an `auth_failed` event and exits non-zero without side effects.
- **Git = state:** Only new/modified **source** files (`.pdf`, `.pptx`) are work. Edits to `lecture.md`/`metadata.json` alone never queue work. Unchanged committed sources are skipped.
- **Commit policy:** One commit per `update` batch, containing only lectures that passed the Write stage (their source + `lecture.md` + `metadata.json`). Commit message begins `digest: `.
- **Sequential:** Process lectures one at a time.
- **Cache:** Prepare artifacts live under `<root>/_arbor_cache/<source_hash>/` and MUST be gitignored. Never commit cache files.
- **Resume:** Prepare artifacts are reused when `source_hash` is unchanged. Incomplete lectures are never committed.
- **metadata.json fields (exact keys):** `source_filename`, `source_type` (`pdf`|`pptx`), `source_hash`, `processed_at` (ISO-8601 UTC), `provider` (`codex_cli`), `model_id`, `processing_path` (`pdf_images`|`pptx_text`|`pptx_images_fallback`), `status` (`ok`).
- **Digest sections (required, in order):** `# <title>`, `## Overview`, `## Key Concepts`, `## Important Details`, `## Questions to Review`.
- **Codex invocation (exact):** `codex exec -m <model> [-i <img>]... --sandbox read-only --skip-git-repo-check --ephemeral --color never -o <outfile> -C <cwd>` with the prompt written to stdin; digest text is read back from `<outfile>`.
- **Codex auth check (exact):** `codex login status` (exit 0 = authenticated). Binary presence via `shutil.which("codex")`.

---

## File Structure

All paths are relative to the repo root `/home/flow/Projects/personal/Arbor`.

```
python/
  pyproject.toml                     # uv project, deps, pytest + console script
  README.md                          # worker usage + event schema
  src/arbor_worker/
    __init__.py                      # version
    __main__.py                      # `python -m arbor_worker` -> cli.main
    cli.py                           # argparse; dispatch subcommands
    settings.py                      # WorkerSettings: cache dir name, thresholds, model list, docs URL
    events.py                        # Event dataclasses + JSONL emitter
    hashing.py                       # sha256 of a file
    cache.py                         # cache dir layout keyed by source_hash
    auth.py                          # codex auth check
    sources.py                       # discover lecture sources under root
    gitstate.py                      # dirty source detection + batch commit
    metadata.py                      # Metadata dataclass + write/read
    digest.py                        # prompt building + structure validation
    prepare/
      __init__.py                    # prepare_source() dispatch + PrepareResult
      pdf.py                         # render_pdf_to_images()
      pptx.py                        # extract_pptx_text() + thinness check + fallback
    provider/
      __init__.py                    # exports
      base.py                        # Model, ProviderRequest, ProviderResult, CliProvider protocol
      codex.py                       # CodexCliProvider
      fake.py                        # FakeProvider (tests / --provider fake)
    pipeline.py                      # per-lecture stages + batch runner
  tests/
    conftest.py                      # fixtures: temp git repo, tiny pdf/pptx builders
    test_events.py
    test_hashing.py
    test_cache.py
    test_auth.py
    test_sources.py
    test_gitstate.py
    test_metadata.py
    test_digest.py
    test_prepare_pdf.py
    test_prepare_pptx.py
    test_provider_codex.py
    test_provider_fake.py
    test_pipeline.py
    test_cli.py
    test_settings.py
```

**Design boundaries:**
- `pipeline.py` is the only module that knows the stage order; it depends on `sources`, `prepare`, `provider`, `digest`, `metadata`, `gitstate`, `cache`, `events`.
- `provider/*` never touches git or the filesystem layout; it only runs the CLI and returns text.
- `prepare/*` never calls the provider; it only produces local artifacts.
- Everything is injectable: `pipeline` takes a `CliProvider` instance so tests pass `FakeProvider`.

**Event schema (JSONL on stdout, one object per line):** every event has `type` and `ts` (ISO-8601 UTC). Types and extra fields:
- `run_started`: `root`, `model_id`, `provider`
- `nothing_to_process`
- `lecture_started`: `lecture_dir`, `source`
- `stage`: `lecture_dir`, `stage` (`discover`|`prepare`|`generate`|`write`), `status` (`start`|`ok`|`fail`), `detail` (optional)
- `warning`: `lecture_dir`, `message`
- `lecture_done`: `lecture_dir`
- `lecture_failed`: `lecture_dir`, `stage`, `message`
- `cancelled`: `after_lecture` (optional)
- `committed`: `commit`, `lectures` (list of dirs)
- `run_done`: `processed`, `failed`, `skipped`
- `auth_failed`: `reason`, `docs_url`
- `error`: `message`

---

### Task 1: Project scaffold + CLI skeleton

**Files:**
- Create: `python/pyproject.toml`
- Create: `python/src/arbor_worker/__init__.py`
- Create: `python/src/arbor_worker/__main__.py`
- Create: `python/src/arbor_worker/cli.py`
- Create: `python/tests/test_cli.py`
- Create: `python/README.md`

**Interfaces:**
- Produces: `arbor_worker.__version__: str`; `cli.build_parser() -> argparse.ArgumentParser`; `cli.main(argv: list[str] | None = None) -> int`. Subcommands registered: `check-auth`, `list-models`, `update` (handlers stubbed in later tasks).

- [ ] **Step 1: Create the uv project file**

Create `python/pyproject.toml`:

```toml
[project]
name = "arbor-worker"
version = "0.1.0"
description = "Arbor knowledge worker: turns lecture sources into structured digests via the Codex CLI."
requires-python = ">=3.11"
dependencies = [
    "pymupdf>=1.24",
    "python-pptx>=0.6.23",
]

[project.scripts]
arbor-worker = "arbor_worker.cli:main"

[dependency-groups]
dev = [
    "pytest>=8.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/arbor_worker"]

[tool.pytest.ini_options]
addopts = "-q"
testpaths = ["tests"]
```

- [ ] **Step 2: Create package + version**

Create `python/src/arbor_worker/__init__.py`:

```python
"""Arbor knowledge worker package."""

__version__ = "0.1.0"
```

- [ ] **Step 3: Write the failing CLI test**

Create `python/tests/test_cli.py`:

```python
import io
import contextlib

from arbor_worker import cli


def run(argv):
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_version_flag():
    code, out, _ = run(["--version"])
    assert code == 0
    assert "0.1.0" in out


def test_subcommands_registered():
    parser = cli.build_parser()
    # argparse stores subparser choices on the _SubParsersAction
    actions = [a for a in parser._actions if getattr(a, "choices", None)]
    choices = set()
    for a in actions:
        choices.update(a.choices.keys())
    assert {"check-auth", "list-models", "update"}.issubset(choices)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.cli'` (or collection error).

- [ ] **Step 5: Implement the CLI skeleton**

Create `python/src/arbor_worker/__main__.py`:

```python
from arbor_worker.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
```

Create `python/src/arbor_worker/cli.py`:

```python
from __future__ import annotations

import argparse

from arbor_worker import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="arbor-worker")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("check-auth", help="Check Codex CLI authentication.")
    sub.add_parser("list-models", help="List selectable models as JSON.")

    up = sub.add_parser("update", help="Process new/changed sources under a Knowledge root.")
    up.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
    up.add_argument("--model", required=True, help="Model id passed to the provider.")
    up.add_argument("--provider", default="codex", choices=["codex", "fake"])
    up.add_argument("--cancel-file", default=None, help="If this file appears, stop at the next stage boundary.")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 2
    # Handlers wired in later tasks.
    if args.command == "check-auth":
        from arbor_worker.commands import cmd_check_auth
        return cmd_check_auth(args)
    if args.command == "list-models":
        from arbor_worker.commands import cmd_list_models
        return cmd_list_models(args)
    if args.command == "update":
        from arbor_worker.commands import cmd_update
        return cmd_update(args)
    return 2
```

> Note: `arbor_worker.commands` is created in Task 15. Until then only `--version` and `build_parser()` are exercised by tests, so the deferred imports are not triggered.

- [ ] **Step 6: Create the worker README**

Create `python/README.md`:

```markdown
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add python/pyproject.toml python/README.md python/src/arbor_worker/__init__.py python/src/arbor_worker/__main__.py python/src/arbor_worker/cli.py python/tests/test_cli.py python/uv.lock
git commit -m "feat(worker): scaffold arbor-worker package and CLI skeleton"
```

---

### Task 2: Settings

**Files:**
- Create: `python/src/arbor_worker/settings.py`
- Create: `python/tests/test_settings.py`

**Interfaces:**
- Produces: `WorkerSettings` dataclass with fields `cache_dir_name: str = "_arbor_cache"`, `pptx_min_chars: int = 200`, `pdf_render_dpi: int = 150`, `pdf_warn_pages: int = 50`, `docs_url: str`, `models: list[Model]`. `default_settings() -> WorkerSettings`. `load_models(root: Path) -> list[Model]` reads `<root>/.arbor/models.json` if present, else returns defaults.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_settings.py`:

```python
import json
from pathlib import Path

from arbor_worker.settings import default_settings, load_models
from arbor_worker.provider.base import Model


def test_defaults_present():
    s = default_settings()
    assert s.cache_dir_name == "_arbor_cache"
    assert s.pptx_min_chars == 200
    assert s.docs_url.startswith("http")
    assert len(s.models) >= 1
    assert all(isinstance(m, Model) for m in s.models)


def test_load_models_defaults_when_absent(tmp_path: Path):
    models = load_models(tmp_path)
    assert models == default_settings().models


def test_load_models_from_file(tmp_path: Path):
    cfg = tmp_path / ".arbor"
    cfg.mkdir()
    (cfg / "models.json").write_text(
        json.dumps({"models": [{"id": "custom-1", "label": "Custom One"}]})
    )
    models = load_models(tmp_path)
    assert models == [Model(id="custom-1", label="Custom One")]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_settings.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.settings'` (and `provider.base`, created in Task 8; if collection errors on that import, proceed — Step 3 defines `Model` first via a light import guard as shown).

> To keep Task 2 self-contained ahead of Task 8, define `Model` in `provider/base.py` now as part of this step.

Create `python/src/arbor_worker/provider/__init__.py`:

```python
```

Create `python/src/arbor_worker/provider/base.py` (Model only for now; extended in Task 8):

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Model:
    id: str
    label: str
```

- [ ] **Step 3: Implement settings**

Create `python/src/arbor_worker/settings.py`:

```python
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from arbor_worker.provider.base import Model

DOCS_URL = "https://developers.openai.com/codex/cli"

DEFAULT_MODELS = [
    Model(id="gpt-5.6-sol", label="Sol 5.6"),
    Model(id="gpt-5.6-terra", label="Terra 5.6"),
]


@dataclass(frozen=True)
class WorkerSettings:
    cache_dir_name: str = "_arbor_cache"
    pptx_min_chars: int = 200
    pdf_render_dpi: int = 150
    pdf_warn_pages: int = 50
    docs_url: str = DOCS_URL
    models: list[Model] = field(default_factory=lambda: list(DEFAULT_MODELS))


def default_settings() -> WorkerSettings:
    return WorkerSettings()


def load_models(root: Path) -> list[Model]:
    cfg = Path(root) / ".arbor" / "models.json"
    if not cfg.is_file():
        return list(DEFAULT_MODELS)
    data = json.loads(cfg.read_text())
    return [Model(id=m["id"], label=m["label"]) for m in data["models"]]
```

> The seeded model ids (`gpt-5.6-sol`, `gpt-5.6-terra`) are the Sol/Terra models the user named. They must match ids that `codex -m <id>` accepts; users edit `<root>/.arbor/models.json` to change them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_settings.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/settings.py python/src/arbor_worker/provider/__init__.py python/src/arbor_worker/provider/base.py python/tests/test_settings.py
git commit -m "feat(worker): add settings and user-editable model list"
```

---

### Task 3: Event emitter

**Files:**
- Create: `python/src/arbor_worker/events.py`
- Create: `python/tests/test_events.py`

**Interfaces:**
- Produces: `EventEmitter(stream)` with `.emit(type: str, **fields) -> dict` that writes one JSON line (keys sorted off; includes `type` and `ts`) and flushes. Convenience methods used by the pipeline: `run_started`, `nothing_to_process`, `lecture_started`, `stage`, `warning`, `lecture_done`, `lecture_failed`, `cancelled`, `committed`, `run_done`, `auth_failed`, `error`. Also `parse_lines(text: str) -> list[dict]` helper for tests.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_events.py`:

```python
import io
import json

from arbor_worker.events import EventEmitter, parse_lines


def test_emit_writes_one_json_line_with_type_and_ts():
    buf = io.StringIO()
    em = EventEmitter(buf)
    ev = em.emit("stage", lecture_dir="Bio/L1", stage="prepare", status="ok")
    lines = buf.getvalue().splitlines()
    assert len(lines) == 1
    obj = json.loads(lines[0])
    assert obj["type"] == "stage"
    assert obj["stage"] == "prepare"
    assert obj["status"] == "ok"
    assert "ts" in obj
    assert obj == ev


def test_convenience_methods():
    buf = io.StringIO()
    em = EventEmitter(buf)
    em.run_started(root="/k", model_id="m", provider="fake")
    em.run_done(processed=1, failed=0, skipped=2)
    events = parse_lines(buf.getvalue())
    assert [e["type"] for e in events] == ["run_started", "run_done"]
    assert events[1]["processed"] == 1
    assert events[1]["skipped"] == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_events.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.events'`.

- [ ] **Step 3: Implement the emitter**

Create `python/src/arbor_worker/events.py`:

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TextIO


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_lines(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class EventEmitter:
    def __init__(self, stream: TextIO):
        self._stream = stream

    def emit(self, type: str, **fields) -> dict:
        obj = {"type": type, "ts": _now(), **fields}
        self._stream.write(json.dumps(obj) + "\n")
        self._stream.flush()
        return obj

    # Convenience wrappers ------------------------------------------------
    def run_started(self, **f):
        return self.emit("run_started", **f)

    def nothing_to_process(self, **f):
        return self.emit("nothing_to_process", **f)

    def lecture_started(self, **f):
        return self.emit("lecture_started", **f)

    def stage(self, **f):
        return self.emit("stage", **f)

    def warning(self, **f):
        return self.emit("warning", **f)

    def lecture_done(self, **f):
        return self.emit("lecture_done", **f)

    def lecture_failed(self, **f):
        return self.emit("lecture_failed", **f)

    def cancelled(self, **f):
        return self.emit("cancelled", **f)

    def committed(self, **f):
        return self.emit("committed", **f)

    def run_done(self, **f):
        return self.emit("run_done", **f)

    def auth_failed(self, **f):
        return self.emit("auth_failed", **f)

    def error(self, **f):
        return self.emit("error", **f)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_events.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/events.py python/tests/test_events.py
git commit -m "feat(worker): add JSONL event emitter"
```

---

### Task 4: File hashing

**Files:**
- Create: `python/src/arbor_worker/hashing.py`
- Create: `python/tests/test_hashing.py`

**Interfaces:**
- Produces: `hash_file(path: Path) -> str` — hex sha256 of file bytes, streamed in chunks.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_hashing.py`:

```python
import hashlib
from pathlib import Path

from arbor_worker.hashing import hash_file


def test_hash_matches_hashlib(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"hello arbor")
    assert hash_file(p) == hashlib.sha256(b"hello arbor").hexdigest()


def test_hash_changes_with_content(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"one")
    h1 = hash_file(p)
    p.write_bytes(b"two")
    assert hash_file(p) != h1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_hashing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.hashing'`.

- [ ] **Step 3: Implement hashing**

Create `python/src/arbor_worker/hashing.py`:

```python
from __future__ import annotations

import hashlib
from pathlib import Path


def hash_file(path: Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_hashing.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/hashing.py python/tests/test_hashing.py
git commit -m "feat(worker): add streamed file hashing"
```

---

### Task 5: Cache layout

**Files:**
- Create: `python/src/arbor_worker/cache.py`
- Create: `python/tests/test_cache.py`

**Interfaces:**
- Consumes: `WorkerSettings.cache_dir_name` (Task 2).
- Produces: `CacheDir` with `.root: Path`, `.for_hash(source_hash: str) -> Path` (creates `<root>/<cache_dir_name>/<hash>/`), `.marker_path(source_hash) -> Path` (`prepare.json` inside), `.read_marker(source_hash) -> dict | None`, `.write_marker(source_hash, data: dict) -> None`. `ensure_gitignored(root: Path, cache_dir_name: str) -> None` appends the cache dir to `<root>/.gitignore` if not already ignored.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_cache.py`:

```python
from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored


def test_for_hash_creates_dir(tmp_path: Path):
    c = CacheDir(tmp_path, "_arbor_cache")
    d = c.for_hash("abc123")
    assert d.is_dir()
    assert d == tmp_path / "_arbor_cache" / "abc123"


def test_marker_roundtrip(tmp_path: Path):
    c = CacheDir(tmp_path, "_arbor_cache")
    assert c.read_marker("h") is None
    c.write_marker("h", {"processing_path": "pdf_images", "page_count": 3})
    assert c.read_marker("h") == {"processing_path": "pdf_images", "page_count": 3}


def test_ensure_gitignored_appends_once(tmp_path: Path):
    ensure_gitignored(tmp_path, "_arbor_cache")
    ensure_gitignored(tmp_path, "_arbor_cache")
    content = (tmp_path / ".gitignore").read_text()
    assert content.count("_arbor_cache/") == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_cache.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.cache'`.

- [ ] **Step 3: Implement cache**

Create `python/src/arbor_worker/cache.py`:

```python
from __future__ import annotations

import json
from pathlib import Path


class CacheDir:
    def __init__(self, root: Path, cache_dir_name: str):
        self.root = Path(root)
        self.cache_dir_name = cache_dir_name

    @property
    def base(self) -> Path:
        return self.root / self.cache_dir_name

    def for_hash(self, source_hash: str) -> Path:
        d = self.base / source_hash
        d.mkdir(parents=True, exist_ok=True)
        return d

    def marker_path(self, source_hash: str) -> Path:
        return self.for_hash(source_hash) / "prepare.json"

    def read_marker(self, source_hash: str) -> dict | None:
        p = self.base / source_hash / "prepare.json"
        if not p.is_file():
            return None
        return json.loads(p.read_text())

    def write_marker(self, source_hash: str, data: dict) -> None:
        self.marker_path(source_hash).write_text(json.dumps(data))


def ensure_gitignored(root: Path, cache_dir_name: str) -> None:
    gi = Path(root) / ".gitignore"
    entry = f"{cache_dir_name}/"
    existing = gi.read_text().splitlines() if gi.is_file() else []
    if entry in existing:
        return
    with open(gi, "a") as fh:
        if existing and existing[-1].strip() != "":
            fh.write("\n")
        fh.write(entry + "\n")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_cache.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/cache.py python/tests/test_cache.py
git commit -m "feat(worker): add hash-keyed cache dir and gitignore helper"
```

---

### Task 6: Auth check

**Files:**
- Create: `python/src/arbor_worker/auth.py`
- Create: `python/tests/test_auth.py`

**Interfaces:**
- Produces: `AuthResult` dataclass `{ok: bool, reason: str}`. `check_codex_auth(runner=subprocess.run, which=shutil.which) -> AuthResult`. Logic: if `which("codex")` is None → `ok=False, reason="Codex CLI not found on PATH"`. Else run `["codex", "login", "status"]`; `ok = (returncode == 0)`; on non-zero, `reason` = trimmed stdout/stderr or `"Codex CLI is not authenticated"`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_auth.py`:

```python
import subprocess

from arbor_worker.auth import check_codex_auth


class FakeCompleted:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_missing_binary():
    res = check_codex_auth(runner=lambda *a, **k: FakeCompleted(0), which=lambda name: None)
    assert res.ok is False
    assert "not found" in res.reason.lower()


def test_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(0, stdout="Logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is True


def test_not_authenticated():
    res = check_codex_auth(
        runner=lambda *a, **k: FakeCompleted(1, stdout="Not logged in"),
        which=lambda name: "/usr/bin/codex",
    )
    assert res.ok is False
    assert "not logged in" in res.reason.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.auth'`.

- [ ] **Step 3: Implement auth**

Create `python/src/arbor_worker/auth.py`:

```python
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    reason: str


def check_codex_auth(runner=subprocess.run, which=shutil.which) -> AuthResult:
    if which("codex") is None:
        return AuthResult(False, "Codex CLI not found on PATH")
    proc = runner(
        ["codex", "login", "status"],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return AuthResult(True, "")
    detail = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    return AuthResult(False, detail or "Codex CLI is not authenticated")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_auth.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/auth.py python/tests/test_auth.py
git commit -m "feat(worker): add Codex auth check"
```

---

### Task 7: Test fixtures (git repo + tiny pdf/pptx builders)

**Files:**
- Create: `python/tests/conftest.py`

**Interfaces:**
- Produces pytest fixtures/helpers reused by later tests:
  - `git_repo(tmp_path) -> Path`: initializes a git repo with a deterministic user config and an initial commit of a `.gitignore`.
  - `make_pdf(path: Path, pages: int = 2, text: str = "Slide") -> Path`: writes a minimal multi-page PDF via PyMuPDF.
  - `make_pptx(path: Path, slides_text: list[str]) -> Path`: writes a minimal PPTX via python-pptx.
  - `git(root)` helper returning a function that runs git subcommands and returns stdout.

- [ ] **Step 1: Implement the fixtures**

Create `python/tests/conftest.py`:

```python
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


def _run_git(root: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout


@pytest.fixture
def git():
    def _factory(root: Path):
        def _call(*args: str) -> str:
            return _run_git(root, *args)
        return _call
    return _factory


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    root = tmp_path / "Knowledge"
    root.mkdir()
    _run_git(root, "init", "-q")
    _run_git(root, "config", "user.email", "test@arbor.local")
    _run_git(root, "config", "user.name", "Arbor Test")
    (root / ".gitignore").write_text("_arbor_cache/\n")
    _run_git(root, "add", ".gitignore")
    _run_git(root, "commit", "-q", "-m", "init")
    return root


@pytest.fixture
def make_pdf():
    import fitz  # PyMuPDF

    def _factory(path: Path, pages: int = 2, text: str = "Slide") -> Path:
        doc = fitz.open()
        for i in range(pages):
            page = doc.new_page()
            page.insert_text((72, 72), f"{text} {i + 1}")
        doc.save(str(path))
        doc.close()
        return path

    return _factory


@pytest.fixture
def make_pptx():
    from pptx import Presentation
    from pptx.util import Inches

    def _factory(path: Path, slides_text: list[str]) -> Path:
        prs = Presentation()
        blank = prs.slide_layouts[6]
        for text in slides_text:
            slide = prs.slides.add_slide(blank)
            box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(2))
            box.text_frame.text = text
        prs.save(str(path))
        return path

    return _factory
```

- [ ] **Step 2: Verify fixtures import cleanly**

Run: `cd python && uv run pytest tests/ -q`
Expected: PASS (all prior tests still green; conftest imports `fitz` and `pptx` successfully, proving deps installed).

- [ ] **Step 3: Commit**

```bash
git add python/tests/conftest.py
git commit -m "test(worker): add git repo and pdf/pptx builder fixtures"
```

---

### Task 8: Provider base types + FakeProvider

**Files:**
- Modify: `python/src/arbor_worker/provider/base.py`
- Create: `python/src/arbor_worker/provider/fake.py`
- Create: `python/tests/test_provider_fake.py`

**Interfaces:**
- Produces (final shapes relied on by pipeline and codex provider):
  - `Model(id: str, label: str)` (already defined Task 2).
  - `ProviderRequest(prompt: str, model_id: str, image_paths: list[Path], cwd: Path)`.
  - `ProviderResult(markdown: str)`.
  - `CliProvider` (typing.Protocol): `name: str`; `is_available() -> bool`; `list_models() -> list[Model]`; `run(request: ProviderRequest) -> ProviderResult`.
  - `FakeProvider(markdown: str, models: list[Model] | None = None, available: bool = True)` implementing the protocol; records `.calls: list[ProviderRequest]`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_provider_fake.py`:

```python
from pathlib import Path

from arbor_worker.provider.base import ProviderRequest, ProviderResult, Model
from arbor_worker.provider.fake import FakeProvider


def test_fake_records_calls_and_returns_markdown():
    p = FakeProvider(markdown="# T\n## Overview\nx")
    req = ProviderRequest(prompt="do it", model_id="m", image_paths=[Path("a.png")], cwd=Path("."))
    res = p.run(req)
    assert isinstance(res, ProviderResult)
    assert res.markdown.startswith("# T")
    assert p.calls == [req]


def test_fake_models_and_availability():
    p = FakeProvider(markdown="x", models=[Model("id", "Label")], available=False)
    assert p.is_available() is False
    assert p.list_models() == [Model("id", "Label")]
    assert p.name == "fake"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_provider_fake.py -v`
Expected: FAIL with `ImportError` (ProviderRequest/ProviderResult not defined).

- [ ] **Step 3: Extend base + implement FakeProvider**

Replace `python/src/arbor_worker/provider/base.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Model:
    id: str
    label: str


@dataclass(frozen=True)
class ProviderRequest:
    prompt: str
    model_id: str
    image_paths: list[Path] = field(default_factory=list)
    cwd: Path = field(default_factory=lambda: Path("."))


@dataclass(frozen=True)
class ProviderResult:
    markdown: str


@runtime_checkable
class CliProvider(Protocol):
    name: str

    def is_available(self) -> bool: ...

    def list_models(self) -> list[Model]: ...

    def run(self, request: ProviderRequest) -> ProviderResult: ...
```

Create `python/src/arbor_worker/provider/fake.py`:

```python
from __future__ import annotations

from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult


class FakeProvider:
    name = "fake"

    def __init__(self, markdown: str, models: list[Model] | None = None, available: bool = True):
        self._markdown = markdown
        self._models = models or [Model("fake-model", "Fake Model")]
        self._available = available
        self.calls: list[ProviderRequest] = []

    def is_available(self) -> bool:
        return self._available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def run(self, request: ProviderRequest) -> ProviderResult:
        self.calls.append(request)
        return ProviderResult(markdown=self._markdown)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_provider_fake.py tests/test_settings.py -v`
Expected: PASS (Task 2 settings tests still pass with the extended `base.py`).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/provider/base.py python/src/arbor_worker/provider/fake.py python/tests/test_provider_fake.py
git commit -m "feat(worker): add provider interface and FakeProvider"
```

---

### Task 9: CodexCliProvider

**Files:**
- Create: `python/src/arbor_worker/provider/codex.py`
- Create: `python/tests/test_provider_codex.py`

**Interfaces:**
- Consumes: `ProviderRequest`, `ProviderResult`, `Model` (Task 8); `settings.load_models` is NOT used here (models are injected).
- Produces: `CodexCliProvider(models: list[Model], runner=subprocess.run, which=shutil.which)` with `name = "codex"`.
  - `build_argv(request, out_file: Path) -> list[str]` (pure; unit-tested).
  - `is_available()` → delegates to `auth.check_codex_auth(...).ok`.
  - `list_models()` → returns injected models.
  - `run(request)` → writes prompt to a temp file used as stdin, runs argv, reads `out_file`; raises `ProviderError` on non-zero exit or empty output.
- Produces: `ProviderError(Exception)`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_provider_codex.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderRequest
from arbor_worker.provider.codex import CodexCliProvider, ProviderError


def test_build_argv_includes_flags_and_images(tmp_path: Path):
    prov = CodexCliProvider(models=[Model("m", "M")])
    req = ProviderRequest(
        prompt="p",
        model_id="gpt-x",
        image_paths=[tmp_path / "a.png", tmp_path / "b.png"],
        cwd=tmp_path,
    )
    out = tmp_path / "out.md"
    argv = prov.build_argv(req, out)
    assert argv[:3] == ["codex", "exec", "-m"]
    assert "gpt-x" in argv
    assert argv.count("-i") == 2
    assert "--sandbox" in argv and "read-only" in argv
    assert "--skip-git-repo-check" in argv
    assert "--ephemeral" in argv
    assert "-o" in argv and str(out) in argv
    assert "-C" in argv and str(tmp_path) in argv


def test_run_reads_output_file(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        # emulate codex writing the digest to the -o file
        out_index = argv.index("-o") + 1
        Path(argv[out_index]).write_text("# Title\n## Overview\nbody")
        class R: returncode = 0; stdout = ""; stderr = ""
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    res = prov.run(req)
    assert res.markdown.startswith("# Title")


def test_run_raises_on_nonzero(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        class R: returncode = 2; stdout = ""; stderr = "boom"
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    with pytest.raises(ProviderError):
        prov.run(req)


def test_run_raises_on_empty_output(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        out_index = argv.index("-o") + 1
        Path(argv[out_index]).write_text("   ")
        class R: returncode = 0; stdout = ""; stderr = ""
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    with pytest.raises(ProviderError):
        prov.run(req)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_provider_codex.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.provider.codex'`.

- [ ] **Step 3: Implement CodexCliProvider**

Create `python/src/arbor_worker/provider/codex.py`:

```python
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from arbor_worker.auth import check_codex_auth
from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult


class ProviderError(Exception):
    pass


class CodexCliProvider:
    name = "codex"

    def __init__(self, models: list[Model], runner=subprocess.run, which=shutil.which):
        self._models = models
        self._runner = runner
        self._which = which

    def is_available(self) -> bool:
        return check_codex_auth(runner=self._runner, which=self._which).ok

    def list_models(self) -> list[Model]:
        return list(self._models)

    def build_argv(self, request: ProviderRequest, out_file: Path) -> list[str]:
        argv = ["codex", "exec", "-m", request.model_id]
        for img in request.image_paths:
            argv += ["-i", str(img)]
        argv += [
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color", "never",
            "-o", str(out_file),
            "-C", str(request.cwd),
        ]
        return argv

    def run(self, request: ProviderRequest) -> ProviderResult:
        with tempfile.TemporaryDirectory() as td:
            out_file = Path(td) / "last_message.md"
            argv = self.build_argv(request, out_file)
            proc = self._runner(
                argv,
                input=request.prompt,
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()
                raise ProviderError(f"codex exec failed ({proc.returncode}): {detail}")
            if not out_file.is_file():
                raise ProviderError("codex exec produced no output file")
            markdown = out_file.read_text()
            if not markdown.strip():
                raise ProviderError("codex exec produced empty output")
            return ProviderResult(markdown=markdown)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_provider_codex.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/provider/codex.py python/tests/test_provider_codex.py
git commit -m "feat(worker): add CodexCliProvider (codex exec)"
```

---

### Task 10: Prepare — PDF render

**Files:**
- Create: `python/src/arbor_worker/prepare/__init__.py`
- Create: `python/src/arbor_worker/prepare/pdf.py`
- Create: `python/tests/test_prepare_pdf.py`

**Interfaces:**
- Produces: `render_pdf_to_images(source: Path, out_dir: Path, dpi: int = 150) -> list[Path]` — renders each page to `page-00001.png`, returns sorted list; raises `PrepareError` if the PDF has zero pages or produces no images.
- Produces (in `__init__.py`): `PrepareError(Exception)` and `PrepareResult` dataclass `{processing_path: str, image_paths: list[Path], text: str | None, detail: dict}` (dispatch added in Task 11).

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_prepare_pdf.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.prepare import PrepareError
from arbor_worker.prepare.pdf import render_pdf_to_images


def test_renders_all_pages(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=3)
    out = tmp_path / "cache"
    out.mkdir()
    images = render_pdf_to_images(src, out, dpi=100)
    assert len(images) == 3
    assert all(p.suffix == ".png" and p.stat().st_size > 0 for p in images)
    assert images == sorted(images)


def test_raises_on_zero_pages(tmp_path: Path):
    import fitz
    src = tmp_path / "empty.pdf"
    doc = fitz.open()
    doc.save(str(src))  # zero pages
    doc.close()
    out = tmp_path / "cache"
    out.mkdir()
    with pytest.raises(PrepareError):
        render_pdf_to_images(src, out, dpi=100)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_prepare_pdf.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.prepare'`.

- [ ] **Step 3: Implement PDF render**

Create `python/src/arbor_worker/prepare/__init__.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


class PrepareError(Exception):
    pass


@dataclass(frozen=True)
class PrepareResult:
    processing_path: str  # "pdf_images" | "pptx_text" | "pptx_images_fallback"
    image_paths: list[Path] = field(default_factory=list)
    text: str | None = None
    detail: dict = field(default_factory=dict)
```

Create `python/src/arbor_worker/prepare/pdf.py`:

```python
from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF

from arbor_worker.prepare import PrepareError


def render_pdf_to_images(source: Path, out_dir: Path, dpi: int = 150) -> list[Path]:
    doc = fitz.open(str(source))
    try:
        if doc.page_count == 0:
            raise PrepareError(f"PDF has no pages: {source.name}")
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        images: list[Path] = []
        for index in range(doc.page_count):
            page = doc.load_page(index)
            pix = page.get_pixmap(matrix=matrix)
            out = out_dir / f"page-{index + 1:05d}.png"
            pix.save(str(out))
            images.append(out)
    finally:
        doc.close()
    if not images:
        raise PrepareError(f"PDF produced no images: {source.name}")
    return sorted(images)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_prepare_pdf.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/prepare/__init__.py python/src/arbor_worker/prepare/pdf.py python/tests/test_prepare_pdf.py
git commit -m "feat(worker): render PDF pages to images"
```

---

### Task 11: Prepare — PPTX + dispatch

**Files:**
- Create: `python/src/arbor_worker/prepare/pptx.py`
- Modify: `python/src/arbor_worker/prepare/__init__.py`
- Create: `python/tests/test_prepare_pptx.py`

**Interfaces:**
- Consumes: `render_pdf_to_images` (Task 10), `WorkerSettings` (`pptx_min_chars`, `pdf_render_dpi`), `CacheDir` (Task 5), `hash_file` (Task 4).
- Produces: `extract_pptx_text(source: Path) -> str` (joins slide text). `find_soffice(which=shutil.which) -> str | None`. `convert_pptx_to_pdf(source, out_dir, runner=..., which=...) -> Path` (LibreOffice headless; raises `PrepareError` if `soffice` missing or conversion fails).
- Produces (in `__init__.py`): `prepare_source(source: Path, source_type: str, source_hash: str, cache: CacheDir, settings: WorkerSettings, *, on_warning=None, runner=subprocess.run, which=shutil.which) -> PrepareResult`. Routing:
  - `pdf` → render images → `PrepareResult("pdf_images", image_paths=...)`, warn if page_count > `pdf_warn_pages`.
  - `pptx` → extract text; if `len(non-whitespace) >= pptx_min_chars` → `PrepareResult("pptx_text", text=...)`; else convert to PDF via soffice, render → `PrepareResult("pptx_images_fallback", image_paths=...)`.
  - Resume: if cache marker exists for hash and referenced artifacts still present, return a `PrepareResult` from cache without recomputing.
  - Writes/updates the cache marker with `{processing_path, page_count?, char_count?}`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_prepare_pptx.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.cache import CacheDir
from arbor_worker.hashing import hash_file
from arbor_worker.settings import default_settings
from arbor_worker.prepare import prepare_source, PrepareError
from arbor_worker.prepare.pptx import extract_pptx_text


def _prep(source, source_type, tmp_path, **overrides):
    settings = default_settings()
    for k, v in overrides.items():
        object.__setattr__(settings, k, v)
    cache = CacheDir(tmp_path, settings.cache_dir_name)
    return prepare_source(source, source_type, hash_file(source), cache, settings)


def test_extract_text_from_pptx(make_pptx, tmp_path: Path):
    src = make_pptx(tmp_path / "s.pptx", ["Mitochondria is the powerhouse", "Cells divide"])
    text = extract_pptx_text(src)
    assert "Mitochondria" in text and "Cells divide" in text


def test_pptx_text_path_when_enough_text(make_pptx, tmp_path: Path):
    body = "The nervous system coordinates body activities. " * 10
    src = make_pptx(tmp_path / "s.pptx", [body])
    res = _prep(src, "pptx", tmp_path)
    assert res.processing_path == "pptx_text"
    assert res.text and "nervous system" in res.text
    assert res.image_paths == []


def test_pptx_thin_text_triggers_fallback_or_clear_error(make_pptx, tmp_path: Path):
    src = make_pptx(tmp_path / "s.pptx", ["hi"])  # below threshold
    # If soffice is unavailable in CI, prepare must raise a clear PrepareError.
    try:
        res = _prep(src, "pptx", tmp_path, pptx_min_chars=200)
    except PrepareError as e:
        assert "libreoffice" in str(e).lower() or "soffice" in str(e).lower()
        return
    assert res.processing_path == "pptx_images_fallback"
    assert len(res.image_paths) >= 1


def test_pdf_routes_to_images(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=2)
    res = _prep(src, "pdf", tmp_path)
    assert res.processing_path == "pdf_images"
    assert len(res.image_paths) == 2


def test_resume_reuses_cache(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=2)
    r1 = _prep(src, "pdf", tmp_path)
    mtimes = {p: p.stat().st_mtime_ns for p in r1.image_paths}
    r2 = _prep(src, "pdf", tmp_path)
    assert r2.image_paths == r1.image_paths
    # not re-rendered
    assert all(p.stat().st_mtime_ns == mtimes[p] for p in r2.image_paths)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_prepare_pptx.py -v`
Expected: FAIL with `ImportError` (`prepare_source` / `prepare.pptx` missing).

- [ ] **Step 3: Implement PPTX extract + soffice conversion**

Create `python/src/arbor_worker/prepare/pptx.py`:

```python
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from pptx import Presentation

from arbor_worker.prepare import PrepareError


def extract_pptx_text(source: Path) -> str:
    prs = Presentation(str(source))
    chunks: list[str] = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = "".join(run.text for run in para.runs)
                    if line.strip():
                        chunks.append(line)
    return "\n".join(chunks)


def find_soffice(which=shutil.which) -> str | None:
    return which("soffice") or which("libreoffice")


def convert_pptx_to_pdf(source: Path, out_dir: Path, runner=subprocess.run, which=shutil.which) -> Path:
    soffice = find_soffice(which)
    if soffice is None:
        raise PrepareError(
            "PPTX has insufficient text and LibreOffice (soffice) is not installed for "
            "image fallback. Re-export the slides as PDF, or install LibreOffice."
        )
    proc = runner(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(source)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise PrepareError(f"LibreOffice conversion failed: {(proc.stderr or '').strip()}")
    pdf = out_dir / (source.stem + ".pdf")
    if not pdf.is_file():
        raise PrepareError("LibreOffice did not produce a PDF")
    return pdf
```

- [ ] **Step 4: Implement dispatch + resume in `prepare/__init__.py`**

Append to `python/src/arbor_worker/prepare/__init__.py` (below the existing `PrepareResult`):

```python
from arbor_worker.cache import CacheDir
from arbor_worker.settings import WorkerSettings


def _nonspace_len(text: str) -> int:
    return len("".join(text.split()))


def prepare_source(
    source: Path,
    source_type: str,
    source_hash: str,
    cache: CacheDir,
    settings: WorkerSettings,
    *,
    on_warning=None,
    runner=None,
    which=None,
) -> "PrepareResult":
    import shutil as _shutil
    import subprocess as _subprocess

    from arbor_worker.prepare.pdf import render_pdf_to_images
    from arbor_worker.prepare.pptx import (
        convert_pptx_to_pdf,
        extract_pptx_text,
    )

    runner = runner or _subprocess.run
    which = which or _shutil.which

    out_dir = cache.for_hash(source_hash)
    marker = cache.read_marker(source_hash)

    # Resume from cache if artifacts still exist.
    if marker is not None:
        path = marker.get("processing_path")
        if path == "pptx_text":
            text = (out_dir / "extract.txt")
            if text.is_file():
                return PrepareResult("pptx_text", text=text.read_text(), detail=marker)
        else:
            images = sorted(out_dir.glob("page-*.png"))
            if images:
                return PrepareResult(path, image_paths=images, detail=marker)

    if source_type == "pdf":
        images = render_pdf_to_images(source, out_dir, dpi=settings.pdf_render_dpi)
        if on_warning and len(images) > settings.pdf_warn_pages:
            on_warning(f"{source.name}: {len(images)} pages; this may use significant quota")
        cache.write_marker(source_hash, {"processing_path": "pdf_images", "page_count": len(images)})
        return PrepareResult("pdf_images", image_paths=images, detail={"page_count": len(images)})

    if source_type == "pptx":
        text = extract_pptx_text(source)
        if _nonspace_len(text) >= settings.pptx_min_chars:
            (out_dir / "extract.txt").write_text(text)
            cache.write_marker(source_hash, {"processing_path": "pptx_text", "char_count": _nonspace_len(text)})
            return PrepareResult("pptx_text", text=text, detail={"char_count": _nonspace_len(text)})
        # Fallback: convert to PDF then render.
        pdf = convert_pptx_to_pdf(source, out_dir, runner=runner, which=which)
        images = render_pdf_to_images(pdf, out_dir, dpi=settings.pdf_render_dpi)
        if on_warning and len(images) > settings.pdf_warn_pages:
            on_warning(f"{source.name}: {len(images)} pages; this may use significant quota")
        cache.write_marker(source_hash, {"processing_path": "pptx_images_fallback", "page_count": len(images)})
        return PrepareResult("pptx_images_fallback", image_paths=images, detail={"page_count": len(images)})

    raise PrepareError(f"Unsupported source type: {source_type}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_prepare_pptx.py -v`
Expected: PASS (5 tests; the thin-text test passes whether or not `soffice` is installed).

- [ ] **Step 6: Commit**

```bash
git add python/src/arbor_worker/prepare/__init__.py python/src/arbor_worker/prepare/pptx.py python/tests/test_prepare_pptx.py
git commit -m "feat(worker): PPTX text extract with image fallback and resume"
```

---

### Task 12: Digest prompt + validation

**Files:**
- Create: `python/src/arbor_worker/digest.py`
- Create: `python/tests/test_digest.py`

**Interfaces:**
- Consumes: `PrepareResult` (Task 10/11).
- Produces:
  - `REQUIRED_SECTIONS: list[str] = ["Overview", "Key Concepts", "Important Details", "Questions to Review"]`.
  - `build_prompt(source_name: str, prep: PrepareResult) -> str` — instruction prompt; embeds extracted text for the text path, references attached images for image paths.
  - `validate_digest(markdown: str) -> None` — raises `DigestError` if body is empty/too short or any required section heading is missing.
  - `DigestError(Exception)`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_digest.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.prepare import PrepareResult
from arbor_worker.digest import build_prompt, validate_digest, DigestError, REQUIRED_SECTIONS


def test_prompt_includes_sections_and_text():
    prep = PrepareResult("pptx_text", text="Photosynthesis converts light.")
    prompt = build_prompt("lecture01.pptx", prep)
    for section in REQUIRED_SECTIONS:
        assert section in prompt
    assert "Photosynthesis converts light." in prompt


def test_prompt_image_mode_mentions_images():
    prep = PrepareResult("pdf_images", image_paths=[Path("p1.png"), Path("p2.png")])
    prompt = build_prompt("lecture01.pdf", prep)
    assert "image" in prompt.lower()
    assert "Photosynthesis" not in prompt  # no text embedded in image mode


def test_validate_accepts_complete_digest():
    md = (
        "# Cell Biology\n"
        "## Overview\nThe cell is the unit of life and this sentence is long enough.\n"
        "## Key Concepts\n- organelles\n"
        "## Important Details\n- mitochondria make ATP\n"
        "## Questions to Review\n- what is ATP?\n"
    )
    validate_digest(md)  # no raise


def test_validate_rejects_missing_section():
    md = "# T\n## Overview\nsomething reasonably long here for the body\n"
    with pytest.raises(DigestError):
        validate_digest(md)


def test_validate_rejects_empty():
    with pytest.raises(DigestError):
        validate_digest("   ")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_digest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.digest'`.

- [ ] **Step 3: Implement digest**

Create `python/src/arbor_worker/digest.py`:

```python
from __future__ import annotations

from arbor_worker.prepare import PrepareResult

REQUIRED_SECTIONS = ["Overview", "Key Concepts", "Important Details", "Questions to Review"]

_MIN_BODY_CHARS = 40


class DigestError(Exception):
    pass


_TEMPLATE = """You are creating structured study notes from a graduate lecture.

Output ONLY GitHub-flavored Markdown, no preamble or code fences, using exactly these
sections in this order:

# <a concise lecture title>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 2-4 sentence summary of the lecture.
- Key Concepts: bulleted list of the main ideas.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 3-6 self-test questions the student should be able to answer.

Source file: {source_name}
"""


def build_prompt(source_name: str, prep: PrepareResult) -> str:
    prompt = _TEMPLATE.format(source_name=source_name)
    if prep.text is not None:
        prompt += (
            "\nThe extracted slide text is below between the markers. Base the notes on it.\n"
            "-----BEGIN SOURCE TEXT-----\n"
            f"{prep.text}\n"
            "-----END SOURCE TEXT-----\n"
        )
    else:
        prompt += (
            f"\n{len(prep.image_paths)} page image(s) are attached to this message. "
            "Read all of them, including any handwritten annotations, and base the notes "
            "on their full content.\n"
        )
    return prompt


def validate_digest(markdown: str) -> None:
    body = markdown.strip()
    if len(body) < _MIN_BODY_CHARS:
        raise DigestError("Digest is empty or too short")
    for section in REQUIRED_SECTIONS:
        if f"## {section}" not in markdown:
            raise DigestError(f"Digest missing required section: {section}")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_digest.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/digest.py python/tests/test_digest.py
git commit -m "feat(worker): add digest prompt builder and structure validation"
```

---

### Task 13: Metadata

**Files:**
- Create: `python/src/arbor_worker/metadata.py`
- Create: `python/tests/test_metadata.py`

**Interfaces:**
- Produces: `Metadata` dataclass with exactly the spec keys. `build_metadata(source: Path, source_type: str, source_hash: str, model_id: str, processing_path: str) -> Metadata` (sets `provider="codex_cli"`, `status="ok"`, `processed_at=now UTC ISO`). `write_metadata(meta: Metadata, dest: Path) -> None` writes pretty JSON. `to_dict(meta) -> dict`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_metadata.py`:

```python
import json
from pathlib import Path

from arbor_worker.metadata import build_metadata, write_metadata, to_dict


def test_build_has_all_spec_keys(tmp_path: Path):
    src = tmp_path / "source.pdf"
    src.write_bytes(b"x")
    meta = build_metadata(src, "pdf", "deadbeef", "gpt-5.6-sol", "pdf_images")
    d = to_dict(meta)
    assert set(d.keys()) == {
        "source_filename", "source_type", "source_hash", "processed_at",
        "provider", "model_id", "processing_path", "status",
    }
    assert d["source_filename"] == "source.pdf"
    assert d["provider"] == "codex_cli"
    assert d["status"] == "ok"
    assert d["model_id"] == "gpt-5.6-sol"
    assert d["processing_path"] == "pdf_images"


def test_write_metadata_roundtrip(tmp_path: Path):
    src = tmp_path / "s.pptx"
    src.write_bytes(b"x")
    meta = build_metadata(src, "pptx", "h", "m", "pptx_text")
    dest = tmp_path / "metadata.json"
    write_metadata(meta, dest)
    loaded = json.loads(dest.read_text())
    assert loaded["source_type"] == "pptx"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_metadata.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.metadata'`.

- [ ] **Step 3: Implement metadata**

Create `python/src/arbor_worker/metadata.py`:

```python
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class Metadata:
    source_filename: str
    source_type: str
    source_hash: str
    processed_at: str
    provider: str
    model_id: str
    processing_path: str
    status: str


def build_metadata(
    source: Path,
    source_type: str,
    source_hash: str,
    model_id: str,
    processing_path: str,
) -> Metadata:
    return Metadata(
        source_filename=source.name,
        source_type=source_type,
        source_hash=source_hash,
        processed_at=datetime.now(timezone.utc).isoformat(),
        provider="codex_cli",
        model_id=model_id,
        processing_path=processing_path,
        status="ok",
    )


def to_dict(meta: Metadata) -> dict:
    return asdict(meta)


def write_metadata(meta: Metadata, dest: Path) -> None:
    dest.write_text(json.dumps(to_dict(meta), indent=2) + "\n")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_metadata.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/metadata.py python/tests/test_metadata.py
git commit -m "feat(worker): add metadata model and writer"
```

---

### Task 14: Git state — discovery + dirty detection + commit

**Files:**
- Create: `python/src/arbor_worker/sources.py`
- Create: `python/src/arbor_worker/gitstate.py`
- Create: `python/tests/test_sources.py`
- Create: `python/tests/test_gitstate.py`

**Interfaces:**
- `sources.SUPPORTED_EXTS = {".pdf": "pptx?"}` → actually `{".pdf": "pdf", ".pptx": "pptx"}`.
- `sources.LectureSource` dataclass `{path: Path, lecture_dir: Path, source_type: str}` where paths are **relative to root**.
- `sources.classify(rel_path: Path) -> str | None` → `"pdf"`/`"pptx"`/`None`.
- `gitstate.dirty_sources(root: Path, runner=subprocess.run) -> list[LectureSource]` — parses `git status --porcelain -z`, keeps only added/modified/untracked entries whose extension is supported, one `LectureSource` each; raises `GitStateError` if not a git repo.
- `gitstate.validate_single_source_per_lecture(sources) -> None` — raises `GitStateError` naming any lecture dir that contains more than one dirty supported source.
- `gitstate.commit_batch(root: Path, rel_paths: list[Path], message: str, runner=subprocess.run) -> str` — `git add` the given paths, commit, return short commit hash. If nothing staged, raises `GitStateError`.

- [ ] **Step 1: Write the failing tests (sources)**

Create `python/tests/test_sources.py`:

```python
from pathlib import Path

from arbor_worker.sources import classify, LectureSource


def test_classify_extensions():
    assert classify(Path("a/b.pdf")) == "pdf"
    assert classify(Path("a/b.PPTX")) == "pptx"
    assert classify(Path("a/b.md")) is None
    assert classify(Path("a/metadata.json")) is None


def test_lecture_source_dir_is_parent():
    rel = Path("Biology/Lecture 01/source.pdf")
    ls = LectureSource(path=rel, lecture_dir=rel.parent, source_type="pdf")
    assert ls.lecture_dir == Path("Biology/Lecture 01")
```

- [ ] **Step 2: Write the failing tests (gitstate)**

Create `python/tests/test_gitstate.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.gitstate import (
    dirty_sources,
    validate_single_source_per_lecture,
    commit_batch,
    GitStateError,
)
from arbor_worker.sources import LectureSource


def test_untracked_and_modified_sources_detected(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    # committed, unchanged source -> should be skipped
    d1 = git_repo / "Bio" / "L1"
    d1.mkdir(parents=True)
    make_pdf(d1 / "source.pdf", pages=1)
    g("add", "Bio/L1/source.pdf")
    g("commit", "-q", "-m", "add L1")
    # new untracked source
    d2 = git_repo / "Bio" / "L2"
    d2.mkdir(parents=True)
    make_pdf(d2 / "slides.pdf", pages=1)
    # modify committed source
    make_pdf(d1 / "source.pdf", pages=2)

    found = {str(s.path) for s in dirty_sources(git_repo)}
    assert "Bio/L2/slides.pdf" in found
    assert "Bio/L1/source.pdf" in found


def test_digest_only_edits_do_not_count(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "lecture.md").write_text("# old")
    g("add", "-A")
    g("commit", "-q", "-m", "add")
    (d / "lecture.md").write_text("# edited by hand")
    found = {str(s.path) for s in dirty_sources(git_repo)}
    assert found == set()


def test_validate_single_source_per_lecture():
    a = LectureSource(Path("C/L/one.pdf"), Path("C/L"), "pdf")
    b = LectureSource(Path("C/L/two.pptx"), Path("C/L"), "pptx")
    with pytest.raises(GitStateError):
        validate_single_source_per_lecture([a, b])
    validate_single_source_per_lecture([a])  # ok


def test_commit_batch_only_named_paths(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "lecture.md").write_text("# digest\n")
    (d / "metadata.json").write_text("{}\n")
    commit = commit_batch(
        git_repo,
        [Path("Bio/L1/source.pdf"), Path("Bio/L1/lecture.md"), Path("Bio/L1/metadata.json")],
        "digest: Bio/L1",
    )
    assert commit
    log = g("log", "-1", "--pretty=%s")
    assert log.strip() == "digest: Bio/L1"


def test_dirty_sources_raises_outside_repo(tmp_path: Path):
    with pytest.raises(GitStateError):
        dirty_sources(tmp_path)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd python && uv run pytest tests/test_sources.py tests/test_gitstate.py -v`
Expected: FAIL with `ModuleNotFoundError` for `arbor_worker.sources` / `arbor_worker.gitstate`.

- [ ] **Step 4: Implement sources**

Create `python/src/arbor_worker/sources.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

SUPPORTED_EXTS = {".pdf": "pdf", ".pptx": "pptx"}


@dataclass(frozen=True)
class LectureSource:
    path: Path        # relative to root
    lecture_dir: Path  # relative to root
    source_type: str


def classify(rel_path: Path) -> str | None:
    return SUPPORTED_EXTS.get(rel_path.suffix.lower())
```

- [ ] **Step 5: Implement gitstate**

Create `python/src/arbor_worker/gitstate.py`:

```python
from __future__ import annotations

import subprocess
from pathlib import Path

from arbor_worker.sources import LectureSource, classify


class GitStateError(Exception):
    pass


def _git(root: Path, args: list[str], runner) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


def dirty_sources(root: Path, runner=subprocess.run) -> list[LectureSource]:
    proc = _git(root, ["status", "--porcelain", "-z"], runner)
    if proc.returncode != 0:
        raise GitStateError(f"Not a git repository or git failed: {(proc.stderr or '').strip()}")
    entries = [e for e in proc.stdout.split("\0") if e]
    results: list[LectureSource] = []
    seen: set[str] = set()
    for entry in entries:
        # Porcelain v1 format: 'XY <path>'; deletions have status 'D'.
        status = entry[:2]
        rel = entry[3:]
        if "D" in status:
            continue
        rel_path = Path(rel)
        stype = classify(rel_path)
        if stype is None:
            continue
        if rel in seen:
            continue
        seen.add(rel)
        results.append(LectureSource(path=rel_path, lecture_dir=rel_path.parent, source_type=stype))
    return results


def validate_single_source_per_lecture(sources: list[LectureSource]) -> None:
    by_dir: dict[Path, list[LectureSource]] = {}
    for s in sources:
        by_dir.setdefault(s.lecture_dir, []).append(s)
    bad = {str(d): [str(s.path) for s in items] for d, items in by_dir.items() if len(items) > 1}
    if bad:
        raise GitStateError(f"Multiple sources in one lecture folder: {bad}")


def commit_batch(root: Path, rel_paths: list[Path], message: str, runner=subprocess.run) -> str:
    if not rel_paths:
        raise GitStateError("Nothing to commit")
    add = _git(root, ["add", "--", *[str(p) for p in rel_paths]], runner)
    if add.returncode != 0:
        raise GitStateError(f"git add failed: {(add.stderr or '').strip()}")
    commit = _git(root, ["commit", "-m", message], runner)
    if commit.returncode != 0:
        raise GitStateError(f"git commit failed: {(commit.stderr or '').strip()}")
    rev = _git(root, ["rev-parse", "--short", "HEAD"], runner)
    return rev.stdout.strip()
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_sources.py tests/test_gitstate.py -v`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add python/src/arbor_worker/sources.py python/src/arbor_worker/gitstate.py python/tests/test_sources.py python/tests/test_gitstate.py
git commit -m "feat(worker): git dirty-source detection and batch commit"
```

---

### Task 15: Pipeline (stages + resume + cancel + batch)

**Files:**
- Create: `python/src/arbor_worker/pipeline.py`
- Create: `python/tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `LectureOutcome` dataclass `{lecture_dir: str, source: str, ok: bool, stage_failed: str | None, message: str | None, committed_paths: list[Path]}`.
  - `RunResult` dataclass `{processed: int, failed: int, skipped: int, commit: str | None, outcomes: list[LectureOutcome]}`.
  - `run_update(root: Path, model_id: str, provider: CliProvider, emitter: EventEmitter, settings: WorkerSettings, *, cancel_file: Path | None = None) -> RunResult`.
  - Behavior: emits `run_started`; computes `dirty_sources`; `validate_single_source_per_lecture`; if empty emits `nothing_to_process` + `run_done(0,0,0)`. For each source (sequential), before starting checks cancel_file → emits `cancelled` and stops (committing successes so far). Runs stages Discover→Prepare→Generate→Write, emitting `stage` events; on any stage failure emits `lecture_failed`, continues. On Write success, records rel paths (source + lecture.md + metadata.json). After loop, if any successes → `ensure_gitignored`, `commit_batch`, emit `committed`. Emits `run_done`.
  - Stage detail: Discover validates source exists & non-empty; Prepare calls `prepare_source` (warnings → `warning` events); Generate builds prompt, calls provider with absolute image paths and `cwd=lecture_dir`, validates digest; Write writes `lecture.md` + `metadata.json`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_pipeline.py`:

```python
from pathlib import Path

from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings
from arbor_worker.pipeline import run_update
import io

GOOD_MD = (
    "# Lecture\n## Overview\nThis overview is definitely long enough to pass.\n"
    "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
)


def _emitter():
    buf = io.StringIO()
    return EventEmitter(buf), buf


def test_nothing_to_process(git_repo: Path):
    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, default_settings())
    assert res.processed == 0
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert "nothing_to_process" in types


def test_processes_pdf_and_commits(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    prov = FakeProvider(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "gpt-5.6-sol", prov, em, default_settings())
    assert res.processed == 1 and res.failed == 0
    assert (d / "lecture.md").read_text().startswith("# Lecture")
    meta = (d / "metadata.json").read_text()
    assert "gpt-5.6-sol" in meta and "pdf_images" in meta
    # provider received absolute image paths
    assert prov.calls and all(p.is_absolute() for p in prov.calls[0].image_paths)
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "committed" for e in events)
    # cache is gitignored, not committed
    assert "_arbor_cache/" in (git_repo / ".gitignore").read_text()


def test_generate_failure_excluded_from_commit(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    prov = FakeProvider("too short and missing sections")  # fails validate_digest
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, default_settings())
    assert res.processed == 0 and res.failed == 1
    assert not (d / "lecture.md").exists()
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "lecture_failed" and e["stage"] == "generate" for e in events)
    assert not any(e["type"] == "committed" for e in events)


def test_resume_after_generate_failure(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=2)
    # First run: generate fails, but prepare cache is written.
    run_update(git_repo, "m", FakeProvider("bad"), EventEmitter(io.StringIO()), default_settings())
    cache_imgs = list((git_repo / "_arbor_cache").rglob("page-*.png"))
    assert cache_imgs
    mtimes = {p: p.stat().st_mtime_ns for p in cache_imgs}
    # Second run: generate succeeds, prepare reused (no re-render).
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), EventEmitter(io.StringIO()), default_settings())
    assert res.processed == 1
    assert all(p.stat().st_mtime_ns == mtimes[p] for p in cache_imgs)


def test_cancel_before_second_lecture(git_repo: Path, make_pdf, tmp_path: Path):
    for name in ("L1", "L2"):
        d = git_repo / "Bio" / name
        d.mkdir(parents=True)
        make_pdf(d / "source.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"

    calls = {"n": 0}
    base = FakeProvider(GOOD_MD)

    class CancelAfterFirst(FakeProvider):
        def run(self, request):
            calls["n"] += 1
            if calls["n"] == 1:
                cancel.write_text("stop")
            return super().run(request)

    prov = CancelAfterFirst(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, default_settings(), cancel_file=cancel)
    assert res.processed == 1  # only first lecture
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "cancelled" for e in events)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd python && uv run pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.pipeline'`.

- [ ] **Step 3: Implement the pipeline**

Create `python/src/arbor_worker/pipeline.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.digest import build_prompt, validate_digest, DigestError
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import (
    commit_batch,
    dirty_sources,
    validate_single_source_per_lecture,
)
from arbor_worker.hashing import hash_file
from arbor_worker.metadata import build_metadata, write_metadata
from arbor_worker.prepare import prepare_source, PrepareError, PrepareResult
from arbor_worker.provider.base import CliProvider, ProviderRequest
from arbor_worker.settings import WorkerSettings


@dataclass
class LectureOutcome:
    lecture_dir: str
    source: str
    ok: bool
    stage_failed: str | None = None
    message: str | None = None
    committed_paths: list[Path] = field(default_factory=list)


@dataclass
class RunResult:
    processed: int
    failed: int
    skipped: int
    commit: str | None
    outcomes: list[LectureOutcome]


def _cancel_requested(cancel_file: Path | None) -> bool:
    return cancel_file is not None and cancel_file.exists()


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    cancel_file: Path | None = None,
) -> RunResult:
    root = Path(root)
    emitter.run_started(root=str(root), model_id=model_id, provider=provider.name)

    sources = dirty_sources(root)
    validate_single_source_per_lecture(sources)

    if not sources:
        emitter.nothing_to_process()
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    cache = CacheDir(root, settings.cache_dir_name)
    outcomes: list[LectureOutcome] = []
    commit_paths: list[Path] = []
    processed = failed = 0
    cancelled = False

    for src in sources:
        if _cancel_requested(cancel_file):
            cancelled = True
            emitter.cancelled(after_lecture=len(outcomes))
            break

        lecture_dir_rel = str(src.lecture_dir)
        abs_source = root / src.path
        abs_dir = root / src.lecture_dir
        emitter.lecture_started(lecture_dir=lecture_dir_rel, source=str(src.path))

        # Discover ------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="start")
        if not abs_source.is_file() or abs_source.stat().st_size == 0:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="fail")
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="discover", message="Source missing or empty")
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "discover", "Source missing or empty"))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="discover", status="ok")

        source_hash = hash_file(abs_source)

        # Prepare -------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="start")
        try:
            prep: PrepareResult = prepare_source(
                abs_source,
                src.source_type,
                source_hash,
                cache,
                settings,
                on_warning=lambda m, d=lecture_dir_rel: emitter.warning(lecture_dir=d, message=m),
            )
        except PrepareError as e:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="prepare", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "prepare", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="prepare", status="ok", detail=prep.processing_path)

        # Generate ------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="start")
        request = ProviderRequest(
            prompt=build_prompt(abs_source.name, prep),
            model_id=model_id,
            image_paths=[p.resolve() for p in prep.image_paths],
            cwd=abs_dir,
        )
        try:
            result = provider.run(request)
            validate_digest(result.markdown)
        except (DigestError, Exception) as e:  # provider errors surface here
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="generate", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "generate", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="ok")

        # Write ---------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="start")
        try:
            lecture_md = abs_dir / "lecture.md"
            metadata_json = abs_dir / "metadata.json"
            lecture_md.write_text(result.markdown if result.markdown.endswith("\n") else result.markdown + "\n")
            meta = build_metadata(abs_source, src.source_type, source_hash, model_id, prep.processing_path)
            write_metadata(meta, metadata_json)
            if lecture_md.stat().st_size == 0 or metadata_json.stat().st_size == 0:
                raise OSError("Wrote empty digest artifacts")
        except OSError as e:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="write", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "write", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="ok")

        processed += 1
        paths = [src.path, src.lecture_dir / "lecture.md", src.lecture_dir / "metadata.json"]
        commit_paths.extend(paths)
        emitter.lecture_done(lecture_dir=lecture_dir_rel)
        outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), True, committed_paths=paths))

    commit = None
    if commit_paths:
        ensure_gitignored(root, settings.cache_dir_name)
        commit_paths.append(Path(".gitignore"))
        done_dirs = [o.lecture_dir for o in outcomes if o.ok]
        message = "digest: " + ", ".join(done_dirs)
        commit = commit_batch(root, commit_paths, message)
        emitter.committed(commit=commit, lectures=done_dirs)

    skipped = 0  # unchanged sources never enter `sources`
    emitter.run_done(processed=processed, failed=failed, skipped=skipped)
    if cancelled:
        pass
    return RunResult(processed, failed, skipped, commit, outcomes)
```

> Note on the Generate `except (DigestError, Exception)`: this deliberately catches provider failures (`ProviderError`) and digest validation together so a bad lecture never aborts the batch. It is intentional, not a lint slip.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_pipeline.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/pipeline.py python/tests/test_pipeline.py
git commit -m "feat(worker): staged per-lecture pipeline with resume, cancel, batch commit"
```

---

### Task 16: Command handlers + CLI wiring

**Files:**
- Create: `python/src/arbor_worker/commands.py`
- Modify: `python/tests/test_cli.py` (add end-to-end tests)

**Interfaces:**
- Consumes: `auth`, `settings`, `pipeline`, `provider.codex`, `provider.fake`, `events`.
- Produces:
  - `cmd_check_auth(args) -> int`: prints one JSON object `{"authenticated": bool, "reason": str, "docs_url": str}` to stdout; returns 0 if authenticated else 1.
  - `cmd_list_models(args) -> int`: prints JSON `{"models": [{"id","label"}...]}` from `settings.load_models(cwd)` (uses `--root` if provided else cwd); returns 0.
  - `cmd_update(args) -> int`: builds emitter on stdout; runs auth gate (for `--provider codex`); on auth fail emits `auth_failed` and returns 3; selects provider (`codex` → `CodexCliProvider(load_models(root))`; `fake` → `FakeProvider` reading `ARBOR_FAKE_MD` env, defaulting to a valid digest); calls `run_update`; returns 0 if `failed == 0` else 1.
- Modify `cmd_list_models` to accept optional `--root` (add arg in Task 1 parser? It is not there). To avoid changing the parser signature, `cmd_list_models` reads `getattr(args, "root", None)`. Add `--root` to the `list-models` subparser now.

- [ ] **Step 1: Add `--root` to list-models parser**

In `python/src/arbor_worker/cli.py`, replace the line:

```python
    sub.add_parser("list-models", help="List selectable models as JSON.")
```

with:

```python
    lm = sub.add_parser("list-models", help="List selectable models as JSON.")
    lm.add_argument("--root", default=None, help="Knowledge root to read .arbor/models.json from.")
```

- [ ] **Step 2: Write the failing end-to-end tests**

Append to `python/tests/test_cli.py`:

```python
import json as _json
from pathlib import Path


def test_list_models_default(tmp_path):
    code, out, _ = run(["list-models", "--root", str(tmp_path)])
    assert code == 0
    data = _json.loads(out)
    assert "models" in data and len(data["models"]) >= 1
    assert {"id", "label"} <= set(data["models"][0].keys())


def test_update_with_fake_provider_processes(tmp_path, monkeypatch):
    import subprocess
    # build a git repo with one pdf
    root = tmp_path / "K"
    root.mkdir()
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@a.b"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "T"], check=True)
    (root / ".gitignore").write_text("_arbor_cache/\n")
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init"], check=True)
    import fitz
    d = root / "Bio" / "L1"
    d.mkdir(parents=True)
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "hi")
    doc.save(str(d / "source.pdf"))
    doc.close()

    good = (
        "# L\n## Overview\nlong enough overview sentence here for validation.\n"
        "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", good)
    code, out, _ = run(["update", "--root", str(root), "--model", "m", "--provider", "fake"])
    assert code == 0
    types = [e["type"] for e in [__import__("json").loads(l) for l in out.splitlines() if l.strip()]]
    assert "committed" in types
    assert (d / "lecture.md").exists()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: FAIL — `cmd_*` handlers not importable (`arbor_worker.commands` missing).

- [ ] **Step 4: Implement command handlers**

Create `python/src/arbor_worker/commands.py`:

```python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from arbor_worker.auth import check_codex_auth
from arbor_worker.events import EventEmitter
from arbor_worker.pipeline import run_update
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings, load_models

_DEFAULT_FAKE_MD = (
    "# Lecture\n## Overview\nThis is a fake digest overview long enough to validate.\n"
    "## Key Concepts\n- concept\n## Important Details\n- detail\n"
    "## Questions to Review\n- question?\n"
)


def cmd_check_auth(args) -> int:
    settings = default_settings()
    res = check_codex_auth()
    print(json.dumps({
        "authenticated": res.ok,
        "reason": res.reason,
        "docs_url": settings.docs_url,
    }))
    return 0 if res.ok else 1


def cmd_list_models(args) -> int:
    root = Path(getattr(args, "root", None) or ".")
    models = load_models(root)
    print(json.dumps({"models": [{"id": m.id, "label": m.label} for m in models]}))
    return 0


def cmd_update(args) -> int:
    settings = default_settings()
    root = Path(args.root)
    emitter = EventEmitter(sys.stdout)

    if args.provider == "codex":
        auth = check_codex_auth()
        if not auth.ok:
            emitter.auth_failed(reason=auth.reason, docs_url=settings.docs_url)
            return 3
        provider = CodexCliProvider(models=load_models(root))
    else:
        provider = FakeProvider(markdown=os.environ.get("ARBOR_FAKE_MD", _DEFAULT_FAKE_MD))

    cancel_file = Path(args.cancel_file) if args.cancel_file else None
    try:
        result = run_update(root, args.model, provider, emitter, settings, cancel_file=cancel_file)
    except Exception as e:  # surface unexpected failures as an error event
        emitter.error(message=str(e))
        return 1
    return 0 if result.failed == 0 else 1
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite**

Run: `cd python && uv run pytest -q`
Expected: PASS (all tests across all files green).

- [ ] **Step 7: Commit**

```bash
git add python/src/arbor_worker/cli.py python/src/arbor_worker/commands.py python/tests/test_cli.py
git commit -m "feat(worker): wire check-auth, list-models, update commands"
```

---

### Task 17: Worker docs — event schema + manual live check

**Files:**
- Modify: `python/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the event schema and live check**

Append to `python/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add python/README.md
git commit -m "docs(worker): document event schema and live check"
```

---

## Self-Review

**Spec coverage check (spec section → task):**
- Auth gate first → Task 6 (`auth`), enforced in Task 16 (`cmd_update` returns 3 before any work) and asserted via `--provider codex` path.
- Git-as-state (new/modified sources only; digest-only edits ignored; unchanged skipped) → Task 14 (`dirty_sources`, `test_digest_only_edits_do_not_count`).
- One commit per batch, successes only, `digest:` message → Task 15 (`commit_paths`, `commit_batch`) + Task 14 test.
- metadata.json exact keys → Task 13 (`test_build_has_all_spec_keys`).
- Digest required sections → Task 12 (`REQUIRED_SECTIONS`, `validate_digest`).
- PDF → images; PPTX → text; thin PPTX → image fallback → Tasks 10, 11.
- Cache keyed by hash + resume + gitignored → Tasks 5, 11 (resume), 15 (`ensure_gitignored`, not committed).
- Sequential processing → Task 15 (loop).
- Model passed to provider + recorded → Task 15 (`ProviderRequest.model_id`), Task 13 (metadata), asserted in `test_processes_pdf_and_commits`.
- Provider interface + Codex only + Fake for tests → Tasks 8, 9.
- Codex exec exact flags → Task 9 (`build_argv` test).
- Cancel at stage boundary, no partial commit → Task 15 (`test_cancel_before_second_lecture`).
- Error handling table rows → Tasks 15/16 (discover/prepare/generate/write failures; auth; nothing-to-process).

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The seeded model ids are real, user-editable values, not placeholders.

**Type consistency:** `Model`, `ProviderRequest(prompt, model_id, image_paths, cwd)`, `ProviderResult(markdown)`, `PrepareResult(processing_path, image_paths, text, detail)`, `LectureSource(path, lecture_dir, source_type)` are used identically across Tasks 8–16. `processing_path` values (`pdf_images`/`pptx_text`/`pptx_images_fallback`) match spec and metadata. Event type names match the schema table.

**Known trade-off (recorded, not a gap):** PPTX image fallback needs LibreOffice (`soffice`). When absent, Prepare fails with an actionable message telling the user to export as PDF — consistent with the spec's UI guidance. This is intentional for V1.
