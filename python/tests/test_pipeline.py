import dataclasses
import io
import json
from pathlib import Path

from arbor_worker.alignment import PageRange
from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.pipeline import run_update
from arbor_worker.planning import build_plan
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings
from prompt_marked_fake import PromptMarkedFake

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
