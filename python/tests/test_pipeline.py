import dataclasses
import io
import json
import subprocess
import sys
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.course_manifest import CourseManifest, DigestRecord, SourceFingerprintState
from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.pipeline import run_update
from arbor_worker.planning import build_plan
from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings
from prompt_marked_fake import PromptMarkedFake
from ui_overhaul_fixtures import build_ui_overhaul_update_root, update_fake_digest_markdown

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
        pdf_render_dpi=72,
    )


def _settings():
    return dataclasses.replace(default_settings(), pdf_render_dpi=72)


def _manifest(course_dir: Path) -> dict:
    return json.loads((course_dir / "arbor-course.json").read_text())


def test_nothing_to_process(git_repo: Path):
    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, _settings())
    assert res.processed == 0
    assert "nothing_to_process" in [e["type"] for e in parse_lines(buf.getvalue())]


def test_processes_source_into_dated_digest_and_course_index(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    prov = PromptMarkedFake(GOOD_MD)
    em, buf = _emitter()

    res = run_update(git_repo, "gpt-5.6-sol", prov, em, _settings())

    assert res.processed == 1 and res.failed == 0
    digests = sorted((course / "digests").glob("*.md"))
    assert len(digests) == 1
    digest_text = digests[0].read_text()
    assert "<!-- arbor-pages:1-1 -->" in digest_text
    course_md = (course / "course.md").read_text()
    assert course_md.startswith("# Biology")
    assert f"[{digests[0].name}](digests/{digests[0].name})" in course_md
    assert not any("assembling the single study notebook" in c.prompt for c in prov.calls)
    record = _manifest(course)["records"][0]
    assert record["source_path"] == "Biology/mega.pdf"
    assert record["model_id"] == "gpt-5.6-sol"
    assert record["processing_path"] == "pdf_images"
    assert record["start_page"] == 1
    assert record["end_page"] == 1
    assert record["page_markers_version"] == 1
    manifest = _manifest(course)
    assert manifest["version"] == 2
    source_state = manifest["sources"]["Biology/mega.pdf"]
    assert source_state["page_count"] == 1
    assert len(source_state["page_fingerprints"]) == 1
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert "course_started" in types and "source_done" in types
    assert "course_synthesis_done" in types and "committed" in types


def test_second_run_is_idempotent(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())

    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, _settings())
    assert res.processed == 0
    assert "nothing_to_process" in [e["type"] for e in parse_lines(buf.getvalue())]
    assert len(list((course / "digests").glob("*.md"))) == 1


def test_confirmed_range_limits_pages_and_stores_window_end(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=4)
    prov = PromptMarkedFake(GOOD_MD)

    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        _settings(),
        selections={"Biology/mega.pdf": [PageRange(3, 4)]},
    )

    assert res.processed == 1
    digest_call = next(c for c in prov.calls if c.image_paths)
    assert len(digest_call.image_paths) == 2
    assert "arbor-pages:3-4" in digest_call.prompt
    record = _manifest(course)["records"][0]
    assert record["start_page"] == 3
    assert record["end_page"] == 4
    assert "<!-- arbor-pages:3-4 -->" in (course / record["digest_file"]).read_text()


def test_partial_ingest_leaves_uncovered_pages_pending(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=4)
    run_update(
        git_repo,
        "m",
        PromptMarkedFake(GOOD_MD),
        EventEmitter(io.StringIO()),
        _settings(),
        selections={"Biology/mega.pdf": [PageRange(3, 4)]},
    )

    fps = _manifest(course)["sources"]["Biology/mega.pdf"]["page_fingerprints"]
    assert fps[0] == "" and fps[1] == ""
    assert fps[2] and fps[3]

    plan = build_plan(git_repo, _settings())
    assert len(plan.pending) == 1
    assert plan.pending[0].suggested_ranges == [PageRange(1, 2)]
    assert plan.pending[0].alignment_status == "changed"


def test_grown_source_only_digests_the_tail(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=2)
    run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())

    make_pdf(course / "mega.pdf", pages=5)
    prov = PromptMarkedFake(GOOD_MD)
    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        _settings(),
        selections={"Biology/mega.pdf": [PageRange(3, 5)]},
    )

    assert res.processed == 1
    digest_call = next(c for c in prov.calls if c.image_paths)
    assert len(digest_call.image_paths) == 3
    assert len(list((course / "digests").glob("*.md"))) == 2
    assert len(_manifest(course)["records"]) == 2
    tail = _manifest(course)["records"][-1]
    assert tail["start_page"] == 3
    assert tail["end_page"] == 5


def test_truncation_empty_ranges_do_no_work(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=5)
    run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())
    make_pdf(course / "mega.pdf", pages=4)

    prov = PromptMarkedFake(GOOD_MD)
    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        _settings(),
        selections={"Biology/mega.pdf": []},
    )

    assert res.processed == 0 and res.failed == 0
    assert not any(c.image_paths for c in prov.calls)
    assert len(list((course / "digests").glob("*.md"))) == 1


def test_new_source_empty_ranges_mean_full_ingest(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=3)
    prov = PromptMarkedFake(GOOD_MD)

    res = run_update(
        git_repo,
        "m",
        prov,
        EventEmitter(io.StringIO()),
        _settings(),
        selections={"Biology/mega.pdf": []},
    )

    assert res.processed == 1
    digest_call = next(c for c in prov.calls if c.image_paths)
    assert len(digest_call.image_paths) == 3
    record = _manifest(course)["records"][0]
    assert record["start_page"] == 1
    assert record["end_page"] == 3


def test_two_digests_call_provider_for_course_rollup(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    prov = PromptMarkedFake(GOOD_MD)

    res = run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), _settings())

    assert res.processed == 2
    assert any("assembling the single study notebook" in c.prompt for c in prov.calls)
    assert (course / "course.md").read_text().startswith("# Lecture")


def test_generate_failure_writes_no_digest_and_no_commit(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)
    em, buf = _emitter()

    res = run_update(git_repo, "m", FakeProvider("too short"), em, _settings())

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

    class FailSecond(PromptMarkedFake):
        def run(self, request):
            if "bad.pdf" in request.prompt:
                self.calls.append(request)
                raise RuntimeError("provider exploded")
            return super().run(request)

    res = run_update(git_repo, "m", FailSecond(GOOD_MD), EventEmitter(io.StringIO()), _settings())

    assert res.processed == 1 and res.failed == 1
    assert len(list((course / "digests").glob("*.md"))) == 1
    sources = [r["source_path"] for r in _manifest(course)["records"]]
    assert sources == ["Biology/good.pdf"]


def test_large_window_uses_chunked_generate_with_absolute_pages(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=5)
    em, buf = _emitter()
    prov = PromptMarkedFake(GOOD_MD)

    res = run_update(
        git_repo,
        "m",
        prov,
        em,
        _chunk_settings(),
        selections={"Biology/mega.pdf": [PageRange(2, 5)]},
    )

    assert res.processed == 1
    events = parse_lines(buf.getvalue())
    chunk_starts = [e for e in events if e["type"] == "chunk_started"]
    assert chunk_starts
    assert chunk_starts[0]["page_start"] == 2
    assert _manifest(course)["records"][0]["generate_mode"] == "chunked"
    assert _manifest(course)["records"][0]["end_page"] == 5


def test_cancel_stops_before_next_source(git_repo: Path, make_pdf, tmp_path: Path):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    cancel.write_text("stop")
    em, buf = _emitter()

    res = run_update(
        git_repo, "m", PromptMarkedFake(GOOD_MD), em, _settings(), cancel_file=cancel
    )

    assert res.processed == 0
    assert any(e["type"] == "cancelled" for e in parse_lines(buf.getvalue()))


def test_delete_sources_keeps_fingerprints(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    pdf = make_pdf(course / "mega.pdf", pages=1)
    settings = dataclasses.replace(_settings(), delete_sources_after_digest=True)

    res = run_update(
        git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), settings
    )

    assert res.processed == 1 and res.failed == 0
    assert not pdf.exists()
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert (course / "course.md").is_file()
    manifest = _manifest(course)
    assert manifest["version"] == 2
    assert manifest["sources"]["Biology/mega.pdf"]["page_fingerprints"]


def test_course_synthesis_failure_saves_records_and_toc(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)

    class SynthesisFailProvider(PromptMarkedFake):
        def run(self, request):
            if "assembling the single study notebook" in request.prompt:
                self.calls.append(request)
                raise RuntimeError("synthesis exploded")
            return super().run(request)

    em, buf = _emitter()
    res = run_update(git_repo, "m", SynthesisFailProvider(GOOD_MD), em, _settings())

    assert res.processed == 2
    digest_names = sorted(p.name for p in (course / "digests").glob("*.md"))
    assert len(digest_names) == 2
    assert (course / "arbor-course.json").is_file()
    course_md = (course / "course.md").read_text()
    assert course_md.startswith("# Biology")
    assert "## Digests" in course_md
    for name in digest_names:
        assert f"[{name}](digests/{name})" in course_md
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "course_synthesis_failed" for e in events)
    assert not any(e["type"] == "course_synthesis_done" for e in events)
    assert any(e["type"] == "committed" for e in events)

    plan = build_plan(git_repo, _settings())
    assert plan.pending == []


def test_overlapping_update_patches_one_digest_with_owning_span_images(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=4)
    run_update(
        git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings()
    )
    digests = list((course / "digests").glob("*.md"))
    assert len(digests) == 1
    assert "<!-- arbor-pages:1-4 -->" in digests[0].read_text()

    make_pdf(course / "mega.pdf", pages=4, text="Changed")
    prov = PromptMarkedFake(GOOD_MD)
    em, buf = _emitter()
    res = run_update(
        git_repo,
        "m",
        prov,
        em,
        _settings(),
        selections={"Biology/mega.pdf": [PageRange(2, 3)]},
    )

    assert res.processed == 1
    assert len(list((course / "digests").glob("*.md"))) == 1
    digest_text = next((course / "digests").glob("*.md")).read_text()
    assert "<!-- arbor-pages:1-4 -->" in digest_text
    events = parse_lines(buf.getvalue())
    generate_starts = [
        e for e in events
        if e["type"] == "stage" and e.get("stage") == "generate" and e.get("status") == "start"
    ]
    assert any(e.get("action") == "patch" for e in generate_starts)
    assert not any(e.get("action") in ("create", "regenerate") for e in generate_starts)
    digest_call = next(c for c in prov.calls if c.image_paths)
    assert "arbor-pages:1-4" in digest_call.prompt
    assert len(digest_call.image_paths) == 4


def test_planned_event_before_sources_with_index_and_total(
    tmp_path: Path, make_pdf, monkeypatch
):
    fixture = build_ui_overhaul_update_root(tmp_path, make_pdf)
    monkeypatch.setenv("ARBOR_FAKE_MD", update_fake_digest_markdown(1, 1))

    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "arbor_worker",
            "update",
            "--root",
            str(fixture.root),
            "--model",
            "m",
            "--provider",
            "fake",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    events = parse_lines(proc.stdout)

    planned = next(e for e in events if e["type"] == "planned")
    assert planned["total"] == 2
    planned_idx = events.index(planned)
    first_source_idx = next(i for i, e in enumerate(events) if e["type"] == "source_started")
    assert planned_idx < first_source_idx

    started = [e for e in events if e["type"] == "source_started"]
    assert len(started) == 2
    assert [e["index"] for e in started] == [1, 2]
    assert started[0]["total"] == 2
    assert started[1]["total"] == 2


# ---- Cancel: stops the running call, commits finished sources, rolls back the rest ----
# (plan I11, I14; Q21-Q24, Q29, Q30, Q35, Q37)

import threading
import time

SYNTHESIS_MARK = "assembling the single study notebook"
SEEDED_COURSE_MD = "# Biology\n\n## Overview\nSeeded course notebook, hand written, long enough.\n"
OTHER_MD = GOOD_MD.replace("definitely long enough", "freshly regenerated and long enough")


def _git_out(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True
    ).stdout


def _status(root: Path) -> list[str]:
    return _git_out(root, "status", "--porcelain", "-uall").splitlines()


def _event_types(buf: io.StringIO) -> list[str]:
    return [e["type"] for e in parse_lines(buf.getvalue())]


def _seed_digested_class(git_repo: Path, make_pdf) -> Path:
    """Biology with one digested source (old.pdf) and a committed, hand-edited course.md."""
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "old.pdf", pages=1)
    run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())
    (course / "course.md").write_text(SEEDED_COURSE_MD)
    _git_out(git_repo, "add", "-A")
    _git_out(git_repo, "commit", "-q", "-m", "seed course")
    return course


class CancelAfterFirstDigest(PromptMarkedFake):
    """Writes the cancel flag once the first source digest has been produced."""

    def __init__(self, markdown: str, cancel_file: Path):
        super().__init__(markdown)
        self._cancel_file = cancel_file
        self._tripped = False

    def run(self, request):
        result = super().run(request)
        if SYNTHESIS_MARK not in request.prompt and not self._tripped:
            self._tripped = True
            self._cancel_file.write_text("stop")
        return result


def _cancel_when_blocked(provider: PromptMarkedFake, cancel_file: Path, after: float = 0.2):
    def watch():
        if provider.blocked.wait(15):
            time.sleep(after)
            cancel_file.write_text("stop")

    thread = threading.Thread(target=watch, daemon=True)
    thread.start()
    return thread


def test_cancel_after_first_source_commits_it_and_leaves_course_md(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = _seed_digested_class(git_repo, make_pdf)
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = CancelAfterFirstDigest(GOOD_MD, cancel)
    em, buf = _emitter()

    res = run_update(git_repo, "m", prov, em, _settings(), cancel_file=cancel)

    assert res.processed == 1 and res.failed == 0
    assert not any(SYNTHESIS_MARK in c.prompt for c in prov.calls)
    assert (course / "course.md").read_text() == SEEDED_COURSE_MD
    assert len(list((course / "digests").glob("*.md"))) == 2
    assert len(_manifest(course)["records"]) == 2
    types = _event_types(buf)
    assert types.index("cancelled") < types.index("committed") < types.index("run_done")
    assert "course_synthesis_started" not in types
    assert _git_out(git_repo, "log", "-1", "--format=%s").strip() == "digest: Biology"
    committed = _git_out(git_repo, "show", "--name-only", "--format=", "HEAD").split()
    assert sum(1 for p in committed if "/digests/" in p) == 1
    assert "Biology/course.md" not in committed
    assert "Biology/arbor-course.json" in committed
    status = _status(git_repo)
    assert status == ["?? Biology/b.pdf"]


def test_cancel_with_no_course_md_writes_the_digest_list(git_repo: Path, make_pdf, tmp_path: Path):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = CancelAfterFirstDigest(GOOD_MD, cancel)

    res = run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), _settings(), cancel_file=cancel)

    assert res.processed == 1
    digest = next((course / "digests").glob("*.md"))
    course_md = (course / "course.md").read_text()
    assert course_md.startswith("# Biology")
    assert f"[{digest.name}](digests/{digest.name})" in course_md
    assert not any(SYNTHESIS_MARK in c.prompt for c in prov.calls)
    assert "Biology/course.md" in _git_out(git_repo, "show", "--name-only", "--format=", "HEAD")


def test_cancel_during_first_source_commits_nothing(git_repo: Path, make_pdf, tmp_path: Path):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: True)
    _cancel_when_blocked(prov, cancel)
    em, buf = _emitter()
    head = _git_out(git_repo, "rev-parse", "HEAD")

    res = run_update(git_repo, "m", prov, em, _settings(), cancel_file=cancel)

    types = _event_types(buf)
    assert res.processed == 0 and "cancelled" in types
    assert "source_failed" not in types and "committed" not in types
    assert _git_out(git_repo, "rev-parse", "HEAD") == head
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))
    assert not (course / "arbor-course.json").exists()
    assert not (course / "course.md").exists()


def test_blocked_provider_is_cancelled_within_the_limit_and_finished_source_stays(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: "b.pdf" in r.prompt)
    _cancel_when_blocked(prov, cancel, after=0.3)
    em, buf = _emitter()

    res = run_update(git_repo, "m", prov, em, _settings(), cancel_file=cancel)

    # blocked.wait() returns as the provider blocks; the cancel lands 0.3 s later.
    types = _event_types(buf)
    assert res.processed == 1 and "cancelled" in types and "source_failed" not in types
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert [r["source_path"] for r in _manifest(course)["records"]] == ["Biology/a.pdf"]
    assert _git_out(git_repo, "log", "-1", "--format=%s").strip() == "digest: Biology"
    assert _status(git_repo) == ["?? Biology/b.pdf"]


def test_blocked_call_ends_within_2_5_seconds_of_the_cancel(git_repo: Path, make_pdf, tmp_path: Path):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: True)
    flipped: list[float] = []

    def watch():
        prov.blocked.wait(15)
        flipped.append(time.monotonic())
        cancel.write_text("stop")

    threading.Thread(target=watch, daemon=True).start()

    run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), _settings(), cancel_file=cancel)

    assert time.monotonic() - flipped[0] < 2.5


def test_cancel_during_course_synthesis_keeps_course_md(git_repo: Path, make_pdf, tmp_path: Path):
    course = _seed_digested_class(git_repo, make_pdf)
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: SYNTHESIS_MARK in r.prompt)
    _cancel_when_blocked(prov, cancel)
    em, buf = _emitter()

    res = run_update(git_repo, "m", prov, em, _settings(), cancel_file=cancel)

    types = _event_types(buf)
    assert res.processed == 2
    assert "cancelled" in types and "course_synthesis_failed" not in types
    assert "course_synthesis_done" not in types
    assert (course / "course.md").read_text() == SEEDED_COURSE_MD
    assert len(_manifest(course)["records"]) == 3
    assert types.index("cancelled") < types.index("committed")
    status = _status(git_repo)
    assert status == []


def test_cancel_during_a_chunked_digest_is_cancelled_not_failed(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=5)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: True)
    _cancel_when_blocked(prov, cancel)
    em, buf = _emitter()

    res = run_update(git_repo, "m", prov, em, _chunk_settings(), cancel_file=cancel)

    types = _event_types(buf)
    assert res.processed == 0 and res.failed == 0
    assert "cancelled" in types
    assert "source_failed" not in types and "chunk_failed" not in types
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))


def test_cancel_between_chunk_calls_is_cancelled_not_failed(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=5)
    cancel = tmp_path / "cancel.flag"
    prov = CancelAfterFirstDigest(GOOD_MD, cancel)  # non-blocking; cancels after chunk 1
    em, buf = _emitter()

    res = run_update(git_repo, "m", prov, em, _chunk_settings(), cancel_file=cancel)

    types = _event_types(buf)
    assert res.failed == 0 and "cancelled" in types
    assert "source_failed" not in types
    assert types.count("chunk_done") == 1
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))


def test_multi_range_source_cancelled_after_first_range_leaves_no_file(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=6)
    cancel = tmp_path / "cancel.flag"
    prov = CancelAfterFirstDigest(GOOD_MD, cancel)
    em, buf = _emitter()

    res = run_update(
        git_repo,
        "m",
        prov,
        em,
        _settings(),
        selections={"Biology/a.pdf": [PageRange(1, 2), PageRange(4, 5)]},
        cancel_file=cancel,
    )

    assert res.processed == 0
    assert "cancelled" in _event_types(buf)
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))
    assert not (course / "arbor-course.json").exists()
    assert not (course / "course.md").exists()
    assert _status(git_repo) == ["?? Biology/a.pdf"]


def test_cancel_after_a_regenerate_restores_the_rewritten_digest(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=2)
    run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())
    digest = next((course / "digests").glob("*.md"))
    original = digest.read_bytes()
    manifest_before = (course / "arbor-course.json").read_bytes()
    head = _git_out(git_repo, "rev-parse", "HEAD")

    make_pdf(course / "a.pdf", pages=4)
    cancel = tmp_path / "cancel.flag"
    prov = CancelAfterFirstDigest(OTHER_MD, cancel)
    em, buf = _emitter()

    res = run_update(
        git_repo,
        "m",
        prov,
        em,
        _settings(),
        selections={"Biology/a.pdf": [PageRange(1, 4)]},
        cancel_file=cancel,
    )

    starts = [e for e in parse_lines(buf.getvalue()) if e["type"] == "stage" and e.get("stage") == "generate" and e.get("status") == "start"]
    assert [e["action"] for e in starts] == ["regenerate"]
    assert res.processed == 0
    assert "cancelled" in _event_types(buf)
    assert digest.read_bytes() == original
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert (course / "arbor-course.json").read_bytes() == manifest_before
    assert _git_out(git_repo, "rev-parse", "HEAD") == head
    assert _status(git_repo) == [" M Biology/a.pdf"]


# ---- An ordinary failure rolls the source back like a cancel does (council C1) ----


class FailOnSecondCallFor(PromptMarkedFake):
    """Digests every call, but raises ProviderError on the second one naming `needle`."""

    def __init__(self, markdown: str, needle: str):
        super().__init__(markdown)
        self._needle = needle
        self._seen = 0

    def run(self, request):
        if self._needle in request.prompt and SYNTHESIS_MARK not in request.prompt:
            self._seen += 1
            if self._seen == 2:
                self.calls.append(request)
                raise ProviderError("provider fell over on the second range")
        return super().run(request)


def test_failed_multi_range_source_leaves_no_digest_no_record_and_is_retried(
    git_repo: Path, make_pdf
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a.pdf", pages=6)
    head = _git_out(git_repo, "rev-parse", "HEAD")
    em, buf = _emitter()

    res = run_update(
        git_repo, "m", FailOnSecondCallFor(GOOD_MD, "a.pdf"), em, _settings(),
        selections={"Biology/a.pdf": [PageRange(1, 2), PageRange(4, 5)]},
    )

    assert res.processed == 0 and res.failed == 1
    assert "source_failed" in _event_types(buf)
    assert not (course / "digests").exists() or not list((course / "digests").glob("*.md"))
    assert not (course / "arbor-course.json").exists()
    assert _git_out(git_repo, "rev-parse", "HEAD") == head
    assert _status(git_repo) == ["?? Biology/a.pdf"]

    retry = run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())

    assert retry.processed == 1 and retry.failed == 0
    assert len(list((course / "digests").glob("*.md"))) == 1


def test_failed_source_next_to_a_good_one_keeps_only_the_good_records(
    git_repo: Path, make_pdf
):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "a_good.pdf", pages=1)
    make_pdf(course / "b_bad.pdf", pages=6)
    em, buf = _emitter()

    res = run_update(
        git_repo, "m", FailOnSecondCallFor(GOOD_MD, "b_bad.pdf"), em, _settings(),
        selections={
            "Biology/a_good.pdf": None,
            "Biology/b_bad.pdf": [PageRange(1, 2), PageRange(4, 5)],
        },
    )

    assert res.processed == 1 and res.failed == 1
    assert [r["source_path"] for r in _manifest(course)["records"]] == ["Biology/a_good.pdf"]
    assert "Biology/b_bad.pdf" not in _manifest(course).get("sources", {})
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert _status(git_repo) == ["?? Biology/b_bad.pdf"]

    retry = run_update(git_repo, "m", PromptMarkedFake(GOOD_MD), EventEmitter(io.StringIO()), _settings())

    assert retry.processed == 1 and retry.failed == 0
    assert len(list((course / "digests").glob("*.md"))) == 2
    assert sorted(r["source_path"] for r in _manifest(course)["records"]) == [
        "Biology/a_good.pdf", "Biology/b_bad.pdf",
    ]


# ---- A cancel that skipped course synthesis is redone by the next Update (council C4) ----


def _flag_in_head(root: Path) -> bool:
    committed = json.loads(_git_out(root, "show", "HEAD:Biology/arbor-course.json"))
    return committed.get("synthesis_pending", False)


def _synthesis_calls(prov) -> int:
    return sum(SYNTHESIS_MARK in c.prompt for c in prov.calls)


def _cancel_during_synthesis(git_repo: Path, make_pdf, tmp_path: Path, settings=None) -> Path:
    course = _seed_digested_class(git_repo, make_pdf)
    make_pdf(course / "a.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: SYNTHESIS_MARK in r.prompt)
    _cancel_when_blocked(prov, cancel)
    run_update(
        git_repo, "m", prov, EventEmitter(io.StringIO()), settings or _settings(),
        cancel_file=cancel,
    )
    cancel.unlink()
    return course


def test_cancel_during_synthesis_then_update_again_rebuilds_the_notebook(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = _cancel_during_synthesis(git_repo, make_pdf, tmp_path)
    assert (course / "course.md").read_text() == SEEDED_COURSE_MD
    assert _flag_in_head(git_repo) is True
    assert _status(git_repo) == []

    prov = PromptMarkedFake(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, _settings(), cancel_file=tmp_path / "cancel.flag")

    types = _event_types(buf)
    assert _synthesis_calls(prov) == 1
    assert "nothing_to_process" not in types and "course_synthesis_done" in types
    assert res.failed == 0 and res.commit is not None
    assert (course / "course.md").read_text().startswith("# Lecture")
    assert "synthesis_pending" not in _manifest(course)
    assert _status(git_repo) == []
    assert "Biology/course.md" in _git_out(git_repo, "show", "--name-only", "--format=", "HEAD")

    third = PromptMarkedFake(GOOD_MD)
    em3, buf3 = _emitter()
    run_update(git_repo, "m", third, em3, _settings())
    assert "nothing_to_process" in _event_types(buf3) and third.calls == []


def test_cancel_between_sources_flags_the_course_and_the_next_update_synthesizes(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = _seed_digested_class(git_repo, make_pdf)
    make_pdf(course / "a.pdf", pages=1)
    make_pdf(course / "b.pdf", pages=1)
    cancel = tmp_path / "cancel.flag"
    run_update(
        git_repo, "m", CancelAfterFirstDigest(GOOD_MD, cancel), EventEmitter(io.StringIO()),
        _settings(), cancel_file=cancel,
    )
    cancel.unlink()
    assert _flag_in_head(git_repo) is True
    # The user drops the unprocessed file: nothing is left to digest, only the notebook.
    (course / "b.pdf").unlink()

    prov = PromptMarkedFake(GOOD_MD)
    run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), _settings())

    assert _synthesis_calls(prov) == 1
    assert (course / "course.md").read_text() != SEEDED_COURSE_MD
    assert "synthesis_pending" not in _manifest(course)


def test_pending_synthesis_is_redone_after_sources_were_deleted_on_digest(
    git_repo: Path, make_pdf, tmp_path: Path
):
    settings = dataclasses.replace(_settings(), delete_sources_after_digest=True)
    course = _cancel_during_synthesis(git_repo, make_pdf, tmp_path, settings)
    (course / "old.pdf").unlink()  # the seed helper keeps its source; a.pdf was deleted on digest
    assert not list(course.glob("*.pdf"))
    assert build_plan(git_repo, settings).pending == []

    prov = PromptMarkedFake(GOOD_MD)
    run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), settings)

    assert _synthesis_calls(prov) == 1
    assert (course / "course.md").read_text().startswith("# Lecture")


def test_failed_redo_keeps_the_old_notebook_and_stays_pending(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = _cancel_during_synthesis(git_repo, make_pdf, tmp_path)
    head = _git_out(git_repo, "rev-parse", "HEAD")

    em, buf = _emitter()
    run_update(git_repo, "m", FakeProvider("too short"), em, _settings())

    assert "course_synthesis_failed" in _event_types(buf)
    assert (course / "course.md").read_text() == SEEDED_COURSE_MD
    assert _git_out(git_repo, "rev-parse", "HEAD") == head
    assert _manifest(course)["synthesis_pending"] is True

    prov = PromptMarkedFake(GOOD_MD)
    run_update(git_repo, "m", prov, EventEmitter(io.StringIO()), _settings())
    assert _synthesis_calls(prov) == 1
    assert "synthesis_pending" not in _manifest(course)


def test_cancelled_redo_changes_nothing_and_stays_pending(
    git_repo: Path, make_pdf, tmp_path: Path
):
    course = _cancel_during_synthesis(git_repo, make_pdf, tmp_path)
    head = _git_out(git_repo, "rev-parse", "HEAD")
    cancel = tmp_path / "cancel.flag"
    prov = PromptMarkedFake(GOOD_MD, block_when=lambda r: SYNTHESIS_MARK in r.prompt)
    _cancel_when_blocked(prov, cancel)
    em, buf = _emitter()

    run_update(git_repo, "m", prov, em, _settings(), cancel_file=cancel)

    assert "cancelled" in _event_types(buf) and "committed" not in _event_types(buf)
    assert _git_out(git_repo, "rev-parse", "HEAD") == head
    assert (course / "course.md").read_text() == SEEDED_COURSE_MD
    assert _manifest(course)["synthesis_pending"] is True


def _digest_record(**over) -> DigestRecord:
    base = dict(
        source_path="Bio/mega.pdf",
        source_hash="hash-1",
        page_count=2,
        start_page=1,
        end_page=2,
        digest_file="digests/2026-08-12.md",
        model_id="m",
        processing_path="pdf_images",
        generate_mode="single",
        chunk_count=None,
        digested_at="2026-08-12T00:00:00+00:00",
    )
    base.update(over)
    return DigestRecord(**base)


def test_manifest_restore_returns_it_to_its_snapshot(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    m.record(_digest_record())
    snap = m.snapshot()

    m.record(_digest_record(digest_file="digests/2026-08-13.md"))
    m.set_source(
        "Bio/mega.pdf",
        SourceFingerprintState(
            source_hash="hash-1",
            page_count=2,
            fingerprint_kind="pdf_image",
            page_fingerprints=["a", "b"],
            updated_at="2026-08-12T00:00:00+00:00",
        ),
    )
    m.restore(snap)

    assert [r["digest_file"] for r in m.records()] == ["digests/2026-08-12.md"]
    assert m.sources() == {}
    assert m.data.get("version") == 1


def test_manifest_snapshot_is_independent_of_later_changes(tmp_path: Path):
    m = CourseManifest.load(tmp_path)
    snap = m.snapshot()
    m.record(_digest_record())
    assert snap["records"] == []
    m.restore(snap)
    m.record(_digest_record(digest_file="digests/other.md"))
    assert snap["records"] == []
