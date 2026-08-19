# Course-Centric Knowledge & Incremental Ingest Implementation Plan

> **Status (2026-08-19):** Course layout is live on `main` (PR #7). Start-page control was replaced by ranges in **0.2.0**. Do not re-implement from this plan.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the course folder the unit of knowledge: detect new/changed sources per course, let the user pick a start page per file before any model call, write dated digests, and rebuild `course.md` with an LLM synthesis.

**Architecture:** A new discovery/planning layer (`courses.py`, `planning.py`, `probe.py`) finds pending sources and page counts before generation. A committed per-course manifest (`arbor-course.json`) replaces "is there a `lecture.md` beside the source" as processed-state. `pipeline.py` is rewritten to loop courses → selected sources → dated digest → course synthesis → optional source deletion → one batch commit. Existing chunked generate is reused for large page windows.

**Tech Stack:** Python 3.11+ worker (stdlib + PyMuPDF + python-pptx, pytest), Tauri v2 desktop (Rust commands + vanilla TS frontend).

**Spec:** [docs/superpowers/specs/2026-08-12-course-centric-knowledge-design.md](../specs/2026-08-12-course-centric-knowledge-design.md)

## Global Constraints

- Python `>=3.11`; run worker tests with `cd python && uv run pytest -q`.
- No new runtime dependencies.
- Dataclasses are `frozen=True` where they model values (follow existing modules).
- All worker events stay single-line JSON on the existing `EventEmitter` stream.
- A **course** is an immediate child directory of the Knowledge root. Files directly in the root are ignored.
- **Processed state is the course manifest**, not git dirtiness: a source is pending when its path is absent from `arbor-course.json` or its file hash differs from the recorded hash. Git is still used for the batch commit.
- Empty/unset start page means ingest the entire file. `start_page` is 1-based and must satisfy `1 <= start_page <= page_count`.
- Start page applies to image-based prepare paths (`pdf_images`, `pptx_images_fallback`). For `pptx_text`, a start page above 1 emits a `warning` and the whole file is ingested.
- `delete_sources_after_digest` default is `false` and is read from `<root>/.arbor/settings.json`. No Settings UI in this plan.
- Clean break: no `Course/Lecture/lecture.md` pipeline, no `metadata.json` beside sources, no auto-migration.
- Digest file naming: `digests/YYYY-MM-DD.md`, falling back to `YYYY-MM-DDTHHMM.md` then `YYYY-MM-DDTHHMM-<n>.md`.
- Course rollup file is `course.md`, validated with the existing `validate_digest`.

---

## Task 1: Settings knobs and `.arbor/settings.json` loader

**Files:**
- Modify: `python/src/arbor_worker/errors.py`
- Modify: `python/src/arbor_worker/settings.py`
- Test: `python/tests/test_errors.py`
- Test: `python/tests/test_settings.py`

**Interfaces:**
- Produces: error codes `SOURCE_PROBE_FAILED`, `COURSE_SYNTHESIS_FAILED`, `PLAN_INVALID`; classes `ProbeError`, `CourseSynthesisError`, `PlanError`.
- Produces: `WorkerSettings.delete_sources_after_digest: bool` (default `False`), `WorkerSettings.digests_dirname: str` (default `"digests"`), `WorkerSettings.course_file_name: str` (default `"course.md"`), `load_settings(root: Path) -> WorkerSettings`.

- [ ] **Step 1: Write the failing tests**

Add to `python/tests/test_errors.py`:

```python
def test_new_error_codes():
    from arbor_worker.errors import (
        COURSE_SYNTHESIS_FAILED,
        PLAN_INVALID,
        SOURCE_PROBE_FAILED,
        ArborError,
        CourseSynthesisError,
        PlanError,
        ProbeError,
    )

    assert isinstance(ProbeError("x"), ArborError)
    assert ProbeError("x").code == SOURCE_PROBE_FAILED
    assert CourseSynthesisError("x").code == COURSE_SYNTHESIS_FAILED
    assert PlanError("x").code == PLAN_INVALID
```

Add to `python/tests/test_settings.py`:

```python
def test_course_defaults():
    from arbor_worker.settings import default_settings

    s = default_settings()
    assert s.delete_sources_after_digest is False
    assert s.digests_dirname == "digests"
    assert s.course_file_name == "course.md"


def test_load_settings_missing_file_uses_defaults(tmp_path):
    from arbor_worker.settings import load_settings

    s = load_settings(tmp_path)
    assert s.delete_sources_after_digest is False


def test_load_settings_reads_delete_flag(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text('{"delete_sources_after_digest": true}')
    s = load_settings(tmp_path)
    assert s.delete_sources_after_digest is True
    assert s.digests_dirname == "digests"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && uv run pytest tests/test_errors.py tests/test_settings.py -v`
Expected: FAIL with `ImportError: cannot import name 'ProbeError'` and `AttributeError: ... delete_sources_after_digest`.

- [ ] **Step 3: Add the error classes**

Append to `python/src/arbor_worker/errors.py`:

```python
SOURCE_PROBE_FAILED = "SOURCE_PROBE_FAILED"
COURSE_SYNTHESIS_FAILED = "COURSE_SYNTHESIS_FAILED"
PLAN_INVALID = "PLAN_INVALID"


class ProbeError(ArborError):
    code = SOURCE_PROBE_FAILED


class CourseSynthesisError(ArborError):
    code = COURSE_SYNTHESIS_FAILED


class PlanError(ArborError):
    code = PLAN_INVALID
```

- [ ] **Step 4: Add the settings fields and loader**

In `python/src/arbor_worker/settings.py`, change the import line `from dataclasses import dataclass, field` to:

```python
from dataclasses import dataclass, field, replace
```

Add these three fields to `WorkerSettings` immediately after `pdf_chunk_concurrency`:

```python
    delete_sources_after_digest: bool = False
    digests_dirname: str = "digests"
    course_file_name: str = "course.md"
```

Add this function at the end of the file:

```python
def load_settings(root: Path) -> WorkerSettings:
    cfg = Path(root) / ".arbor" / "settings.json"
    base = WorkerSettings()
    if not cfg.is_file():
        return base
    data = json.loads(cfg.read_text())
    return replace(
        base,
        delete_sources_after_digest=bool(data.get("delete_sources_after_digest", False)),
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd python && uv run pytest tests/test_errors.py tests/test_settings.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add python/src/arbor_worker/errors.py python/src/arbor_worker/settings.py python/tests/test_errors.py python/tests/test_settings.py
git commit -m "feat(worker): add course settings knobs and settings.json loader"
```

---

## Task 2: Page probe

**Files:**
- Create: `python/src/arbor_worker/probe.py`
- Test: `python/tests/test_probe.py`

**Interfaces:**
- Consumes: `ProbeError` (Task 1).
- Produces: `count_pages(source: Path, source_type: str) -> int` — PDF page count via PyMuPDF, PPTX slide count via python-pptx.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_probe.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.errors import ProbeError
from arbor_worker.probe import count_pages


def test_count_pages_pdf(tmp_path: Path, make_pdf):
    pdf = make_pdf(tmp_path / "a.pdf", pages=3)
    assert count_pages(pdf, "pdf") == 3


def test_count_pages_pptx(tmp_path: Path, make_pptx):
    pptx = make_pptx(tmp_path / "a.pptx", ["one", "two"])
    assert count_pages(pptx, "pptx") == 2


def test_count_pages_unsupported_type(tmp_path: Path):
    with pytest.raises(ProbeError):
        count_pages(tmp_path / "a.txt", "txt")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_probe.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.probe'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/probe.py`:

```python
from __future__ import annotations

from pathlib import Path

from arbor_worker.errors import ProbeError


def count_pages(source: Path, source_type: str) -> int:
    source = Path(source)
    if source_type == "pdf":
        import fitz  # PyMuPDF

        doc = fitz.open(str(source))
        try:
            return int(doc.page_count)
        finally:
            doc.close()
    if source_type == "pptx":
        from pptx import Presentation

        return len(Presentation(str(source)).slides)
    raise ProbeError(f"Unsupported source type: {source_type}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_probe.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/probe.py python/tests/test_probe.py
git commit -m "feat(worker): add page/slide count probe"
```

---

## Task 3: Course discovery and removal of lecture-folder helpers

**Files:**
- Create: `python/src/arbor_worker/courses.py`
- Modify: `python/src/arbor_worker/sources.py`
- Modify: `python/src/arbor_worker/gitstate.py`
- Test: `python/tests/test_courses.py`
- Test: `python/tests/test_sources.py`
- Test: `python/tests/test_gitstate.py`

**Interfaces:**
- Consumes: `classify(rel_path: Path) -> str | None` from `arbor_worker.sources`.
- Produces: `CourseSource(path: Path, course_dir: Path, source_type: str)` (frozen) and `discover_sources(root: Path, *, cache_dir_name: str, digests_dirname: str) -> list[CourseSource]`, sorted by path.
- Removes: `LectureSource`, `gitstate.dirty_sources`, `gitstate.validate_single_source_per_lecture`. `gitstate.commit_batch` and `GitStateError` stay unchanged.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_courses.py`:

```python
from pathlib import Path

from arbor_worker.courses import CourseSource, discover_sources


def _discover(root: Path):
    return discover_sources(root, cache_dir_name="_arbor_cache", digests_dirname="digests")


def test_finds_sources_in_courses_including_nested(tmp_path: Path, make_pdf, make_pptx):
    (tmp_path / "Biology" / "readings").mkdir(parents=True)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=1)
    make_pdf(tmp_path / "Biology" / "readings" / "chapter.pdf", pages=1)
    (tmp_path / "Chemistry").mkdir()
    make_pptx(tmp_path / "Chemistry" / "deck.pptx", ["one"])

    found = _discover(tmp_path)
    assert [str(s.path) for s in found] == [
        "Biology/mega.pdf",
        "Biology/readings/chapter.pdf",
        "Chemistry/deck.pptx",
    ]
    assert {str(s.course_dir) for s in found} == {"Biology", "Chemistry"}
    assert found[2].source_type == "pptx"


def test_ignores_root_files_cache_digests_and_dotdirs(tmp_path: Path, make_pdf):
    make_pdf(tmp_path / "loose.pdf", pages=1)
    (tmp_path / "_arbor_cache" / "abc").mkdir(parents=True)
    make_pdf(tmp_path / "_arbor_cache" / "abc" / "cached.pdf", pages=1)
    (tmp_path / ".arbor").mkdir()
    make_pdf(tmp_path / ".arbor" / "hidden.pdf", pages=1)
    (tmp_path / "Biology" / "digests").mkdir(parents=True)
    make_pdf(tmp_path / "Biology" / "digests" / "old.pdf", pages=1)
    make_pdf(tmp_path / "Biology" / "real.pdf", pages=1)

    found = _discover(tmp_path)
    assert [str(s.path) for s in found] == ["Biology/real.pdf"]


def test_ignores_non_source_extensions(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=1)
    (tmp_path / "Biology" / "course.md").write_text("# notes\n")
    (tmp_path / "Biology" / "arbor-course.json").write_text("{}")

    found = _discover(tmp_path)
    assert found == [CourseSource(Path("Biology/a.pdf"), Path("Biology"), "pdf")]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_courses.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.courses'`

- [ ] **Step 3: Create the discovery module**

Create `python/src/arbor_worker/courses.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.sources import classify

IGNORED_DIR_NAMES = {".git", ".arbor"}


@dataclass(frozen=True)
class CourseSource:
    path: Path        # relative to the Knowledge root
    course_dir: Path  # relative to the Knowledge root; an immediate child of it
    source_type: str


def discover_sources(
    root: Path,
    *,
    cache_dir_name: str,
    digests_dirname: str,
) -> list[CourseSource]:
    root = Path(root)
    skip = IGNORED_DIR_NAMES | {cache_dir_name, digests_dirname}
    found: list[CourseSource] = []
    for course in sorted(p for p in root.iterdir() if p.is_dir()):
        if course.name in skip:
            continue
        for path in sorted(course.rglob("*")):
            if not path.is_file():
                continue
            inner_dirs = path.relative_to(course).parts[:-1]
            if any(part in skip for part in inner_dirs):
                continue
            source_type = classify(path)
            if source_type is None:
                continue
            found.append(
                CourseSource(
                    path=path.relative_to(root),
                    course_dir=Path(course.name),
                    source_type=source_type,
                )
            )
    return found
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_courses.py -v`
Expected: PASS

- [ ] **Step 5: Delete the lecture-folder helpers**

In `python/src/arbor_worker/sources.py`, delete the `LectureSource` dataclass and the now-unused `dataclass`/`Path` imports so the file reads exactly:

```python
from __future__ import annotations

from pathlib import Path

SUPPORTED_EXTS = {".pdf": "pdf", ".pptx": "pptx"}


def classify(rel_path: Path) -> str | None:
    return SUPPORTED_EXTS.get(rel_path.suffix.lower())
```

In `python/src/arbor_worker/gitstate.py`, delete the `dirty_sources` and `validate_single_source_per_lecture` functions and the `from arbor_worker.sources import LectureSource, classify` import. The file keeps only `GitStateError`, `_git`, and `commit_batch`.

- [ ] **Step 6: Update the tests for the deleted helpers**

Replace `python/tests/test_sources.py` with:

```python
from pathlib import Path

from arbor_worker.sources import classify


def test_classify_extensions():
    assert classify(Path("a/b.pdf")) == "pdf"
    assert classify(Path("a/b.PPTX")) == "pptx"
    assert classify(Path("a/b.md")) is None
    assert classify(Path("a/metadata.json")) is None
```

Replace `python/tests/test_gitstate.py` with:

```python
from pathlib import Path

import pytest

from arbor_worker.gitstate import GitStateError, commit_batch


def test_commit_batch_only_named_paths(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "course.md").write_text("# digest\n")
    commit = commit_batch(
        git_repo,
        [Path("Bio/source.pdf"), Path("Bio/course.md")],
        "digest: Bio",
    )
    assert commit
    assert g("log", "-1", "--pretty=%s").strip() == "digest: Bio"


def test_commit_batch_rejects_empty_path_list(git_repo: Path):
    with pytest.raises(GitStateError):
        commit_batch(git_repo, [], "digest: nothing")
```

- [ ] **Step 7: Run the affected tests**

Run: `cd python && uv run pytest tests/test_courses.py tests/test_sources.py tests/test_gitstate.py -v`
Expected: PASS.

> **Expected red suite from here to Task 11.** `pipeline.py` still imports the deleted `dirty_sources`, so `tests/test_pipeline.py` and `tests/test_cli.py` fail collection until Task 10 rewrites the pipeline and Task 11 rewires the CLI. Run only the per-task test files named in each task until then.

- [ ] **Step 8: Commit**

```bash
git add python/src/arbor_worker/courses.py python/src/arbor_worker/sources.py python/src/arbor_worker/gitstate.py python/tests/test_courses.py python/tests/test_sources.py python/tests/test_gitstate.py
git commit -m "feat(worker): discover sources per course and drop lecture-folder helpers"
```

---

## Task 4: Course manifest

**Files:**
- Create: `python/src/arbor_worker/course_manifest.py`
- Test: `python/tests/test_course_manifest.py`

**Interfaces:**
- Produces: frozen dataclass `DigestRecord(source_path: str, source_hash: str, page_count: int, start_page: int, end_page: int, digest_file: str, model_id: str, processing_path: str, generate_mode: str, chunk_count: int | None, digested_at: str)`.
- Produces: `CourseManifest` with class attribute `FILENAME = "arbor-course.json"`, classmethod `load(course_dir: Path) -> CourseManifest`, and methods `save() -> None`, `records() -> list[dict]`, `latest_for(source_path: str) -> dict | None`, `is_current(source_path: str, source_hash: str) -> bool`, `record(rec: DigestRecord) -> None`, `digest_files() -> list[str]`, `read_digests() -> list[tuple[str, str]]`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_course_manifest.py`:

```python
from pathlib import Path

from arbor_worker.course_manifest import CourseManifest, DigestRecord


def _record(**over) -> DigestRecord:
    base = dict(
        source_path="Bio/mega.pdf",
        source_hash="hash-1",
        page_count=150,
        start_page=1,
        end_page=150,
        digest_file="digests/2026-08-12.md",
        model_id="m",
        processing_path="pdf_images",
        generate_mode="single",
        chunk_count=None,
        digested_at="2026-08-12T00:00:00+00:00",
    )
    base.update(over)
    return DigestRecord(**base)


def test_missing_manifest_starts_empty(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    assert m.records() == []
    assert m.latest_for("Bio/mega.pdf") is None
    assert m.is_current("Bio/mega.pdf", "hash-1") is False


def test_record_save_and_reload(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    m.save()

    again = CourseManifest.load(tmp_path)
    assert again.is_current("Bio/mega.pdf", "hash-1") is True
    assert again.is_current("Bio/mega.pdf", "hash-2") is False
    assert again.latest_for("Bio/mega.pdf")["digest_file"] == "digests/2026-08-12.md"
    assert (tmp_path / CourseManifest.FILENAME).is_file()


def test_latest_for_uses_most_recent_record(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    m.record(
        _record(
            source_hash="hash-2",
            page_count=300,
            start_page=151,
            end_page=300,
            digest_file="digests/2026-09-01.md",
            digested_at="2026-09-01T00:00:00+00:00",
        )
    )
    latest = m.latest_for("Bio/mega.pdf")
    assert latest["start_page"] == 151
    assert m.is_current("Bio/mega.pdf", "hash-2") is True
    assert m.digest_files() == ["digests/2026-08-12.md", "digests/2026-09-01.md"]


def test_read_digests_returns_label_and_markdown(tmp_path: Path):
    (tmp_path / "digests").mkdir()
    (tmp_path / "digests" / "2026-08-12.md").write_text("# one\n")
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    assert m.read_digests() == [("2026-08-12.md", "# one\n")]


def test_read_digests_skips_missing_files(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_record())
    assert m.read_digests() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_course_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.course_manifest'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/course_manifest.py`:

```python
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class DigestRecord:
    source_path: str
    source_hash: str
    page_count: int
    start_page: int
    end_page: int
    digest_file: str
    model_id: str
    processing_path: str
    generate_mode: str
    chunk_count: int | None
    digested_at: str


class CourseManifest:
    FILENAME = "arbor-course.json"

    def __init__(self, course_dir: Path, data: dict):
        self.course_dir = Path(course_dir)
        self.data = data

    @property
    def path(self) -> Path:
        return self.course_dir / self.FILENAME

    @classmethod
    def load(cls, course_dir: Path) -> "CourseManifest":
        course_dir = Path(course_dir)
        path = course_dir / cls.FILENAME
        if path.is_file():
            return cls(course_dir, json.loads(path.read_text()))
        return cls(course_dir, {"version": 1, "records": []})

    def save(self) -> None:
        self.course_dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def records(self) -> list[dict]:
        return list(self.data.get("records", []))

    def record(self, rec: DigestRecord) -> None:
        self.data.setdefault("version", 1)
        self.data.setdefault("records", []).append(asdict(rec))

    def latest_for(self, source_path: str) -> dict | None:
        matches = [r for r in self.records() if r.get("source_path") == source_path]
        if not matches:
            return None
        return matches[-1]

    def is_current(self, source_path: str, source_hash: str) -> bool:
        latest = self.latest_for(source_path)
        return latest is not None and latest.get("source_hash") == source_hash

    def digest_files(self) -> list[str]:
        seen: list[str] = []
        for rec in sorted(self.records(), key=lambda r: (r.get("digested_at", ""), r.get("digest_file", ""))):
            name = rec.get("digest_file")
            if name and name not in seen:
                seen.append(name)
        return seen

    def read_digests(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for rel in self.digest_files():
            path = self.course_dir / rel
            if path.is_file():
                out.append((Path(rel).name, path.read_text()))
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_course_manifest.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/course_manifest.py python/tests/test_course_manifest.py
git commit -m "feat(worker): add committed course manifest"
```

---

## Task 5: Page-window clipping and window-aware prompt

**Files:**
- Create: `python/src/arbor_worker/windowing.py`
- Modify: `python/src/arbor_worker/digest.py`
- Test: `python/tests/test_windowing.py`
- Test: `python/tests/test_digest.py`

**Interfaces:**
- Produces: `clip_images(image_paths: list[Path], start_page: int) -> list[Path]`, raising `ValueError` for `start_page < 1` or a window past the last page.
- Modifies: `build_prompt(source_name: str, prep: PrepareResult, *, page_start: int = 1, image_count: int | None = None) -> str`; when `page_start > 1` the prompt states the window starts at that page.

- [ ] **Step 1: Write the failing tests**

Create `python/tests/test_windowing.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.windowing import clip_images


def _imgs(n: int) -> list[Path]:
    return [Path(f"page-{i + 1:05d}.png") for i in range(n)]


def test_clip_from_first_page_returns_all():
    assert clip_images(_imgs(3), 1) == _imgs(3)


def test_clip_drops_leading_pages():
    clipped = clip_images(_imgs(5), 4)
    assert [p.name for p in clipped] == ["page-00004.png", "page-00005.png"]


def test_clip_rejects_zero_or_negative():
    with pytest.raises(ValueError):
        clip_images(_imgs(3), 0)


def test_clip_rejects_window_past_last_page():
    with pytest.raises(ValueError):
        clip_images(_imgs(3), 4)
```

Add to `python/tests/test_digest.py`:

```python
def test_build_prompt_mentions_window_start():
    from pathlib import Path

    from arbor_worker.digest import build_prompt
    from arbor_worker.prepare import PrepareResult

    prep = PrepareResult("pdf_images", image_paths=[Path("a.png"), Path("b.png")])
    prompt = build_prompt("mega.pdf", prep, page_start=151, image_count=2)
    assert "page 151" in prompt
    assert "2 page image(s)" in prompt


def test_build_prompt_without_window_is_unchanged():
    from pathlib import Path

    from arbor_worker.digest import build_prompt
    from arbor_worker.prepare import PrepareResult

    prep = PrepareResult("pdf_images", image_paths=[Path("a.png")])
    prompt = build_prompt("mega.pdf", prep)
    assert "page 151" not in prompt
    assert "1 page image(s)" in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd python && uv run pytest tests/test_windowing.py tests/test_digest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.windowing'` and `TypeError: build_prompt() got an unexpected keyword argument 'page_start'`.

- [ ] **Step 3: Create the windowing module**

Create `python/src/arbor_worker/windowing.py`:

```python
from __future__ import annotations

from pathlib import Path


def clip_images(image_paths: list[Path], start_page: int) -> list[Path]:
    if start_page < 1:
        raise ValueError("start_page must be >= 1")
    ordered = list(image_paths)
    clipped = ordered[start_page - 1:]
    if not clipped:
        raise ValueError(f"start_page {start_page} is past the last page ({len(ordered)})")
    return clipped
```

- [ ] **Step 4: Make `build_prompt` window-aware**

In `python/src/arbor_worker/digest.py`, replace the whole `build_prompt` function with:

```python
def build_prompt(
    source_name: str,
    prep: PrepareResult,
    *,
    page_start: int = 1,
    image_count: int | None = None,
) -> str:
    prompt = _TEMPLATE.format(source_name=source_name)
    if prep.text is not None:
        prompt += (
            "\nThe extracted slide text is below between the markers. Base the notes on it.\n"
            "-----BEGIN SOURCE TEXT-----\n"
            f"{prep.text}\n"
            "-----END SOURCE TEXT-----\n"
        )
    else:
        count = len(prep.image_paths) if image_count is None else image_count
        prompt += (
            f"\n{count} page image(s) are attached to this message. "
            "Read all of them, including any handwritten annotations, and base the notes "
            "on their full content.\n"
        )
        if page_start > 1:
            prompt += (
                f"\nThese images start at page {page_start} of the source file. Write notes for "
                "this part only, and do not refer to earlier pages you cannot see.\n"
            )
    return prompt
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd python && uv run pytest tests/test_windowing.py tests/test_digest.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add python/src/arbor_worker/windowing.py python/src/arbor_worker/digest.py python/tests/test_windowing.py python/tests/test_digest.py
git commit -m "feat(worker): add page-window clipping and window-aware prompt"
```

---

## Task 6: Dated digest file paths

**Files:**
- Create: `python/src/arbor_worker/digest_files.py`
- Test: `python/tests/test_digest_files.py`

**Interfaces:**
- Produces: `next_digest_path(course_dir: Path, digests_dirname: str, now: datetime) -> Path` — creates the digests directory and returns an unused dated path.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_digest_files.py`:

```python
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.digest_files import next_digest_path

NOW = datetime(2026, 8, 12, 14, 30, tzinfo=timezone.utc)


def test_first_digest_uses_date(tmp_path: Path):
    path = next_digest_path(tmp_path, "digests", NOW)
    assert path == tmp_path / "digests" / "2026-08-12.md"
    assert path.parent.is_dir()


def test_second_same_day_uses_timestamp(tmp_path: Path):
    first = next_digest_path(tmp_path, "digests", NOW)
    first.write_text("one\n")
    second = next_digest_path(tmp_path, "digests", NOW)
    assert second.name == "2026-08-12T1430.md"


def test_third_same_minute_gets_suffix(tmp_path: Path):
    next_digest_path(tmp_path, "digests", NOW).write_text("one\n")
    next_digest_path(tmp_path, "digests", NOW).write_text("two\n")
    third = next_digest_path(tmp_path, "digests", NOW)
    assert third.name == "2026-08-12T1430-2.md"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_digest_files.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.digest_files'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/digest_files.py`:

```python
from __future__ import annotations

from datetime import datetime
from pathlib import Path


def next_digest_path(course_dir: Path, digests_dirname: str, now: datetime) -> Path:
    out_dir = Path(course_dir) / digests_dirname
    out_dir.mkdir(parents=True, exist_ok=True)

    dated = out_dir / f"{now.strftime('%Y-%m-%d')}.md"
    if not dated.exists():
        return dated

    stamped = out_dir / f"{now.strftime('%Y-%m-%dT%H%M')}.md"
    if not stamped.exists():
        return stamped

    suffix = 2
    while True:
        candidate = out_dir / f"{now.strftime('%Y-%m-%dT%H%M')}-{suffix}.md"
        if not candidate.exists():
            return candidate
        suffix += 1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_digest_files.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/digest_files.py python/tests/test_digest_files.py
git commit -m "feat(worker): add dated digest file naming"
```

---

## Task 7: Update planning and selections

**Files:**
- Create: `python/src/arbor_worker/planning.py`
- Test: `python/tests/test_planning.py`

**Interfaces:**
- Consumes: `discover_sources` (Task 3), `CourseManifest` (Task 4), `count_pages` (Task 2), `hash_file` from `arbor_worker.hashing`, `PlanError` (Task 1), `WorkerSettings` (Task 1).
- Produces: frozen `PendingSource(path: str, course: str, source_type: str, page_count: int, suggested_start_page: int | None, previously_digested: bool)`; frozen `UpdatePlan(pending: list[PendingSource])`; frozen `SelectedSource(path: str, course: str, source_type: str, page_count: int, start_page: int)`; `build_plan(root: Path, settings: WorkerSettings) -> UpdatePlan`; `plan_to_dict(plan: UpdatePlan) -> dict`; `apply_selections(plan: UpdatePlan, selections: dict[str, int | None]) -> list[SelectedSource]`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_planning.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.course_manifest import CourseManifest, DigestRecord
from arbor_worker.errors import PlanError
from arbor_worker.hashing import hash_file
from arbor_worker.planning import apply_selections, build_plan, plan_to_dict
from arbor_worker.settings import default_settings


def _record_for(course_dir: Path, source_path: str, source_hash: str, page_count: int) -> None:
    m = CourseManifest.load(course_dir)
    m.record(
        DigestRecord(
            source_path=source_path,
            source_hash=source_hash,
            page_count=page_count,
            start_page=1,
            end_page=page_count,
            digest_file="digests/2026-08-12.md",
            model_id="m",
            processing_path="pdf_images",
            generate_mode="single",
            chunk_count=None,
            digested_at="2026-08-12T00:00:00+00:00",
        )
    )
    m.save()


def test_new_source_is_pending(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=3)

    plan = build_plan(tmp_path, default_settings())
    assert len(plan.pending) == 1
    p = plan.pending[0]
    assert p.path == "Biology/mega.pdf"
    assert p.course == "Biology"
    assert p.page_count == 3
    assert p.suggested_start_page is None
    assert p.previously_digested is False


def test_unchanged_digested_source_is_not_pending(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=3)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 3)

    plan = build_plan(tmp_path, default_settings())
    assert plan.pending == []


def test_grown_source_suggests_next_page(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    pdf = make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)
    _record_for(tmp_path / "Biology", "Biology/mega.pdf", hash_file(pdf), 2)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=5)

    plan = build_plan(tmp_path, default_settings())
    assert len(plan.pending) == 1
    assert plan.pending[0].page_count == 5
    assert plan.pending[0].suggested_start_page == 3
    assert plan.pending[0].previously_digested is True


def test_plan_to_dict_shape(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=2)

    data = plan_to_dict(build_plan(tmp_path, default_settings()))
    assert data["pending"][0] == {
        "path": "Biology/mega.pdf",
        "course": "Biology",
        "source_type": "pdf",
        "page_count": 2,
        "suggested_start_page": None,
        "previously_digested": False,
    }


def test_no_selections_processes_everything_from_page_one(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)
    make_pdf(tmp_path / "Biology" / "b.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {})
    assert [s.path for s in selected] == ["Biology/a.pdf", "Biology/b.pdf"]
    assert all(s.start_page == 1 for s in selected)


def test_selections_filter_and_set_start_page(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=4)
    make_pdf(tmp_path / "Biology" / "b.pdf", pages=4)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {"Biology/b.pdf": 3})
    assert [(s.path, s.start_page) for s in selected] == [("Biology/b.pdf", 3)]


def test_null_start_page_means_full_ingest(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=4)

    plan = build_plan(tmp_path, default_settings())
    selected = apply_selections(plan, {"Biology/a.pdf": None})
    assert selected[0].start_page == 1


def test_out_of_range_start_page_raises(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    with pytest.raises(PlanError):
        apply_selections(plan, {"Biology/a.pdf": 3})


def test_unknown_selection_path_raises(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=2)

    plan = build_plan(tmp_path, default_settings())
    with pytest.raises(PlanError):
        apply_selections(plan, {"Biology/missing.pdf": 1})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_planning.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.planning'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/planning.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.course_manifest import CourseManifest
from arbor_worker.courses import discover_sources
from arbor_worker.errors import PlanError
from arbor_worker.hashing import hash_file
from arbor_worker.probe import count_pages
from arbor_worker.settings import WorkerSettings


@dataclass(frozen=True)
class PendingSource:
    path: str
    course: str
    source_type: str
    page_count: int
    suggested_start_page: int | None
    previously_digested: bool


@dataclass(frozen=True)
class UpdatePlan:
    pending: list[PendingSource]


@dataclass(frozen=True)
class SelectedSource:
    path: str
    course: str
    source_type: str
    page_count: int
    start_page: int


def build_plan(root: Path, settings: WorkerSettings) -> UpdatePlan:
    root = Path(root)
    sources = discover_sources(
        root,
        cache_dir_name=settings.cache_dir_name,
        digests_dirname=settings.digests_dirname,
    )
    manifests: dict[str, CourseManifest] = {}
    pending: list[PendingSource] = []

    for src in sources:
        course_rel = str(src.course_dir)
        manifest = manifests.get(course_rel)
        if manifest is None:
            manifest = CourseManifest.load(root / src.course_dir)
            manifests[course_rel] = manifest

        rel = str(src.path)
        abs_path = root / src.path
        source_hash = hash_file(abs_path)
        if manifest.is_current(rel, source_hash):
            continue

        page_count = count_pages(abs_path, src.source_type)
        previous = manifest.latest_for(rel)
        suggested = None
        if previous is not None and page_count > int(previous["page_count"]):
            suggested = int(previous["page_count"]) + 1

        pending.append(
            PendingSource(
                path=rel,
                course=course_rel,
                source_type=src.source_type,
                page_count=page_count,
                suggested_start_page=suggested,
                previously_digested=previous is not None,
            )
        )

    return UpdatePlan(pending=pending)


def plan_to_dict(plan: UpdatePlan) -> dict:
    return {
        "pending": [
            {
                "path": p.path,
                "course": p.course,
                "source_type": p.source_type,
                "page_count": p.page_count,
                "suggested_start_page": p.suggested_start_page,
                "previously_digested": p.previously_digested,
            }
            for p in plan.pending
        ]
    }


def apply_selections(
    plan: UpdatePlan,
    selections: dict[str, int | None],
) -> list[SelectedSource]:
    by_path = {p.path: p for p in plan.pending}
    unknown = sorted(set(selections) - set(by_path))
    if unknown:
        raise PlanError(f"Unknown source(s) in selection: {', '.join(unknown)}")

    chosen = [p for p in plan.pending if not selections or p.path in selections]
    out: list[SelectedSource] = []
    for p in chosen:
        requested = selections.get(p.path)
        start_page = 1 if requested is None else int(requested)
        if start_page < 1 or start_page > p.page_count:
            raise PlanError(
                f"{p.path}: start page {start_page} out of range 1-{p.page_count}"
            )
        out.append(
            SelectedSource(
                path=p.path,
                course=p.course,
                source_type=p.source_type,
                page_count=p.page_count,
                start_page=start_page,
            )
        )
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_planning.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/planning.py python/tests/test_planning.py
git commit -m "feat(worker): plan pending sources and validate start-page selections"
```

---

## Task 8: Course synthesis

**Files:**
- Create: `python/src/arbor_worker/course_synthesis.py`
- Test: `python/tests/test_course_synthesis.py`

**Interfaces:**
- Consumes: `validate_digest` from `arbor_worker.digest`, `ProviderRequest`/`CliProvider` from `arbor_worker.provider.base`, `CourseSynthesisError` (Task 1).
- Produces: `build_course_prompt(course_name: str, digests: list[tuple[str, str]]) -> str`; `synthesize_course(provider: CliProvider, *, course_name: str, digests: list[tuple[str, str]], model_id: str, cwd: Path) -> str`.

- [ ] **Step 1: Write the failing test**

Create `python/tests/test_course_synthesis.py`:

```python
from pathlib import Path

import pytest

from arbor_worker.course_synthesis import build_course_prompt, synthesize_course
from arbor_worker.errors import CourseSynthesisError
from arbor_worker.provider.fake import FakeProvider

GOOD_MD = (
    "# Biology\n## Overview\nThis overview is definitely long enough to pass.\n"
    "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
)


def test_prompt_includes_each_digest_in_order():
    prompt = build_course_prompt("Biology", [("2026-08-12.md", "first"), ("2026-09-01.md", "second")])
    assert prompt.index("2026-08-12.md") < prompt.index("2026-09-01.md")
    assert "first" in prompt and "second" in prompt
    assert "Course: Biology" in prompt


def test_synthesize_returns_markdown_and_sends_no_images(tmp_path: Path):
    prov = FakeProvider(GOOD_MD)
    out = synthesize_course(
        prov,
        course_name="Biology",
        digests=[("2026-08-12.md", "first")],
        model_id="m",
        cwd=tmp_path,
    )
    assert out.startswith("# Biology")
    assert prov.calls[0].image_paths == []


def test_invalid_markdown_raises(tmp_path: Path):
    prov = FakeProvider("too short")
    with pytest.raises(CourseSynthesisError):
        synthesize_course(
            prov,
            course_name="Biology",
            digests=[("2026-08-12.md", "first")],
            model_id="m",
            cwd=tmp_path,
        )


def test_no_digests_raises(tmp_path: Path):
    with pytest.raises(CourseSynthesisError):
        synthesize_course(
            FakeProvider(GOOD_MD),
            course_name="Biology",
            digests=[],
            model_id="m",
            cwd=tmp_path,
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_course_synthesis.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'arbor_worker.course_synthesis'`

- [ ] **Step 3: Create the module**

Create `python/src/arbor_worker/course_synthesis.py`:

```python
from __future__ import annotations

from pathlib import Path

from arbor_worker.digest import validate_digest
from arbor_worker.errors import CourseSynthesisError
from arbor_worker.provider.base import CliProvider, ProviderRequest

_COURSE_TEMPLATE = """You are assembling the single study notebook for one university course from
dated digests of that course's material.

Combine the digests below into ONE coherent notebook. Merge duplicate points,
keep the chronological order of the digests, and do not lose important details.
Output ONLY GitHub-flavored Markdown, no preamble or code fences, using exactly
these sections in this order:

# <the course name>
## Overview
## Key Concepts
## Important Details
## Questions to Review

Guidance:
- Overview: 3-6 sentence summary of the course so far.
- Key Concepts: bulleted list of the main ideas across all digests.
- Important Details: specifics, definitions, formulas, and facts worth remembering.
- Questions to Review: 5-10 self-test questions covering the whole course.

Course: {course_name}

The dated digests are below, in order, between markers.
"""


def build_course_prompt(course_name: str, digests: list[tuple[str, str]]) -> str:
    prompt = _COURSE_TEMPLATE.format(course_name=course_name)
    for label, markdown in digests:
        prompt += (
            f"\n-----BEGIN DIGEST {label}-----\n"
            f"{markdown}\n"
            f"-----END DIGEST {label}-----\n"
        )
    return prompt


def synthesize_course(
    provider: CliProvider,
    *,
    course_name: str,
    digests: list[tuple[str, str]],
    model_id: str,
    cwd: Path,
) -> str:
    if not digests:
        raise CourseSynthesisError(f"{course_name}: no digests to synthesize")
    prompt = build_course_prompt(course_name, digests)
    try:
        result = provider.run(ProviderRequest(prompt=prompt, model_id=model_id, cwd=cwd))
        validate_digest(result.markdown)
    except Exception as e:
        raise CourseSynthesisError(f"{course_name}: course synthesis failed: {e}")
    return result.markdown
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd python && uv run pytest tests/test_course_synthesis.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/course_synthesis.py python/tests/test_course_synthesis.py
git commit -m "feat(worker): synthesize course.md from dated digests"
```

---

## Task 9: Course-centric events

**Files:**
- Modify: `python/src/arbor_worker/events.py`
- Modify: `python/src/arbor_worker/chunk_generate.py`
- Test: `python/tests/test_events.py`
- Test: `python/tests/test_chunk_generate.py`

**Interfaces:**
- Produces: `EventEmitter.course_started/course_done/source_started/source_done/source_failed/source_deleted/course_synthesis_started/course_synthesis_done/course_synthesis_failed(**fields)`, each emitting an event whose `type` matches the method name.
- Modifies: `chunked_generate(..., course_dir: str, ...)` — the keyword argument `lecture_dir` is renamed to `course_dir`, and chunk/synthesis events carry a `course_dir` field instead of `lecture_dir`.
- Removes: `EventEmitter.lecture_started`, `lecture_done`, `lecture_failed`.

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_events.py`:

```python
def test_course_events():
    import io

    from arbor_worker.events import EventEmitter, parse_lines

    buf = io.StringIO()
    em = EventEmitter(buf)
    em.course_started(course_dir="Biology", sources=2)
    em.source_started(course_dir="Biology", source="Biology/mega.pdf", start_page=151)
    em.source_done(course_dir="Biology", source="Biology/mega.pdf", digest="digests/2026-08-12.md")
    em.source_failed(course_dir="Biology", source="Biology/bad.pdf", message="boom")
    em.source_deleted(course_dir="Biology", source="Biology/mega.pdf")
    em.course_synthesis_started(course_dir="Biology", digest_count=3)
    em.course_synthesis_done(course_dir="Biology")
    em.course_synthesis_failed(course_dir="Biology", code="COURSE_SYNTHESIS_FAILED", message="x")
    em.course_done(course_dir="Biology", digests=1)

    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types == [
        "course_started",
        "source_started",
        "source_done",
        "source_failed",
        "source_deleted",
        "course_synthesis_started",
        "course_synthesis_done",
        "course_synthesis_failed",
        "course_done",
    ]


def test_lecture_events_removed():
    from arbor_worker.events import EventEmitter

    assert not hasattr(EventEmitter, "lecture_started")
    assert not hasattr(EventEmitter, "lecture_done")
    assert not hasattr(EventEmitter, "lecture_failed")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_events.py -v`
Expected: FAIL with `AttributeError: 'EventEmitter' object has no attribute 'course_started'`

- [ ] **Step 3: Update the emitter**

In `python/src/arbor_worker/events.py`, delete the `lecture_started`, `lecture_done`, and `lecture_failed` methods, and add these methods after `nothing_to_process`:

```python
    def course_started(self, **f):
        return self.emit("course_started", **f)

    def course_done(self, **f):
        return self.emit("course_done", **f)

    def source_started(self, **f):
        return self.emit("source_started", **f)

    def source_done(self, **f):
        return self.emit("source_done", **f)

    def source_failed(self, **f):
        return self.emit("source_failed", **f)

    def source_deleted(self, **f):
        return self.emit("source_deleted", **f)

    def course_synthesis_started(self, **f):
        return self.emit("course_synthesis_started", **f)

    def course_synthesis_done(self, **f):
        return self.emit("course_synthesis_done", **f)

    def course_synthesis_failed(self, **f):
        return self.emit("course_synthesis_failed", **f)
```

- [ ] **Step 4: Rename the chunk event field**

In `python/src/arbor_worker/chunk_generate.py`, replace every occurrence of `lecture_dir` with `course_dir` (the `chunked_generate` keyword parameter and the six `emitter.chunk_*` / `emitter.synthesis_*` calls). In `python/tests/test_chunk_generate.py`, replace every occurrence of `lecture_dir` with `course_dir` the same way.

- [ ] **Step 5: Run the tests**

Run: `cd python && uv run pytest tests/test_events.py tests/test_chunk_generate.py -v`
Expected: PASS. (`tests/test_pipeline.py` and `tests/test_cli.py` stay red until Tasks 10 and 11 — see the note in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add python/src/arbor_worker/events.py python/src/arbor_worker/chunk_generate.py python/tests/test_events.py python/tests/test_chunk_generate.py
git commit -m "feat(worker): course-centric events and course_dir chunk field"
```

---

## Task 10: Pipeline rewrite — per-source dated digests

**Files:**
- Modify: `python/src/arbor_worker/pipeline.py`
- Delete: `python/src/arbor_worker/metadata.py`
- Delete: `python/tests/test_metadata.py`
- Test: `python/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `build_plan`, `apply_selections`, `SelectedSource` (Task 7); `CourseManifest`, `DigestRecord` (Task 4); `next_digest_path` (Task 6); `clip_images` and window-aware `build_prompt` (Task 5); `synthesize_course` (Task 8); course events (Task 9); `chunked_generate(..., course_dir=...)` (Task 9).
- Produces: `SourceOutcome(course: str, source: str, ok: bool, stage_failed: str | None, message: str | None, digest_file: str | None)`; `RunResult(processed: int, failed: int, skipped: int, commit: str | None, outcomes: list[SourceOutcome])`; `run_update(root, model_id, provider, emitter, settings, *, selections: dict[str, int | None] | None = None, cancel_file: Path | None = None) -> RunResult`.
- Note: per-source `metadata.json` is removed; the same fields live in `arbor-course.json` records.

- [ ] **Step 1: Write the failing test**

Replace `python/tests/test_pipeline.py` with:

```python
import dataclasses
import io
import json
from pathlib import Path

from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.pipeline import run_update
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings

GOOD_MD = (
    "# Lecture\n## Overview\nThis overview is definitely long enough to pass.\n"
    "## Key Concepts\n- a\n## Important Details\n- b\n## Questions to Review\n- c?\n"
)


def _emitter():
    buf = io.StringIO()
    return EventEmitter(buf), buf


def _chunk_settings(threshold=2, size=2, concurrency=1):
    return dataclasses.replace(
        default_settings(),
        pdf_chunk_threshold_pages=threshold,
        pdf_chunk_size_pages=size,
        pdf_chunk_concurrency=concurrency,
    )


def _manifest(course_dir: Path) -> dict:
    return json.loads((course_dir / "arbor-course.json").read_text())


def test_nothing_to_process(git_repo: Path):
    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, default_settings())
    assert res.processed == 0
    assert "nothing_to_process" in [e["type"] for e in parse_lines(buf.getvalue())]


def test_processes_source_into_dated_digest_and_course_md(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    prov = FakeProvider(GOOD_MD)
    em, buf = _emitter()

    res = run_update(git_repo, "gpt-5.6-sol", prov, em, default_settings())

    assert res.processed == 1 and res.failed == 0
    digests = sorted((course / "digests").glob("*.md"))
    assert len(digests) == 1
    assert digests[0].read_text().startswith("# Lecture")
    assert (course / "course.md").read_text().startswith("# Lecture")
    record = _manifest(course)["records"][0]
    assert record["source_path"] == "Biology/mega.pdf"
    assert record["model_id"] == "gpt-5.6-sol"
    assert record["processing_path"] == "pdf_images"
    assert record["start_page"] == 1
    assert not (course / "lecture.md").exists()
    assert not (course / "metadata.json").exists()
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert "course_started" in types and "source_done" in types
    assert "course_synthesis_done" in types and "committed" in types


def test_second_run_is_idempotent(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    run_update(git_repo, "m", FakeProvider(GOOD_MD), EventEmitter(io.StringIO()), default_settings())

    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, default_settings())
    assert res.processed == 0
    assert "nothing_to_process" in [e["type"] for e in parse_lines(buf.getvalue())]
    assert len(list((course / "digests").glob("*.md"))) == 1


def test_start_page_limits_pages_sent_to_provider(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=4)
    prov = FakeProvider(GOOD_MD)

    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        default_settings(),
        selections={"Biology/mega.pdf": 3},
    )

    assert res.processed == 1
    digest_call = prov.calls[0]
    assert len(digest_call.image_paths) == 2
    assert "page 3" in digest_call.prompt
    assert _manifest(course)["records"][0]["start_page"] == 3


def test_grown_source_only_digests_the_tail(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=2)
    run_update(git_repo, "m", FakeProvider(GOOD_MD), EventEmitter(io.StringIO()), default_settings())

    make_pdf(course / "mega.pdf", pages=5)
    prov = FakeProvider(GOOD_MD)
    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        default_settings(),
        selections={"Biology/mega.pdf": 3},
    )

    assert res.processed == 1
    assert len(prov.calls[0].image_paths) == 3
    assert len(list((course / "digests").glob("*.md"))) == 2
    assert len(_manifest(course)["records"]) == 2


def test_generate_failure_writes_no_digest_and_no_commit(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    em, buf = _emitter()

    res = run_update(git_repo, "m", FakeProvider("too short"), em, default_settings())

    assert res.processed == 0 and res.failed == 1
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))
    assert not (course / "course.md").exists()
    assert not (course / "arbor-course.json").exists()
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "source_failed" for e in events)
    assert not any(e["type"] == "committed" for e in events)


def test_one_failure_keeps_other_digest(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "good.pdf", pages=1)
    make_pdf(course / "bad.pdf", pages=1)

    class FailSecond(FakeProvider):
        def run(self, request):
            self.calls.append(request)
            from arbor_worker.provider.base import ProviderResult

            if "bad.pdf" in request.prompt:
                raise RuntimeError("provider exploded")
            return ProviderResult(markdown=GOOD_MD)

    res = run_update(git_repo, "m", FailSecond(GOOD_MD), EventEmitter(io.StringIO()), default_settings())

    assert res.processed == 1 and res.failed == 1
    assert len(list((course / "digests").glob("*.md"))) == 1
    sources = [r["source_path"] for r in _manifest(course)["records"]]
    assert sources == ["Biology/good.pdf"]


def test_large_window_uses_chunked_generate(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=5)
    em, buf = _emitter()

    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, _chunk_settings())

    assert res.processed == 1
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "chunk_started" and e["course_dir"] == "Biology" for e in events)
    assert _manifest(course)["records"][0]["generate_mode"] == "chunked"


def test_cancel_stops_before_next_source(git_repo: Path, make_pdf, tmp_path: Path):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    cancel.write_text("stop")
    em, buf = _emitter()

    res = run_update(
        git_repo, "m", FakeProvider(GOOD_MD), em, default_settings(), cancel_file=cancel
    )

    assert res.processed == 0
    assert any(e["type"] == "cancelled" for e in parse_lines(buf.getvalue()))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_pipeline.py -v`
Expected: FAIL — `run_update()` does not accept `selections`, and no `digests/` or `arbor-course.json` are written.

- [ ] **Step 3: Rewrite the pipeline**

Replace the entire contents of `python/src/arbor_worker/pipeline.py` with:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored
from arbor_worker.chunk_generate import ChunkedResult, chunked_generate
from arbor_worker.course_manifest import CourseManifest, DigestRecord
from arbor_worker.course_synthesis import synthesize_course
from arbor_worker.digest import build_prompt, validate_digest, DigestError
from arbor_worker.digest_files import next_digest_path
from arbor_worker.errors import (
    ChunkGenerateError,
    CourseSynthesisError,
    PlanError,
    SynthesisError,
)
from arbor_worker.events import EventEmitter
from arbor_worker.gitstate import GitStateError, commit_batch
from arbor_worker.hashing import hash_file
from arbor_worker.planning import SelectedSource, apply_selections, build_plan
from arbor_worker.prepare import prepare_source, PrepareError, PrepareResult
from arbor_worker.provider.base import CliProvider, ProviderRequest
from arbor_worker.settings import WorkerSettings
from arbor_worker.windowing import clip_images


@dataclass
class SourceOutcome:
    course: str
    source: str
    ok: bool
    stage_failed: str | None = None
    message: str | None = None
    digest_file: str | None = None


@dataclass
class RunResult:
    processed: int
    failed: int
    skipped: int
    commit: str | None
    outcomes: list[SourceOutcome] = field(default_factory=list)


def _cancel_requested(cancel_file: Path | None) -> bool:
    return cancel_file is not None and cancel_file.exists()


def _digest_one_source(
    *,
    root: Path,
    sel: SelectedSource,
    provider: CliProvider,
    model_id: str,
    emitter: EventEmitter,
    settings: WorkerSettings,
    cache: CacheDir,
    cancel_file: Path | None,
) -> tuple[str, dict]:
    """Prepare and generate one source window. Returns (markdown, record fields)."""
    abs_source = root / sel.path
    course_abs = root / sel.course
    course_rel = sel.course

    emitter.stage(course_dir=course_rel, source=sel.path, stage="prepare", status="start")
    source_hash = hash_file(abs_source)
    prep: PrepareResult = prepare_source(
        abs_source,
        sel.source_type,
        source_hash,
        cache,
        settings,
        on_warning=lambda m: emitter.warning(course_dir=course_rel, message=m),
    )
    emitter.stage(
        course_dir=course_rel, source=sel.path, stage="prepare",
        status="ok", detail=prep.processing_path,
    )

    start_page = sel.start_page
    images = prep.image_paths
    if prep.text is not None:
        if start_page > 1:
            emitter.warning(
                course_dir=course_rel,
                message=(
                    f"{abs_source.name}: start page ignored for extracted-text slides; "
                    "ingesting the whole file"
                ),
            )
            start_page = 1
    else:
        images = clip_images(images, start_page)

    emitter.stage(course_dir=course_rel, source=sel.path, stage="generate", status="start")
    use_chunking = prep.text is None and len(images) > settings.pdf_chunk_threshold_pages
    generate_mode = "single"
    chunk_count: int | None = None

    if use_chunking:
        chunked: ChunkedResult = chunked_generate(
            provider,
            source_name=abs_source.name,
            image_paths=images,
            model_id=model_id,
            cwd=course_abs,
            cache_dir=cache.for_hash(f"{source_hash}-p{start_page}"),
            chunk_size=settings.pdf_chunk_size_pages,
            concurrency=settings.pdf_chunk_concurrency,
            emitter=emitter,
            course_dir=course_rel,
            cancel_requested=lambda: _cancel_requested(cancel_file),
        )
        markdown = chunked.markdown
        generate_mode = "chunked"
        chunk_count = chunked.chunk_count
    else:
        request = ProviderRequest(
            prompt=build_prompt(
                abs_source.name, prep, page_start=start_page, image_count=len(images)
            ),
            model_id=model_id,
            image_paths=[p.resolve() for p in images],
            cwd=course_abs,
        )
        result = provider.run(request)
        markdown = result.markdown
        validate_digest(markdown)

    emitter.stage(course_dir=course_rel, source=sel.path, stage="generate", status="ok")
    info = {
        "source_hash": source_hash,
        "processing_path": prep.processing_path,
        "generate_mode": generate_mode,
        "chunk_count": chunk_count,
        "start_page": start_page,
        "page_count": sel.page_count,
    }
    return (markdown if markdown.endswith("\n") else markdown + "\n"), info


def run_update(
    root: Path,
    model_id: str,
    provider: CliProvider,
    emitter: EventEmitter,
    settings: WorkerSettings,
    *,
    selections: dict[str, int | None] | None = None,
    cancel_file: Path | None = None,
) -> RunResult:
    root = Path(root)
    emitter.run_started(root=str(root), model_id=model_id, provider=provider.name)

    plan = build_plan(root, settings)
    try:
        selected = apply_selections(plan, selections or {})
    except PlanError as e:
        emitter.error(message=str(e))
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    if not selected:
        emitter.nothing_to_process()
        emitter.run_done(processed=0, failed=0, skipped=0)
        return RunResult(0, 0, 0, None, [])

    cache = CacheDir(root, settings.cache_dir_name)
    outcomes: list[SourceOutcome] = []
    commit_paths: list[Path] = []
    done_courses: list[str] = []
    processed = failed = 0
    skipped = len(plan.pending) - len(selected)
    cancelled = False

    by_course: dict[str, list[SelectedSource]] = {}
    for sel in selected:
        by_course.setdefault(sel.course, []).append(sel)

    for course_rel, course_sels in by_course.items():
        if cancelled:
            break
        course_abs = root / course_rel
        manifest = CourseManifest.load(course_abs)
        emitter.course_started(course_dir=course_rel, sources=len(course_sels))
        new_digests: list[str] = []
        digested_sources: list[Path] = []

        for sel in course_sels:
            if _cancel_requested(cancel_file):
                cancelled = True
                emitter.cancelled(after_sources=len(outcomes))
                break
            emitter.source_started(
                course_dir=course_rel, source=sel.path, start_page=sel.start_page
            )
            try:
                markdown, info = _digest_one_source(
                    root=root,
                    sel=sel,
                    provider=provider,
                    model_id=model_id,
                    emitter=emitter,
                    settings=settings,
                    cache=cache,
                    cancel_file=cancel_file,
                )
            except Exception as e:  # prepare, provider, validation, or clipping failure
                failed += 1
                emitter.stage(
                    course_dir=course_rel, source=sel.path,
                    stage="generate", status="fail", detail=str(e),
                )
                emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                outcomes.append(SourceOutcome(course_rel, sel.path, False, "generate", str(e)))
                continue

            now = datetime.now(timezone.utc)
            digest_abs = next_digest_path(course_abs, settings.digests_dirname, now)
            try:
                digest_abs.write_text(markdown)
            except OSError as e:
                failed += 1
                emitter.source_failed(course_dir=course_rel, source=sel.path, message=str(e))
                outcomes.append(SourceOutcome(course_rel, sel.path, False, "write", str(e)))
                continue

            digest_rel = str(digest_abs.relative_to(course_abs))
            manifest.record(
                DigestRecord(
                    source_path=sel.path,
                    source_hash=info["source_hash"],
                    page_count=info["page_count"],
                    start_page=info["start_page"],
                    end_page=info["page_count"],
                    digest_file=digest_rel,
                    model_id=model_id,
                    processing_path=info["processing_path"],
                    generate_mode=info["generate_mode"],
                    chunk_count=info["chunk_count"],
                    digested_at=now.isoformat(),
                )
            )
            processed += 1
            new_digests.append(digest_rel)
            digested_sources.append(root / sel.path)
            commit_paths.append(Path(course_rel) / digest_rel)
            emitter.source_done(course_dir=course_rel, source=sel.path, digest=digest_rel)
            outcomes.append(
                SourceOutcome(course_rel, sel.path, True, digest_file=digest_rel)
            )

        if not new_digests:
            emitter.course_done(course_dir=course_rel, digests=0)
            continue

        manifest.save()
        commit_paths.append(Path(course_rel) / CourseManifest.FILENAME)
        done_courses.append(course_rel)

        emitter.course_synthesis_started(
            course_dir=course_rel, digest_count=len(manifest.digest_files())
        )
        try:
            course_markdown = synthesize_course(
                provider,
                course_name=course_rel,
                digests=manifest.read_digests(),
                model_id=model_id,
                cwd=course_abs,
            )
        except CourseSynthesisError as e:
            emitter.course_synthesis_failed(
                course_dir=course_rel, code=CourseSynthesisError.code, message=str(e)
            )
            emitter.course_done(course_dir=course_rel, digests=len(new_digests))
            continue

        course_file = course_abs / settings.course_file_name
        course_file.write_text(
            course_markdown if course_markdown.endswith("\n") else course_markdown + "\n"
        )
        commit_paths.append(Path(course_rel) / settings.course_file_name)
        emitter.course_synthesis_done(course_dir=course_rel)

        if settings.delete_sources_after_digest:
            for src_abs in digested_sources:
                try:
                    src_abs.unlink()
                except OSError:
                    continue
                emitter.source_deleted(
                    course_dir=course_rel, source=str(src_abs.relative_to(root))
                )
            # Stage the course directory so removals are recorded even for
            # sources git never tracked.
            commit_paths.append(Path(course_rel))
        else:
            for src_abs in digested_sources:
                if src_abs.is_file():
                    commit_paths.append(src_abs.relative_to(root))

        emitter.course_done(course_dir=course_rel, digests=len(new_digests))

    commit = None
    if commit_paths:
        ensure_gitignored(root, settings.cache_dir_name)
        commit_paths.append(Path(".gitignore"))
        message = "digest: " + ", ".join(done_courses)
        try:
            commit = commit_batch(root, commit_paths, message)
            emitter.committed(commit=commit, courses=done_courses)
        except GitStateError as e:
            emitter.error(message=str(e))
            emitter.run_done(processed=processed, failed=failed, skipped=skipped)
            return RunResult(processed, failed, skipped, None, outcomes)

    emitter.run_done(processed=processed, failed=failed, skipped=skipped)
    return RunResult(processed, failed, skipped, commit, outcomes)
```

- [ ] **Step 4: Delete the per-source metadata module**

```bash
git rm python/src/arbor_worker/metadata.py python/tests/test_metadata.py
```

- [ ] **Step 5: Run the pipeline tests**

Run: `cd python && uv run pytest tests/test_pipeline.py -v`
Expected: PASS

- [ ] **Step 6: Run the whole worker suite**

Run: `cd python && uv run pytest -q`
Expected: PASS except `tests/test_cli.py`, which still calls the old `update` flow and is fixed in Task 11.

- [ ] **Step 7: Commit**

```bash
git add -A python/src/arbor_worker/pipeline.py python/tests/test_pipeline.py
git commit -m "feat(worker): course-centric pipeline with dated digests and course.md"
```

---

## Task 11: CLI `plan-update` and `update --plan`

**Files:**
- Modify: `python/src/arbor_worker/cli.py`
- Modify: `python/src/arbor_worker/commands.py`
- Test: `python/tests/test_cli.py`

**Interfaces:**
- Consumes: `build_plan`, `plan_to_dict` (Task 7); `load_settings` (Task 1); `run_update(..., selections=...)` (Task 10).
- Produces: subcommand `plan-update --root <path>` printing `{"pending": [...]}`; `update --plan <file>` where the file is `{"selections": [{"path": "...", "start_page": 151 | null}]}`; `cmd_plan_update(args) -> int`.
- Behavior: `update` without `--plan` processes every pending source from page 1.

- [ ] **Step 1: Write the failing test**

Add to `python/tests/test_cli.py`:

```python
def _knowledge_repo_with_pdf(tmp_path, pages=1, name="Biology/mega.pdf"):
    import subprocess

    import fitz

    root = tmp_path / "K"
    root.mkdir()
    subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@a.b"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "T"], check=True)
    (root / ".gitignore").write_text("_arbor_cache/\n")
    subprocess.run(["git", "-C", str(root), "add", ".gitignore"], check=True)
    subprocess.run(["git", "-C", str(root), "commit", "-q", "-m", "init"], check=True)

    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"page {i + 1}")
    doc.save(str(target))
    doc.close()
    return root


def test_plan_update_lists_pending_sources(tmp_path):
    root = _knowledge_repo_with_pdf(tmp_path, pages=3)
    code, out, _ = run(["plan-update", "--root", str(root)])
    assert code == 0
    data = _json.loads(out)
    assert data["pending"][0]["path"] == "Biology/mega.pdf"
    assert data["pending"][0]["page_count"] == 3
    assert data["pending"][0]["suggested_start_page"] is None


def test_plan_update_registered():
    parser = cli.build_parser()
    choices = set()
    for a in [a for a in parser._actions if getattr(a, "choices", None)]:
        choices.update(a.choices.keys())
    assert "plan-update" in choices


def test_update_with_plan_file_applies_start_page(tmp_path):
    root = _knowledge_repo_with_pdf(tmp_path, pages=4)
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(
        _json.dumps({"selections": [{"path": "Biology/mega.pdf", "start_page": 3}]})
    )

    code, out, _ = run(
        [
            "update",
            "--root", str(root),
            "--model", "m",
            "--provider", "fake",
            "--plan", str(plan_file),
        ]
    )
    assert code == 0
    manifest = _json.loads((root / "Biology" / "arbor-course.json").read_text())
    assert manifest["records"][0]["start_page"] == 3
    assert (root / "Biology" / "course.md").is_file()


def test_update_without_plan_processes_everything(tmp_path):
    root = _knowledge_repo_with_pdf(tmp_path, pages=2)
    code, _, _ = run(
        ["update", "--root", str(root), "--model", "m", "--provider", "fake"]
    )
    assert code == 0
    manifest = _json.loads((root / "Biology" / "arbor-course.json").read_text())
    assert manifest["records"][0]["start_page"] == 1
```

Also delete the existing `test_update_with_fake_provider_processes` test from `python/tests/test_cli.py` — it asserts the removed `Bio/L1/lecture.md` layout and is replaced by the two `update` tests above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: FAIL with `invalid choice: 'plan-update'` and `unrecognized arguments: --plan`.

- [ ] **Step 3: Register the CLI surface**

In `python/src/arbor_worker/cli.py`, add the new subparser after the `list-models` block:

```python
    pu = sub.add_parser("plan-update", help="List sources that would be processed, as JSON.")
    pu.add_argument("--root", required=True, help="Path to the Knowledge git repo.")
```

Add this argument to the `update` subparser after `--cancel-file`:

```python
    up.add_argument("--plan", default=None, help="JSON file with {\"selections\": [{\"path\", \"start_page\"}]}.")
```

Add this dispatch branch before `if args.command == "update":`:

```python
    if args.command == "plan-update":
        from arbor_worker.commands import cmd_plan_update
        return cmd_plan_update(args)
```

- [ ] **Step 4: Implement the handlers**

In `python/src/arbor_worker/commands.py`, replace the imports block:

```python
from arbor_worker.auth import check_codex_auth
from arbor_worker.events import EventEmitter
from arbor_worker.pipeline import run_update
from arbor_worker.planning import build_plan, plan_to_dict
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings, load_models, load_settings
```

Add this helper and command after `cmd_list_models`:

```python
def _load_selections(plan_path: str | None) -> dict[str, int | None]:
    if not plan_path:
        return {}
    data = json.loads(Path(plan_path).read_text())
    selections: dict[str, int | None] = {}
    for item in data.get("selections", []):
        start_page = item.get("start_page")
        selections[item["path"]] = None if start_page is None else int(start_page)
    return selections


def cmd_plan_update(args) -> int:
    root = Path(args.root)
    settings = load_settings(root)
    print(json.dumps(plan_to_dict(build_plan(root, settings))))
    return 0
```

In `cmd_update`, replace these two lines:

```python
    settings = default_settings()
    root = Path(args.root)
```

with:

```python
    root = Path(args.root)
    settings = load_settings(root)
```

Then replace the `run_update(...)` call with:

```python
        result = run_update(
            root,
            args.model,
            provider,
            emitter,
            settings,
            selections=_load_selections(getattr(args, "plan", None)),
            cancel_file=cancel_file,
        )
```

- [ ] **Step 5: Run the CLI tests**

Run: `cd python && uv run pytest tests/test_cli.py -v`
Expected: PASS

- [ ] **Step 6: Run the whole worker suite**

Run: `cd python && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add python/src/arbor_worker/cli.py python/src/arbor_worker/commands.py python/tests/test_cli.py
git commit -m "feat(worker): add plan-update command and update --plan selections"
```

---

## Task 12: Desktop Rust — plan command and selection-aware update

**Files:**
- Modify: `desktop/src-tauri/src/worker.rs`
- Modify: `desktop/src-tauri/src/commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Tauri command `plan_update(root: String) -> serde_json::Value` (runs `plan-update --root`), and `start_update(root: String, model: String, selections: Vec<Selection>)` where `Selection { path: String, start_page: Option<u32> }`.
- Produces: `worker::plan_file_path() -> PathBuf`; `worker::spawn_update_stream(app, app_dir, root, model, cancel_file, plan_file)`.

- [ ] **Step 1: Add the plan file path and pass `--plan` when streaming**

In `desktop/src-tauri/src/worker.rs`, add after `cancel_file_path`:

```rust
#[cfg(feature = "desktop-runtime")]
pub fn plan_file_path() -> PathBuf {
    std::env::temp_dir().join("arbor-plan.json")
}
```

Change the `spawn_update_stream` signature and argv construction to:

```rust
#[cfg(feature = "desktop-runtime")]
pub fn spawn_update_stream(
    app: tauri::AppHandle,
    app_dir: PathBuf,
    root: String,
    model: String,
    cancel_file: PathBuf,
    plan_file: PathBuf,
) {
    use tauri::Emitter;

    let cancel_str = cancel_file.to_string_lossy().to_string();
    let plan_str = plan_file.to_string_lossy().to_string();
    let sub_args = [
        "update",
        "--root", &root,
        "--model", &model,
        "--cancel-file", &cancel_str,
        "--plan", &plan_str,
    ];
    let argv = resolve_worker_argv(&|k| std::env::var(k).ok(), &default_python_dir(&app_dir), &sub_args);
```

Leave the rest of the function body unchanged.

- [ ] **Step 2: Add the commands**

In `desktop/src-tauri/src/commands.rs`, add after `list_models`:

```rust
#[tauri::command]
pub fn plan_update(app: tauri::AppHandle, root: String) -> Result<serde_json::Value, String> {
    worker::run_worker_json(&repo_dir(&app), &["plan-update", "--root", &root])
}
```

Replace the whole `start_update` command with:

```rust
#[derive(serde::Deserialize, serde::Serialize, Clone)]
pub struct Selection {
    pub path: String,
    pub start_page: Option<u32>,
}

#[tauri::command]
pub fn start_update(
    app: tauri::AppHandle,
    root: String,
    model: String,
    selections: Vec<Selection>,
) -> Result<(), String> {
    let cancel = worker::cancel_file_path();
    let _ = std::fs::remove_file(&cancel); // clear stale cancel

    let plan_path = worker::plan_file_path();
    let body = serde_json::json!({ "selections": selections });
    std::fs::write(
        &plan_path,
        serde_json::to_vec(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let app_dir = repo_dir(&app);
    worker::spawn_update_stream(app, app_dir, root, model, cancel, plan_path);
    Ok(())
}
```

- [ ] **Step 3: Register the new command**

In `desktop/src-tauri/src/lib.rs`, add `commands::plan_update` to the `generate_handler!` list, next to `commands::list_models`.

- [ ] **Step 4: Verify it compiles and unit tests pass**

Run: `cd desktop/src-tauri && cargo test`
Expected: PASS (the three `resolve_worker_argv` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/worker.rs desktop/src-tauri/src/commands.rs desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): plan_update command and selection-aware start_update"
```

---

## Task 13: Desktop frontend — pre-Update review panel

**Files:**
- Modify: `desktop/src/types.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/styles.css`
- Modify: `desktop/src/main.ts`

**Interfaces:**
- Consumes: `plan_update` and `start_update(root, model, selections)` (Task 12); course events (Task 9).
- Produces: TS types `PendingSource`, `UpdatePlan`, `Selection`; a review panel that lists pending files with a start-page input and Confirm / Cancel buttons.

- [ ] **Step 1: Add the frontend types**

In `desktop/src/types.ts`, add:

```ts
export interface PendingSource {
  path: string;
  course: string;
  source_type: string;
  page_count: number;
  suggested_start_page: number | null;
  previously_digested: boolean;
}

export interface UpdatePlan {
  pending: PendingSource[];
}

export interface Selection {
  path: string;
  start_page: number | null;
}
```

In the same file, replace the `WorkerEvent` interface with:

```ts
export interface WorkerEvent {
  type: string;
  ts?: string;
  model_id?: string;
  course_dir?: string;
  source?: string;
  start_page?: number;
  digest?: string;
  digests?: number;
  digest_count?: number;
  sources?: number;
  stage?: string;
  status?: string;
  detail?: string;
  message?: string;
  commit?: string;
  courses?: string[];
  processed?: number;
  failed?: number;
  skipped?: number;
  after_sources?: number;
  reason?: string;
  docs_url?: string;
  code?: number;
}
```

- [ ] **Step 2: Add the review panel markup**

In `desktop/index.html`, insert this section between the actions section and the `<pre id="log">` element:

```html
      <section id="review" class="review" hidden>
        <h2>Files to process</h2>
        <table>
          <thead>
            <tr><th>File</th><th>Pages</th><th>Start from</th></tr>
          </thead>
          <tbody id="review-rows"></tbody>
        </table>
        <p class="guidance">Leave “Start from” empty to process the whole file.</p>
        <div class="row actions">
          <button id="confirm-update">Confirm</button>
          <button id="cancel-review">Cancel</button>
        </div>
      </section>
```

- [ ] **Step 3: Style the panel**

Append to `desktop/src/styles.css`:

```css
.review { margin-top: 1rem; border: 1px solid #ccc; border-radius: 8px; padding: 0.8rem; }
.review table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.review th, .review td { text-align: left; padding: 0.3rem 0.4rem; border-bottom: 1px solid #eee; }
.review input { width: 6rem; }
```

- [ ] **Step 4: Wire the flow in `main.ts`**

In `desktop/src/main.ts`, add these element handles after `const logEl = ...`:

```ts
const reviewEl = $("review") as HTMLElement;
const reviewRowsEl = $("review-rows") as HTMLTableSectionElement;
const confirmBtn = $("confirm-update") as HTMLButtonElement;
const cancelReviewBtn = $("cancel-review") as HTMLButtonElement;
```

Add this import to the existing type import: `PendingSource`, `Selection`, `UpdatePlan`.

Add the review rendering helpers after `refreshUpdateEnabled()`:

```ts
function renderReview(pending: PendingSource[]) {
  reviewRowsEl.innerHTML = "";
  for (const p of pending) {
    const row = document.createElement("tr");

    const file = document.createElement("td");
    file.textContent = p.path;

    const pages = document.createElement("td");
    pages.textContent = String(p.page_count);

    const startCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(p.page_count);
    input.placeholder = "all";
    input.dataset.path = p.path;
    if (p.suggested_start_page !== null) input.value = String(p.suggested_start_page);
    startCell.appendChild(input);

    row.append(file, pages, startCell);
    reviewRowsEl.appendChild(row);
  }
  reviewEl.hidden = false;
}

function collectSelections(): Selection[] {
  const inputs = Array.from(reviewRowsEl.querySelectorAll("input")) as HTMLInputElement[];
  return inputs.map((input) => ({
    path: input.dataset.path as string,
    start_page: input.value.trim() === "" ? null : Number(input.value),
  }));
}
```

Replace the `updateBtn` click handler with:

```ts
updateBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  logEl.textContent = "";
  try {
    const plan = await invoke<UpdatePlan>("plan_update", { root: knowledgeRoot });
    if (plan.pending.length === 0) {
      logLine("Nothing to process — everything is up to date.");
      return;
    }
    renderReview(plan.pending);
  } catch (e) {
    logLine(`Could not plan update: ${e}`);
  }
});

confirmBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  const selections = collectSelections();
  reviewEl.hidden = true;
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  await invoke("start_update", {
    root: knowledgeRoot,
    model: modelSel.value,
    selections,
  });
});

cancelReviewBtn.addEventListener("click", () => {
  reviewEl.hidden = true;
  logLine("Update cancelled before processing.");
});
```

Replace the `renderEvent` switch cases for the removed lecture events with the course events:

```ts
    case "course_started":
      logLine(`\n■ ${ev.course_dir} (${ev.sources} source(s))`);
      break;
    case "source_started":
      logLine(`  • ${ev.source} from page ${ev.start_page}`);
      break;
    case "source_done":
      logLine(`    ✓ ${ev.digest}`);
      break;
    case "source_failed":
      logLine(`    ✗ ${ev.source}: ${ev.message}`);
      break;
    case "source_deleted":
      logLine(`    🗑 removed ${ev.source}`);
      break;
    case "course_synthesis_started":
      logLine(`  Synthesizing course.md from ${ev.digest_count} digest(s)…`);
      break;
    case "course_synthesis_done":
      logLine(`  ✓ course.md updated`);
      break;
    case "course_synthesis_failed":
      logLine(`  ✗ course.md not updated: ${ev.message}`);
      break;
    case "course_done":
      logLine(`  ${ev.course_dir}: ${ev.digests} new digest(s)`);
      break;
```

and change the `committed` case body to:

```ts
      logLine(`Committed ${ev.commit}: ${(ev.courses ?? []).join(", ")}`);
```

- [ ] **Step 5: Verify the frontend builds**

Run: `cd desktop && npm install && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types.ts desktop/index.html desktop/src/styles.css desktop/src/main.ts
git commit -m "feat(desktop): pre-Update review panel with per-file start page"
```

---

## Task 14: Documentation

**Files:**
- Modify: `python/README.md`
- Modify: `README.md`
- Modify: `desktop/README.md`

**Interfaces:**
- Consumes: everything above. No code changes.

- [ ] **Step 1: Update the worker README**

In `python/README.md`, replace the `## Commands` block with:

```markdown
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
```

Replace the event table rows for the removed lecture events with:

```markdown
| `course_started` | `course_dir`, `sources` |
| `source_started` | `course_dir`, `source`, `start_page` |
| `source_done` | `course_dir`, `source`, `digest` |
| `source_failed` | `course_dir`, `source`, `message` |
| `source_deleted` | `course_dir`, `source` |
| `course_synthesis_started` | `course_dir`, `digest_count` |
| `course_synthesis_done` | `course_dir` |
| `course_synthesis_failed` | `course_dir`, `code`, `message` |
| `course_done` | `course_dir`, `digests` |
```

In the same table, change `stage` to `course_dir`, `source`, `stage` (`prepare`/`generate`), `status`, `detail?`; change every chunk/synthesis row's `lecture_dir` to `course_dir`; change `cancelled` to `after_sources`; change `committed` to `commit`, `courses`.

In the `## Large-PDF chunking` section, replace the final sentence
("`metadata.json` records `generate_mode`, …") with:

```markdown
The manifest record for that digest stores `generate_mode`, and for chunked runs
`chunk_count`, in `arbor-course.json`.
```

and change "synthesized into one `lecture.md`" in the same paragraph to
"synthesized into one dated digest".

Add this section before `## Manual live check (real Codex)`:

```markdown
## Course layout and incremental ingest

Each immediate child directory of the Knowledge root is a **course**. Sources may
sit anywhere under it. Successful runs write `digests/YYYY-MM-DD.md`, append a
record to the committed `arbor-course.json`, and re-synthesize `course.md` from all
digests. A source is pending when its hash is absent from `arbor-course.json`, so a
grown mega-deck reappears with `suggested_start_page` set to the first new page.

Set `delete_sources_after_digest` in `<root>/.arbor/settings.json` to remove source
files after they are digested (default `false`).
```

Update the `Exit codes` line to read: `0` all succeeded, `1` at least one source failed, `3` Codex not authenticated.

Replace the manual live-check commands with:

```bash
uv run arbor-worker check-auth          # {"authenticated": true, ...}
mkdir -p /tmp/K && cd /tmp/K && git init -q && git commit -q --allow-empty -m init
mkdir -p Biology && cp ~/some-lecture.pdf Biology/mega.pdf
uv run arbor-worker plan-update --root /tmp/K
uv run arbor-worker update --root /tmp/K --model <model-id>
```

and change the expectation line to: Expect `Biology/digests/<date>.md`, `Biology/course.md`, `Biology/arbor-course.json`, and a `digest:` commit.

- [ ] **Step 2: Update the root README**

In `README.md`, replace the numbered "How it works" list items 2–5 with:

```markdown
2. Create one folder per course (`Biology/`, `Chemistry/`) and put sources anywhere inside.
3. Click **Update Knowledge** and review the detected files.
4. Optionally set a start page per file (blank processes the whole file), then Confirm.
5. Each processed source writes `digests/<date>.md`; `course.md` is re-synthesized and the run is committed.
```

Replace the layout code block with:

```text
Knowledge/                          # git repo root
  Biology/
    mega.pdf              # sources live anywhere under the course
    readings/chapter.pdf
    digests/
      2026-08-12.md       # one digest per processed window
    course.md             # LLM rollup of all digests
    arbor-course.json     # processed-state manifest (committed)
  _arbor_cache/           # worker cache (auto-created; gitignored)
  .arbor/
    settings.json         # delete_sources_after_digest, models
```

Replace the sentence "Edits to digest files alone do **not** trigger reprocessing — only dirty source files do." with:

```markdown
Reprocessing is driven by `arbor-course.json`: a source is picked up when it is new or its
contents changed. Editing digests by hand never triggers reprocessing.
```

In "Using the app", replace step 4 with:

```markdown
4. **Update Knowledge** — review the detected files, optionally set a start page for each
   (blank = whole file), then Confirm. Progress streams per course and source.
```

Add this row to the environment/settings documentation, in the `## Customizing models` section, after the models JSON block:

```markdown
`.arbor/settings.json` holds worker options:

```json
{ "delete_sources_after_digest": false }
```

Set it to `true` to delete each source file after it is successfully digested.
```

- [ ] **Step 3: Update the desktop README**

In `desktop/README.md`, replace manual checklist items 3–8 with:

```markdown
3. **Pick folder:** choose an empty folder → log shows "Initialized git repository".
4. **Review panel:** put a PDF at `Biology/mega.pdf`, click Update → the panel lists the file
   with its page count and an empty "Start from" box.
5. **Full ingest:** Confirm with the box empty → `Biology/digests/<date>.md`, `Biology/course.md`,
   and `Biology/arbor-course.json` appear, and a `digest:` commit is made.
6. **Idempotency:** click Update again with no changes → "Nothing to process".
7. **Growth:** append pages to `mega.pdf`, click Update → the panel prefills "Start from" with the
   first new page; Confirm writes a second dated digest and rewrites `course.md`.
8. **Cancel:** with two changed sources, click Cancel after the first → only completed digests are
   committed; log shows "Cancelled".
```

- [ ] **Step 4: Commit**

```bash
git add python/README.md README.md desktop/README.md
git commit -m "docs: document course-centric layout and start-page review"
```

---

## Task 15: Full-suite verification

**Files:**
- No source changes; verification only.

- [ ] **Step 1: Run the worker suite**

Run: `cd python && uv run pytest -q`
Expected: PASS, no failures.

- [ ] **Step 2: Run the Rust unit tests**

Run: `cd desktop/src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 3: Build the frontend**

Run: `cd desktop && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Confirm no stale lecture-layout references remain**

Run: `rg -n "lecture_dir|lecture\.md|LectureSource|validate_single_source_per_lecture|metadata\.json" python desktop README.md`
Expected: no matches in `python/src`, `python/tests`, `desktop/src`, `desktop/src-tauri/src`, or the READMEs. Matches inside `docs/superpowers/` (historical V1 plans and specs) are expected and must be left alone.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: finish course-centric migration cleanup"
```

---

## Self-review

**Spec coverage check (spec section → task):**
- Course folder as place of truth → Tasks 3, 10.
- Sources anywhere under the course, nesting allowed → Task 3.
- Pre-Update review panel with optional start page → Tasks 7, 11, 12, 13.
- Empty start page → full ingest → Task 7 (`apply_selections` default) + Task 11 (`update` without `--plan`).
- Start page `N` → logical clip, master file untouched → Task 5 (`clip_images`) + Task 10 (`_digest_one_source`).
- Dated digests `digests/YYYY-MM-DD.md` with disambiguation → Task 6.
- `course.md` LLM synthesis after each successful batch → Tasks 8, 10.
- Course manifest committed with fingerprints/windows/digest paths → Tasks 4, 10.
- `delete_sources_after_digest` config, default `false`, failed sources never deleted → Tasks 1, 10.
- Failure semantics (other digests kept, manifest unrecorded, no `course.md` rewrite on synthesis failure) → Task 10 tests.
- Cancel at source boundaries → Task 10 (`test_cancel_stops_before_next_source`).
- Chunked generate reused for large windows → Task 10 (`test_large_window_uses_chunked_generate`).
- Events for course/source/synthesis → Task 9.
- Clean break, no V1 dual path or auto-migration → Tasks 3, 10, 14, 15.
- Cache-only artifacts stay in `_arbor_cache` → unchanged `CacheDir` usage in Task 10.

**Placeholder scan:** No TBD/TODO markers. Every code step contains complete Python, Rust, TypeScript, HTML, CSS, or Markdown content.

**Type consistency:** `CourseSource(path, course_dir, source_type)` (Task 3) is consumed by `build_plan` (Task 7). `PendingSource`/`SelectedSource` field names match between `planning.py`, `plan_to_dict`, the CLI JSON, and the TS `PendingSource`/`Selection` types. `DigestRecord` field names match the manifest assertions in Tasks 4, 7, 10, and 11. `CourseManifest.FILENAME`, `load`, `save`, `record`, `latest_for`, `is_current`, `digest_files`, `read_digests` are used with those exact names in Tasks 7 and 10. `chunked_generate(..., course_dir=...)` (Task 9) matches the call site in Task 10. `synthesize_course(provider, *, course_name, digests, model_id, cwd)` (Task 8) matches Task 10. `spawn_update_stream(app, app_dir, root, model, cancel_file, plan_file)` (Task 12) matches its only call site.
