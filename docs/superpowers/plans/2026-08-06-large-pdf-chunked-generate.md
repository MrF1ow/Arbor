# Large-PDF Chunked Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process large image-based lectures (PDF and PPTX image fallback) as fixed page-window chunks run with bounded concurrency, tracked and resumable in the cache, then synthesized into a single coherent `lecture.md`.

**Architecture:** Prepare is unchanged (still renders all pages). The `generate` stage in `pipeline.py` branches: `<= threshold` pages keeps today's single-shot `codex exec`; above threshold delegates to a new `chunked_generate` orchestrator that plans fixed page windows, runs chunk digests concurrently through the `CliProvider`, persists per-chunk status/digests in `_arbor_cache/<hash>/chunks.json` + `chunk-NNNN.md`, then runs one text-only synthesis pass over the ordered chunk digests. A shared `errors.py` holds stable error codes/exceptions.

**Tech Stack:** Python 3.11+, stdlib `concurrent.futures` (no new dependencies), PyMuPDF (existing), pytest with `FakeProvider`.

**Spec:** [docs/superpowers/specs/2026-08-06-large-pdf-chunked-generate-design.md](../specs/2026-08-06-large-pdf-chunked-generate-design.md)
**Issue:** [#2](https://github.com/MrF1ow/Arbor/issues/2)

## Global Constraints

- Python `>=3.11`; run tests with `cd python && uv run pytest -q`.
- No new runtime dependencies — concurrency uses stdlib `concurrent.futures`.
- All worker events are single-line JSON on the existing `EventEmitter` stream.
- Dataclasses are `frozen=True` where they model values (follow existing files).
- Chunking applies only when `prep.text is None` (image paths present), covering `pdf_images` and `pptx_images_fallback`. Text PPTX stays single-shot.
- Defaults: threshold `> 25` pages, chunk size `25`, concurrency `2`.
- Cancellation is cooperative: checked before submitting each chunk and before synthesis; in-flight chunks may finish and be saved.
- Settings UI is out of scope (V2). Knobs live in `WorkerSettings` only.
- Preserve existing final artifacts and their validation: `lecture.md` (passes `validate_digest`) and `metadata.json`.

---

## Prerequisite: work on a feature branch

- [ ] **Step 1: Create and switch to the feature branch**

```bash
cd /home/flow/Projects/personal/Arbor
git checkout -b feat/large-pdf-chunking
```

---

## Task 1: Chunking settings knobs

**Files:**
- Modify: `python/src/arbor_worker/settings.py`
- Test: `python/tests/test_settings.py`

**Interfaces:**
- Produces: `WorkerSettings.pdf_chunk_threshold_pages: int`, `WorkerSettings.pdf_chunk_size_pages: int`, `WorkerSettings.pdf_chunk_concurrency: int` (defaults `25`, `25`, `2`).

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_settings.py`:

```python
def test_chunking_defaults():
    from arbor_worker.settings import default_settings

    s = default_settings()
    assert s.pdf_chunk_threshold_pages == 25
    assert s.pdf_chunk_size_pages == 25
    assert s.pdf_chunk_concurrency == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_settings.py::test_chunking_defaults -v`
Expected: FAIL with `AttributeError: ... pdf_chunk_threshold_pages`

- [ ] **Step 3: Add the fields**

In `python/src/arbor_worker/settings.py`, inside `WorkerSettings` (after `pdf_warn_pages`):

```python
    pdf_chunk_threshold_pages: int = 25
    pdf_chunk_size_pages: int = 25
    pdf_chunk_concurrency: int = 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_settings.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/settings.py python/tests/test_settings.py
git commit -m "feat(worker): add chunking settings knobs"
```

---

## Task 2: Shared error util

**Files:**
- Create: `python/src/arbor_worker/errors.py`
- Test: `python/tests/test_errors.py`

**Interfaces:**
- Produces: string codes `CHUNK_GENERATE_FAILED`, `SYNTHESIS_FAILED`; classes `ArborError(message, code=None)` with `.message` and `.code`; `ChunkGenerateError` (code `CHUNK_GENERATE_FAILED`), `SynthesisError` (code `SYNTHESIS_FAILED`).

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_errors.py`:

```python
from arbor_worker.errors import (
    CHUNK_GENERATE_FAILED,
    SYNTHESIS_FAILED,
    ArborError,
    ChunkGenerateError,
    SynthesisError,
)


def test_error_codes_and_messages():
    e = ChunkGenerateError("boom")
    assert isinstance(e, ArborError)
    assert e.code == CHUNK_GENERATE_FAILED
    assert e.message == "boom"

    s = SynthesisError("nope")
    assert s.code == SYNTHESIS_FAILED
    assert str(s) == "nope"

    custom = ArborError("x", code="CUSTOM")
    assert custom.code == "CUSTOM"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_errors.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.errors'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/errors.py`:

```python
from __future__ import annotations

CHUNK_GENERATE_FAILED = "CHUNK_GENERATE_FAILED"
SYNTHESIS_FAILED = "SYNTHESIS_FAILED"


class ArborError(Exception):
    code = "ERROR"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class ChunkGenerateError(ArborError):
    code = CHUNK_GENERATE_FAILED


class SynthesisError(ArborError):
    code = SYNTHESIS_FAILED
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_errors.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/errors.py python/tests/test_errors.py
git commit -m "feat(worker): add shared error codes and exceptions"
```

---

## Task 3: Chunk and synthesis event wrappers

**Files:**
- Modify: `python/src/arbor_worker/events.py`
- Test: `python/tests/test_events.py`

**Interfaces:**
- Produces: `EventEmitter.chunk_started/chunk_done/chunk_failed/synthesis_started/synthesis_done/synthesis_failed(**fields)`, each emitting an event whose `type` matches the method name.

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_events.py`:

```python
def test_chunk_and_synthesis_events():
    import io
    from arbor_worker.events import EventEmitter, parse_lines

    buf = io.StringIO()
    em = EventEmitter(buf)
    em.chunk_started(lecture_dir="Bio/L1", chunk_id="0001", page_start=1, page_end=25, index=1, total=3)
    em.chunk_done(lecture_dir="Bio/L1", chunk_id="0001", page_start=1, page_end=25, index=1, total=3)
    em.chunk_failed(lecture_dir="Bio/L1", chunk_id="0002", page_start=26, page_end=50, code="CHUNK_GENERATE_FAILED", message="x")
    em.synthesis_started(lecture_dir="Bio/L1", chunk_count=3)
    em.synthesis_done(lecture_dir="Bio/L1")
    em.synthesis_failed(lecture_dir="Bio/L1", code="SYNTHESIS_FAILED", message="y")

    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types == [
        "chunk_started", "chunk_done", "chunk_failed",
        "synthesis_started", "synthesis_done", "synthesis_failed",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_events.py::test_chunk_and_synthesis_events -v`
Expected: FAIL with `AttributeError: 'EventEmitter' object has no attribute 'chunk_started'`

- [ ] **Step 3: Add the wrappers**

In `python/src/arbor_worker/events.py`, after the `error` wrapper:

```python
    def chunk_started(self, **f):
        return self.emit("chunk_started", **f)

    def chunk_done(self, **f):
        return self.emit("chunk_done", **f)

    def chunk_failed(self, **f):
        return self.emit("chunk_failed", **f)

    def synthesis_started(self, **f):
        return self.emit("synthesis_started", **f)

    def synthesis_done(self, **f):
        return self.emit("synthesis_done", **f)

    def synthesis_failed(self, **f):
        return self.emit("synthesis_failed", **f)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_events.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/events.py python/tests/test_events.py
git commit -m "feat(worker): add chunk and synthesis event wrappers"
```

---

## Task 4: Metadata generate-mode fields

**Files:**
- Modify: `python/src/arbor_worker/metadata.py`
- Test: `python/tests/test_metadata.py`

**Interfaces:**
- Produces: `Metadata` gains `generate_mode: str = "single"`, `chunk_count: int | None = None`, `chunk_size: int | None = None`, `page_ranges: list[str] | None = None`. `build_metadata(...)` gains keyword-only params `generate_mode="single"`, `chunk_count=None`, `chunk_size=None`, `page_ranges=None`.

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_metadata.py`:

```python
def test_build_metadata_chunked_fields(tmp_path):
    from pathlib import Path
    from arbor_worker.metadata import build_metadata, to_dict

    src = tmp_path / "source.pdf"
    src.write_bytes(b"%PDF-1.4")
    meta = build_metadata(
        Path(src), "pdf", "abc123", "gpt-5.6-sol", "pdf_images",
        generate_mode="chunked", chunk_count=3, chunk_size=25,
        page_ranges=["1-25", "26-50", "51-60"],
    )
    d = to_dict(meta)
    assert d["generate_mode"] == "chunked"
    assert d["chunk_count"] == 3
    assert d["chunk_size"] == 25
    assert d["page_ranges"] == ["1-25", "26-50", "51-60"]


def test_build_metadata_single_default(tmp_path):
    from pathlib import Path
    from arbor_worker.metadata import build_metadata, to_dict

    src = tmp_path / "source.pdf"
    src.write_bytes(b"%PDF-1.4")
    meta = build_metadata(Path(src), "pdf", "abc123", "m", "pdf_images")
    d = to_dict(meta)
    assert d["generate_mode"] == "single"
    assert d["chunk_count"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_metadata.py -k build_metadata -v`
Expected: FAIL with `TypeError: build_metadata() got an unexpected keyword argument 'generate_mode'`

- [ ] **Step 3: Extend the dataclass and builder**

In `python/src/arbor_worker/metadata.py`, extend `Metadata` (add after `status`):

```python
    generate_mode: str = "single"
    chunk_count: int | None = None
    chunk_size: int | None = None
    page_ranges: list[str] | None = None
```

Replace `build_metadata` with:

```python
def build_metadata(
    source: Path,
    source_type: str,
    source_hash: str,
    model_id: str,
    processing_path: str,
    *,
    generate_mode: str = "single",
    chunk_count: int | None = None,
    chunk_size: int | None = None,
    page_ranges: list[str] | None = None,
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
        generate_mode=generate_mode,
        chunk_count=chunk_count,
        chunk_size=chunk_size,
        page_ranges=page_ranges,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_metadata.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/metadata.py python/tests/test_metadata.py
git commit -m "feat(worker): record generate mode and chunk summary in metadata"
```

---

## Task 5: Chunk and synthesis prompts

**Files:**
- Modify: `python/src/arbor_worker/digest.py`
- Test: `python/tests/test_digest.py`

**Interfaces:**
- Produces:
  - `build_chunk_prompt(source_name: str, page_start: int, page_end: int, total_pages: int, image_count: int) -> str`
  - `build_synthesis_prompt(source_name: str, chunk_digests: list[str]) -> str`
  - `validate_chunk_digest(markdown: str) -> None` (raises `DigestError` when empty/too short)
- Consumes: existing `DigestError`, `validate_digest`, `_MIN_BODY_CHARS`.

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_digest.py`:

```python
def test_build_chunk_prompt_includes_page_range():
    from arbor_worker.digest import build_chunk_prompt

    p = build_chunk_prompt("source.pdf", page_start=26, page_end=50, total_pages=129, image_count=25)
    assert "26" in p and "50" in p and "129" in p
    assert "source.pdf" in p


def test_build_synthesis_prompt_orders_parts():
    from arbor_worker.digest import build_synthesis_prompt

    p = build_synthesis_prompt("source.pdf", ["PART A body", "PART B body"])
    assert p.index("PART A body") < p.index("PART B body")
    assert "## Questions to Review" in p


def test_validate_chunk_digest():
    import pytest
    from arbor_worker.digest import DigestError, validate_chunk_digest

    validate_chunk_digest("## Overview\n" + "content that is clearly long enough to pass validation")
    with pytest.raises(DigestError):
        validate_chunk_digest("   ")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_digest.py -k "chunk or synthesis" -v`
Expected: FAIL with `ImportError: cannot import name 'build_chunk_prompt'`

- [ ] **Step 3: Add prompts and validator**

Append to `python/src/arbor_worker/digest.py`:

```python
_CHUNK_TEMPLATE = """You are creating structured study notes from PART of a graduate lecture.

This part covers pages {page_start}-{page_end} of {total_pages}.

{image_count} page image(s) for this part are attached. Read all of them, including
any handwritten annotations, and produce concise structured notes for THIS PART
ONLY, as GitHub-flavored Markdown with these sections:

## Overview
## Key Concepts
## Important Details

Do not invent content from other parts of the lecture. Output only Markdown, no
preamble or code fences.

Source file: {source_name}
"""

_SYNTHESIS_TEMPLATE = """You are assembling final study notes for a single graduate lecture from
ordered notes about consecutive parts of that lecture.

Combine the part notes below into ONE coherent digest. Merge duplicate points,
keep the logical order, and do not lose important details. Output ONLY
GitHub-flavored Markdown, no preamble or code fences, using exactly these
sections in this order:

# <a concise lecture title>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 2-4 sentence summary of the whole lecture.
- Key Concepts: bulleted list of the main ideas across all parts.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 3-6 self-test questions covering the whole lecture.

Source file: {source_name}

The part notes are below, in order, between markers.
"""


def build_chunk_prompt(
    source_name: str,
    page_start: int,
    page_end: int,
    total_pages: int,
    image_count: int,
) -> str:
    return _CHUNK_TEMPLATE.format(
        source_name=source_name,
        page_start=page_start,
        page_end=page_end,
        total_pages=total_pages,
        image_count=image_count,
    )


def build_synthesis_prompt(source_name: str, chunk_digests: list[str]) -> str:
    prompt = _SYNTHESIS_TEMPLATE.format(source_name=source_name)
    for i, digest in enumerate(chunk_digests, start=1):
        prompt += (
            f"\n-----BEGIN PART {i}-----\n"
            f"{digest}\n"
            f"-----END PART {i}-----\n"
        )
    return prompt


def validate_chunk_digest(markdown: str) -> None:
    if len(markdown.strip()) < _MIN_BODY_CHARS:
        raise DigestError("Chunk digest is empty or too short")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_digest.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/digest.py python/tests/test_digest.py
git commit -m "feat(worker): add chunk and synthesis prompt builders"
```

---

## Task 6: Chunk planner

**Files:**
- Create: `python/src/arbor_worker/chunking.py`
- Test: `python/tests/test_chunking.py`

**Interfaces:**
- Produces:
  - `ChunkPlan` (frozen dataclass): `chunk_id: str`, `index: int`, `total: int`, `page_start: int`, `page_end: int`, `image_paths: list[Path]`.
  - `plan_chunks(image_paths: list[Path], chunk_size: int) -> list[ChunkPlan]` — 1-based inclusive page ranges, zero-padded 4-digit `chunk_id`, raises `ValueError` if `chunk_size < 1`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_chunking.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.chunking import ChunkPlan, plan_chunks


def _imgs(n):
    return [Path(f"page-{i + 1:05d}.png") for i in range(n)]


def test_plan_chunks_129_pages():
    plans = plan_chunks(_imgs(129), 25)
    assert len(plans) == 6
    assert plans[0].chunk_id == "0001"
    assert (plans[0].page_start, plans[0].page_end) == (1, 25)
    assert (plans[1].page_start, plans[1].page_end) == (26, 50)
    assert (plans[-1].page_start, plans[-1].page_end) == (126, 129)
    assert plans[-1].total == 6 and plans[-1].index == 6
    assert len(plans[-1].image_paths) == 4
    # ordered and non-overlapping
    assert [p.image_paths[0] for p in plans] == [
        Path("page-00001.png"), Path("page-00026.png"), Path("page-00051.png"),
        Path("page-00076.png"), Path("page-00101.png"), Path("page-00126.png"),
    ]


def test_plan_chunks_exact_multiple():
    plans = plan_chunks(_imgs(50), 25)
    assert len(plans) == 2
    assert (plans[1].page_start, plans[1].page_end) == (26, 50)


def test_plan_chunks_rejects_bad_size():
    with pytest.raises(ValueError):
        plan_chunks(_imgs(10), 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_chunking.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.chunking'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/chunking.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ChunkPlan:
    chunk_id: str
    index: int
    total: int
    page_start: int
    page_end: int
    image_paths: list[Path]


def plan_chunks(image_paths: list[Path], chunk_size: int) -> list[ChunkPlan]:
    if chunk_size < 1:
        raise ValueError("chunk_size must be >= 1")
    ordered = list(image_paths)
    n = len(ordered)
    total = (n + chunk_size - 1) // chunk_size
    plans: list[ChunkPlan] = []
    for i in range(total):
        start = i * chunk_size
        end = min(start + chunk_size, n)
        plans.append(
            ChunkPlan(
                chunk_id=f"{i + 1:04d}",
                index=i + 1,
                total=total,
                page_start=start + 1,
                page_end=end,
                image_paths=ordered[start:end],
            )
        )
    return plans
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_chunking.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/chunking.py python/tests/test_chunking.py
git commit -m "feat(worker): add fixed-window chunk planner"
```

---

## Task 7: Chunk manifest (cache state)

**Files:**
- Create: `python/src/arbor_worker/chunk_manifest.py`
- Test: `python/tests/test_chunk_manifest.py`

**Interfaces:**
- Consumes: `ChunkPlan` from Task 6.
- Produces: `ChunkManifest` with:
  - classmethod `load_or_create(cache_dir: Path, *, plans: list[ChunkPlan], chunk_size: int, page_count: int, model_id: str) -> ChunkManifest`
  - `pending_chunks() -> list[dict]` (status != `"ok"`, in index order)
  - `all_ok() -> bool`
  - `mark_ok(chunk_id: str, digest_name: str) -> None`
  - `mark_failed(chunk_id: str, error: str) -> None`
  - `set_synthesis(status: str, error: str | None = None) -> None`
  - `ordered_digests() -> list[str]` (reads `chunk-NNNN.md` in index order)
  - `page_ranges() -> list[str]` (e.g. `["1-25", "26-50"]`)
  - attribute `cache_dir: Path`, `data: dict`
- Behavior: rebuilds fresh manifest when the file is missing or when `chunk_size`/`page_count`/`model_id` differ; when they match, preserves chunks previously `"ok"` whose `chunk-<id>.md` exists and is non-empty.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_chunk_manifest.py`:

```python
from pathlib import Path

from arbor_worker.chunk_manifest import ChunkManifest
from arbor_worker.chunking import plan_chunks


def _imgs(n):
    return [Path(f"page-{i + 1:05d}.png") for i in range(n)]


def test_create_and_track(tmp_path: Path):
    plans = plan_chunks(_imgs(60), 25)  # 3 chunks
    m = ChunkManifest.load_or_create(
        tmp_path, plans=plans, chunk_size=25, page_count=60, model_id="m"
    )
    assert len(m.pending_chunks()) == 3
    assert m.all_ok() is False
    assert m.page_ranges() == ["1-25", "26-50", "51-60"]

    (tmp_path / "chunk-0001.md").write_text("## Overview\nlong enough body content here\n")
    m.mark_ok("0001", "chunk-0001.md")
    assert [c["id"] for c in m.pending_chunks()] == ["0002", "0003"]

    m.mark_failed("0002", "boom")
    assert any(c["id"] == "0002" and c["status"] == "failed" for c in m.data["chunks"])
    assert m.data["chunks"][1]["error"] == "boom"


def test_reload_preserves_ok_chunks(tmp_path: Path):
    plans = plan_chunks(_imgs(60), 25)
    m = ChunkManifest.load_or_create(tmp_path, plans=plans, chunk_size=25, page_count=60, model_id="m")
    (tmp_path / "chunk-0001.md").write_text("## Overview\nlong enough body content here\n")
    m.mark_ok("0001", "chunk-0001.md")

    m2 = ChunkManifest.load_or_create(tmp_path, plans=plans, chunk_size=25, page_count=60, model_id="m")
    ok_ids = [c["id"] for c in m2.data["chunks"] if c["status"] == "ok"]
    assert ok_ids == ["0001"]
    assert [c["id"] for c in m2.pending_chunks()] == ["0002", "0003"]


def test_plan_change_resets(tmp_path: Path):
    plans = plan_chunks(_imgs(60), 25)
    m = ChunkManifest.load_or_create(tmp_path, plans=plans, chunk_size=25, page_count=60, model_id="m")
    (tmp_path / "chunk-0001.md").write_text("## Overview\nlong enough body content here\n")
    m.mark_ok("0001", "chunk-0001.md")

    # Different model -> fresh manifest, nothing preserved.
    m2 = ChunkManifest.load_or_create(tmp_path, plans=plans, chunk_size=25, page_count=60, model_id="other")
    assert all(c["status"] == "pending" for c in m2.data["chunks"])


def test_ordered_digests(tmp_path: Path):
    plans = plan_chunks(_imgs(50), 25)
    m = ChunkManifest.load_or_create(tmp_path, plans=plans, chunk_size=25, page_count=50, model_id="m")
    (tmp_path / "chunk-0001.md").write_text("A\n")
    (tmp_path / "chunk-0002.md").write_text("B\n")
    m.mark_ok("0001", "chunk-0001.md")
    m.mark_ok("0002", "chunk-0002.md")
    assert m.ordered_digests() == ["A\n", "B\n"]
    assert m.all_ok() is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_chunk_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.chunk_manifest'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/chunk_manifest.py`:

```python
from __future__ import annotations

import json
from pathlib import Path

from arbor_worker.chunking import ChunkPlan


class ChunkManifest:
    FILENAME = "chunks.json"

    def __init__(self, cache_dir: Path, data: dict):
        self.cache_dir = Path(cache_dir)
        self.data = data

    @property
    def path(self) -> Path:
        return self.cache_dir / self.FILENAME

    @classmethod
    def load_or_create(
        cls,
        cache_dir: Path,
        *,
        plans: list[ChunkPlan],
        chunk_size: int,
        page_count: int,
        model_id: str,
    ) -> "ChunkManifest":
        cache_dir = Path(cache_dir)
        path = cache_dir / cls.FILENAME
        fresh = {
            "chunk_size": chunk_size,
            "page_count": page_count,
            "model_id": model_id,
            "chunks": [
                {
                    "id": p.chunk_id,
                    "index": p.index,
                    "page_start": p.page_start,
                    "page_end": p.page_end,
                    "status": "pending",
                    "digest_path": None,
                    "error": None,
                }
                for p in plans
            ],
            "synthesis": {"status": "pending", "error": None},
        }
        if path.is_file():
            try:
                existing = json.loads(path.read_text())
            except json.JSONDecodeError:
                existing = None
            if existing and (
                existing.get("chunk_size") == chunk_size
                and existing.get("page_count") == page_count
                and existing.get("model_id") == model_id
            ):
                by_id = {c["id"]: c for c in existing.get("chunks", [])}
                for chunk in fresh["chunks"]:
                    prev = by_id.get(chunk["id"])
                    if prev and prev.get("status") == "ok":
                        digest = cache_dir / f"chunk-{chunk['id']}.md"
                        if digest.is_file() and digest.read_text().strip():
                            chunk["status"] = "ok"
                            chunk["digest_path"] = digest.name
        manifest = cls(cache_dir, fresh)
        manifest.save()
        return manifest

    def save(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def _sorted_chunks(self) -> list[dict]:
        return sorted(self.data["chunks"], key=lambda c: c["index"])

    def pending_chunks(self) -> list[dict]:
        return [c for c in self._sorted_chunks() if c["status"] != "ok"]

    def all_ok(self) -> bool:
        return all(c["status"] == "ok" for c in self.data["chunks"])

    def mark_ok(self, chunk_id: str, digest_name: str) -> None:
        for c in self.data["chunks"]:
            if c["id"] == chunk_id:
                c["status"] = "ok"
                c["digest_path"] = digest_name
                c["error"] = None
        self.save()

    def mark_failed(self, chunk_id: str, error: str) -> None:
        for c in self.data["chunks"]:
            if c["id"] == chunk_id:
                c["status"] = "failed"
                c["digest_path"] = None
                c["error"] = error
        self.save()

    def set_synthesis(self, status: str, error: str | None = None) -> None:
        self.data["synthesis"] = {"status": status, "error": error}
        self.save()

    def ordered_digests(self) -> list[str]:
        return [
            (self.cache_dir / f"chunk-{c['id']}.md").read_text()
            for c in self._sorted_chunks()
        ]

    def page_ranges(self) -> list[str]:
        return [f"{c['page_start']}-{c['page_end']}" for c in self._sorted_chunks()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_chunk_manifest.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/chunk_manifest.py python/tests/test_chunk_manifest.py
git commit -m "feat(worker): add resumable chunk manifest"
```

---

## Task 8: Chunked generate orchestrator

**Files:**
- Create: `python/src/arbor_worker/chunk_generate.py`
- Test: `python/tests/test_chunk_generate.py`

**Interfaces:**
- Consumes: `plan_chunks`/`ChunkPlan` (Task 6), `ChunkManifest` (Task 7), `build_chunk_prompt`/`build_synthesis_prompt`/`validate_chunk_digest`/`validate_digest`/`DigestError` (Task 5), `ChunkGenerateError`/`SynthesisError` (Task 2), `EventEmitter` chunk/synth wrappers (Task 3), `CliProvider`/`ProviderRequest` (existing).
- Produces:
  - `ChunkedResult` (frozen dataclass): `markdown: str`, `chunk_count: int`, `chunk_size: int`, `page_ranges: list[str]`.
  - `chunked_generate(provider, *, source_name, image_paths, model_id, cwd, cache_dir, chunk_size, concurrency, emitter, lecture_dir, cancel_requested) -> ChunkedResult`.
    - `cancel_requested` is a zero-arg callable returning `bool`.
    - Raises `ChunkGenerateError` if any chunk fails or run stops before all chunks are `ok` (e.g. cancel); raises `SynthesisError` if synthesis fails/invalid. Completed chunk digests remain in cache in all cases.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_chunk_generate.py`:

```python
import io
from pathlib import Path

import pytest

from arbor_worker.chunk_generate import ChunkedResult, chunked_generate
from arbor_worker.errors import ChunkGenerateError, SynthesisError
from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult

GOOD_MD = (
    "# Lecture\n## Overview\nThis overview is definitely long enough to pass.\n"
    "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
)


class SeqProvider:
    """Returns a fixed markdown; optionally fails on the Nth call (1-based)."""

    name = "seq"

    def __init__(self, markdown=GOOD_MD, fail_on=None, fail_msg="boom"):
        self.markdown = markdown
        self.fail_on = fail_on
        self.fail_msg = fail_msg
        self.calls = []

    def is_available(self):
        return True

    def list_models(self):
        return [Model("m", "M")]

    def run(self, request: ProviderRequest) -> ProviderResult:
        self.calls.append(request)
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            raise RuntimeError(self.fail_msg)
        return ProviderResult(markdown=self.markdown)


def _emitter():
    buf = io.StringIO()
    return EventEmitter(buf), buf


def _imgs(tmp_path, n):
    paths = []
    for i in range(n):
        p = tmp_path / f"page-{i + 1:05d}.png"
        p.write_bytes(b"img")
        paths.append(p)
    return paths


def test_happy_path_synthesizes(tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    images = _imgs(tmp_path, 5)
    prov = SeqProvider()
    em, buf = _emitter()

    res = chunked_generate(
        prov,
        source_name="source.pdf",
        image_paths=images,
        model_id="m",
        cwd=tmp_path,
        cache_dir=cache,
        chunk_size=2,
        concurrency=2,
        emitter=em,
        lecture_dir="Bio/L1",
        cancel_requested=lambda: False,
    )
    assert isinstance(res, ChunkedResult)
    assert res.chunk_count == 3 and res.chunk_size == 2
    assert res.page_ranges == ["1-2", "3-4", "5-5"]
    assert res.markdown.startswith("# Lecture")
    # 3 chunk calls + 1 synthesis call
    assert len(prov.calls) == 4
    # synthesis call carried no images
    assert prov.calls[-1].image_paths == []
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types.count("chunk_done") == 3
    assert "synthesis_done" in types


def test_chunk_failure_raises_and_preserves_ok(tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    images = _imgs(tmp_path, 5)
    prov = SeqProvider(fail_on=1)  # first chunk fails
    em, buf = _emitter()

    with pytest.raises(ChunkGenerateError):
        chunked_generate(
            prov, source_name="source.pdf", image_paths=images, model_id="m",
            cwd=tmp_path, cache_dir=cache, chunk_size=2, concurrency=1,
            emitter=em, lecture_dir="Bio/L1", cancel_requested=lambda: False,
        )
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert "chunk_failed" in types
    assert "synthesis_started" not in types


def test_resume_reuses_ok_chunks(tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    images = _imgs(tmp_path, 5)

    # First run: synthesis fails after all chunks succeed (call 4 fails).
    prov1 = SeqProvider(fail_on=4)
    em1, _ = _emitter()
    with pytest.raises(SynthesisError):
        chunked_generate(
            prov1, source_name="source.pdf", image_paths=images, model_id="m",
            cwd=tmp_path, cache_dir=cache, chunk_size=2, concurrency=1,
            emitter=em1, lecture_dir="Bio/L1", cancel_requested=lambda: False,
        )
    assert len(prov1.calls) == 4  # 3 chunks + failed synthesis

    # Second run: chunks are cached; only synthesis should be called.
    prov2 = SeqProvider()
    em2, buf2 = _emitter()
    res = chunked_generate(
        prov2, source_name="source.pdf", image_paths=images, model_id="m",
        cwd=tmp_path, cache_dir=cache, chunk_size=2, concurrency=1,
        emitter=em2, lecture_dir="Bio/L1", cancel_requested=lambda: False,
    )
    assert res.markdown.startswith("# Lecture")
    assert len(prov2.calls) == 1  # synthesis only
    assert prov2.calls[0].image_paths == []


def test_cancel_stops_new_chunks(tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    images = _imgs(tmp_path, 6)  # 3 chunks of 2
    prov = SeqProvider()
    em, buf = _emitter()

    # Cancel immediately: no chunk should be submitted, run stops incomplete.
    with pytest.raises(ChunkGenerateError):
        chunked_generate(
            prov, source_name="source.pdf", image_paths=images, model_id="m",
            cwd=tmp_path, cache_dir=cache, chunk_size=2, concurrency=1,
            emitter=em, lecture_dir="Bio/L1", cancel_requested=lambda: True,
        )
    assert prov.calls == []
    assert "synthesis_started" not in [e["type"] for e in parse_lines(buf.getvalue())]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_chunk_generate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.chunk_generate'`

- [ ] **Step 3: Create the orchestrator**

Create `python/src/arbor_worker/chunk_generate.py`:

```python
from __future__ import annotations

from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path

from arbor_worker.chunk_manifest import ChunkManifest
from arbor_worker.chunking import ChunkPlan, plan_chunks
from arbor_worker.digest import (
    build_chunk_prompt,
    build_synthesis_prompt,
    validate_chunk_digest,
    validate_digest,
)
from arbor_worker.errors import ChunkGenerateError, SynthesisError
from arbor_worker.provider.base import CliProvider, ProviderRequest


@dataclass(frozen=True)
class ChunkedResult:
    markdown: str
    chunk_count: int
    chunk_size: int
    page_ranges: list[str]


def _run_one_chunk(provider, plan: ChunkPlan, *, source_name, total_pages, model_id, cwd) -> str:
    prompt = build_chunk_prompt(
        source_name=source_name,
        page_start=plan.page_start,
        page_end=plan.page_end,
        total_pages=total_pages,
        image_count=len(plan.image_paths),
    )
    request = ProviderRequest(
        prompt=prompt,
        model_id=model_id,
        image_paths=[p.resolve() for p in plan.image_paths],
        cwd=cwd,
    )
    result = provider.run(request)
    validate_chunk_digest(result.markdown)
    return result.markdown


def chunked_generate(
    provider: CliProvider,
    *,
    source_name: str,
    image_paths: list[Path],
    model_id: str,
    cwd: Path,
    cache_dir: Path,
    chunk_size: int,
    concurrency: int,
    emitter,
    lecture_dir: str,
    cancel_requested,
) -> ChunkedResult:
    cache_dir = Path(cache_dir)
    plans = plan_chunks(image_paths, chunk_size)
    plan_by_id = {p.chunk_id: p for p in plans}
    manifest = ChunkManifest.load_or_create(
        cache_dir,
        plans=plans,
        chunk_size=chunk_size,
        page_count=len(image_paths),
        model_id=model_id,
    )
    total_pages = len(image_paths)

    todo = deque(plan_by_id[c["id"]] for c in manifest.pending_chunks())
    fut_plan: dict = {}
    failed_error: str | None = None
    stopped = False

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        while True:
            while (
                failed_error is None
                and not stopped
                and todo
                and len(fut_plan) < max(1, concurrency)
            ):
                if cancel_requested():
                    stopped = True
                    break
                plan = todo.popleft()
                emitter.chunk_started(
                    lecture_dir=lecture_dir, chunk_id=plan.chunk_id,
                    page_start=plan.page_start, page_end=plan.page_end,
                    index=plan.index, total=plan.total,
                )
                fut = pool.submit(
                    _run_one_chunk, provider, plan,
                    source_name=source_name, total_pages=total_pages,
                    model_id=model_id, cwd=cwd,
                )
                fut_plan[fut] = plan

            if not fut_plan:
                break

            done, _ = wait(list(fut_plan), return_when=FIRST_COMPLETED)
            for fut in done:
                plan = fut_plan.pop(fut)
                try:
                    markdown = fut.result()
                except Exception as e:  # provider or validation failure
                    failed_error = str(e)
                    manifest.mark_failed(plan.chunk_id, failed_error)
                    emitter.chunk_failed(
                        lecture_dir=lecture_dir, chunk_id=plan.chunk_id,
                        page_start=plan.page_start, page_end=plan.page_end,
                        code=ChunkGenerateError.code, message=failed_error,
                    )
                    continue
                digest_name = f"chunk-{plan.chunk_id}.md"
                (cache_dir / digest_name).write_text(
                    markdown if markdown.endswith("\n") else markdown + "\n"
                )
                manifest.mark_ok(plan.chunk_id, digest_name)
                emitter.chunk_done(
                    lecture_dir=lecture_dir, chunk_id=plan.chunk_id,
                    page_start=plan.page_start, page_end=plan.page_end,
                    index=plan.index, total=plan.total,
                )

    if failed_error is not None:
        raise ChunkGenerateError(f"Chunk generation failed: {failed_error}")
    if not manifest.all_ok():
        raise ChunkGenerateError("Chunk generation incomplete (cancelled or stopped)")

    emitter.synthesis_started(lecture_dir=lecture_dir, chunk_count=len(plans))
    manifest.set_synthesis("pending")
    synth_prompt = build_synthesis_prompt(source_name, manifest.ordered_digests())
    try:
        result = provider.run(
            ProviderRequest(prompt=synth_prompt, model_id=model_id, cwd=cwd)
        )
        validate_digest(result.markdown)
    except Exception as e:
        manifest.set_synthesis("failed", str(e))
        emitter.synthesis_failed(
            lecture_dir=lecture_dir, code=SynthesisError.code, message=str(e)
        )
        raise SynthesisError(f"Synthesis failed: {e}")

    manifest.set_synthesis("ok")
    emitter.synthesis_done(lecture_dir=lecture_dir)
    return ChunkedResult(
        markdown=result.markdown,
        chunk_count=len(plans),
        chunk_size=chunk_size,
        page_ranges=manifest.page_ranges(),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_chunk_generate.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/chunk_generate.py python/tests/test_chunk_generate.py
git commit -m "feat(worker): add bounded concurrent chunk generate and synthesis"
```

---

## Task 9: Pipeline integration

**Files:**
- Modify: `python/src/arbor_worker/pipeline.py`
- Test: `python/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `chunked_generate`/`ChunkedResult` (Task 8), `ChunkGenerateError`/`SynthesisError` (Task 2), extended `build_metadata` (Task 4), settings knobs (Task 1).
- Behavior: in the `generate` stage, when `prep.text is None and len(prep.image_paths) > settings.pdf_chunk_threshold_pages`, use `chunked_generate`; otherwise keep the single-shot path. Produce a local `markdown` string and `generate_mode`/chunk fields used by the Write stage. Chunk/synthesis errors fail the lecture at the `generate` stage (excluded from commit), exactly like other generate failures.

- [ ] **Step 1: Write the failing tests**

Add to `python/tests/test_pipeline.py`:

```python
import dataclasses


def _chunk_settings(threshold=2, size=2, concurrency=1):
    return dataclasses.replace(
        default_settings(),
        pdf_chunk_threshold_pages=threshold,
        pdf_chunk_size_pages=size,
        pdf_chunk_concurrency=concurrency,
    )


def test_small_pdf_uses_single_shot(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=2)  # <= threshold 25 default
    prov = FakeProvider(GOOD_MD)
    res = run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), default_settings())
    assert res.processed == 1
    meta = (d / "metadata.json").read_text()
    assert '"generate_mode": "single"' in meta
    assert len(prov.calls) == 1  # one single-shot call


def test_large_pdf_uses_chunked(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=5)  # > threshold 2 -> chunked
    prov = FakeProvider(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, _chunk_settings())
    assert res.processed == 1 and res.failed == 0
    assert (d / "lecture.md").read_text().startswith("# Lecture")
    meta = (d / "metadata.json").read_text()
    assert '"generate_mode": "chunked"' in meta
    assert '"chunk_count": 3' in meta
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types.count("chunk_done") == 3
    assert "synthesis_done" in types
    # 3 chunk calls + 1 synthesis call
    assert len(prov.calls) == 4


def test_chunk_synthesis_failure_excluded_from_commit(git_repo: Path, make_pdf):
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=5)

    class SynthFails(FakeProvider):
        def run(self, request):
            self.calls.append(request)
            # chunk calls (with images) succeed; synthesis (no images) returns bad md
            if not request.image_paths:
                from arbor_worker.provider.base import ProviderResult
                return ProviderResult(markdown="too short")
            from arbor_worker.provider.base import ProviderResult
            return ProviderResult(markdown=GOOD_MD)

    prov = SynthFails(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, _chunk_settings())
    assert res.processed == 0 and res.failed == 1
    assert not (d / "lecture.md").exists()
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "lecture_failed" and e["stage"] == "generate" for e in events)
    assert any(e["type"] == "synthesis_failed" for e in events)
    assert not any(e["type"] == "committed" for e in events)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && uv run pytest tests/test_pipeline.py -k "chunk or single_shot or large_pdf" -v`
Expected: FAIL (single-shot test fails on missing `generate_mode` in metadata; chunked tests fail because pipeline never chunks)

- [ ] **Step 3: Add imports**

In `python/src/arbor_worker/pipeline.py`, add near the other imports:

```python
from arbor_worker.chunk_generate import ChunkedResult, chunked_generate
from arbor_worker.errors import ChunkGenerateError, SynthesisError
```

- [ ] **Step 4: Replace the Generate + Write stages**

In `run_update`, replace the current Generate block and the start of the Write block (from the `# Generate` comment through the `build_metadata(...)` call) with:

```python
        # Generate ------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="start")
        images = prep.image_paths
        use_chunking = (
            prep.text is None
            and len(images) > settings.pdf_chunk_threshold_pages
        )
        generate_mode = "single"
        chunk_count = None
        chunk_size_used = None
        page_ranges = None
        try:
            if use_chunking:
                chunked: ChunkedResult = chunked_generate(
                    provider,
                    source_name=abs_source.name,
                    image_paths=images,
                    model_id=model_id,
                    cwd=abs_dir,
                    cache_dir=cache.for_hash(source_hash),
                    chunk_size=settings.pdf_chunk_size_pages,
                    concurrency=settings.pdf_chunk_concurrency,
                    emitter=emitter,
                    lecture_dir=lecture_dir_rel,
                    cancel_requested=lambda: _cancel_requested(cancel_file),
                )
                markdown = chunked.markdown
                generate_mode = "chunked"
                chunk_count = chunked.chunk_count
                chunk_size_used = chunked.chunk_size
                page_ranges = chunked.page_ranges
            else:
                request = ProviderRequest(
                    prompt=build_prompt(abs_source.name, prep),
                    model_id=model_id,
                    image_paths=[p.resolve() for p in images],
                    cwd=abs_dir,
                )
                result = provider.run(request)
                markdown = result.markdown
                validate_digest(markdown)
        except (DigestError, ChunkGenerateError, SynthesisError, Exception) as e:
            failed += 1
            emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="fail", detail=str(e))
            emitter.lecture_failed(lecture_dir=lecture_dir_rel, stage="generate", message=str(e))
            outcomes.append(LectureOutcome(lecture_dir_rel, str(src.path), False, "generate", str(e)))
            continue
        emitter.stage(lecture_dir=lecture_dir_rel, stage="generate", status="ok")

        # Write ---------------------------------------------------------
        emitter.stage(lecture_dir=lecture_dir_rel, stage="write", status="start")
        lecture_md = abs_dir / "lecture.md"
        metadata_json = abs_dir / "metadata.json"
        try:
            lecture_md.write_text(markdown if markdown.endswith("\n") else markdown + "\n")
            meta = build_metadata(
                abs_source, src.source_type, source_hash, model_id, prep.processing_path,
                generate_mode=generate_mode,
                chunk_count=chunk_count,
                chunk_size=chunk_size_used,
                page_ranges=page_ranges,
            )
            write_metadata(meta, metadata_json)
```

Leave the remainder of the Write stage (the empty-artifact check, `except OSError`, and the `stage="write", status="ok"` line) unchanged.

- [ ] **Step 5: Run the full pipeline suite**

Run: `cd python && uv run pytest tests/test_pipeline.py -v`
Expected: PASS (existing tests plus the three new ones)

- [ ] **Step 6: Commit**

```bash
git add python/src/arbor_worker/pipeline.py python/tests/test_pipeline.py
git commit -m "feat(worker): route large image lectures through chunked generate"
```

---

## Task 10: Document events and metadata

**Files:**
- Modify: `python/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the new event rows**

In `python/README.md`, in the `update` event schema table, add after the `stage` row:

```markdown
| `chunk_started` | `lecture_dir`, `chunk_id`, `page_start`, `page_end`, `index`, `total` |
| `chunk_done` | `lecture_dir`, `chunk_id`, `page_start`, `page_end`, `index`, `total` |
| `chunk_failed` | `lecture_dir`, `chunk_id`, `page_start`, `page_end`, `code`, `message` |
| `synthesis_started` | `lecture_dir`, `chunk_count` |
| `synthesis_done` | `lecture_dir` |
| `synthesis_failed` | `lecture_dir`, `code`, `message` |
```

- [ ] **Step 2: Add a chunking note**

In `python/README.md`, add a short section after the event schema table:

```markdown
## Large-PDF chunking

Image-based lectures (PDF, or PPTX image fallback) with more than
`pdf_chunk_threshold_pages` (default 25) pages are split into fixed page windows
(`pdf_chunk_size_pages`, default 25), processed with bounded concurrency
(`pdf_chunk_concurrency`, default 2), and synthesized into one `lecture.md`.
Per-chunk status and digests live in `_arbor_cache/<source_hash>/chunks.json` and
`chunk-NNNN.md`, so an interrupted or failed run resumes only the incomplete
chunks (and re-runs synthesis) on the next `update`. `metadata.json` records
`generate_mode`, and for chunked runs `chunk_count`, `chunk_size`, and page ranges.
```

- [ ] **Step 3: Run the full worker suite**

Run: `cd python && uv run pytest -q`
Expected: PASS (all prior tests plus the new ones)

- [ ] **Step 4: Commit**

```bash
git add python/README.md
git commit -m "docs(worker): document chunk events and large-PDF chunking"
```

---

## Self-Review notes

- **Spec coverage:** preserve order + page ranges (Task 6/7), cap concurrency (Task 8), persist per-chunk status for resume (Task 7/8), progress + cancel between chunks (Task 8), synthesis from digests not images (Task 8 asserts `image_paths == []`), keep `lecture.md`/`metadata.json` (Task 9), clear failure surfacing + shared error location (Task 2 + events), settings knobs without UI (Task 1), Settings UI deferred to V2 (spec + plan constraints).
- **Type consistency:** `ChunkPlan`, `ChunkManifest`, `ChunkedResult`, `chunked_generate(...)` signatures are defined once and consumed with matching names/kwargs across tasks.
- **No placeholders:** every code/test step contains full content and exact commands.
