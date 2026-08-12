import dataclasses
import io
import json
from pathlib import Path

from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.pipeline import run_update
from arbor_worker.planning import build_plan
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
    assert digests[0].read_text().count("arbor-pages") >= 2
    assert "# Lecture" in digests[0].read_text()
    assert (course / "course.md").read_text().startswith("# Lecture")
    record = _manifest(course)["records"][0]
    assert record["source_path"] == "Biology/mega.pdf"
    assert record["model_id"] == "gpt-5.6-sol"
    assert record["processing_path"] == "pdf_images"
    assert record["start_page"] == 1
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


def test_ranges_limit_pages_sent_to_provider(git_repo: Path, make_pdf):
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
        selections={"Biology/mega.pdf": [[3, 4]]},
    )

    assert res.processed == 1
    digest_call = prov.calls[0]
    assert len(digest_call.image_paths) == 2
    assert "arbor-pages:3-4" in digest_call.prompt
    assert _manifest(course)["records"][0]["start_page"] == 3
    assert _manifest(course)["records"][0]["end_page"] == 4


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
        selections={"Biology/mega.pdf": [[3, 5]]},
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


def test_delete_sources_when_config_enabled(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    pdf = make_pdf(course / "mega.pdf", pages=1)
    settings = dataclasses.replace(default_settings(), delete_sources_after_digest=True)

    res = run_update(
        git_repo, "m", FakeProvider(GOOD_MD), EventEmitter(io.StringIO()), settings
    )

    assert res.processed == 1 and res.failed == 0
    assert not pdf.exists()
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert (course / "course.md").is_file()


def test_delete_sources_keeps_fingerprints(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    pdf = make_pdf(course / "mega.pdf", pages=1)
    settings = dataclasses.replace(default_settings(), delete_sources_after_digest=True)

    res = run_update(
        git_repo, "m", FakeProvider(GOOD_MD), EventEmitter(io.StringIO()), settings
    )

    assert res.processed == 1
    assert not pdf.exists()
    manifest = _manifest(course)
    assert manifest["version"] == 2
    assert "Biology/mega.pdf" in manifest["sources"]
    assert len(manifest["sources"]["Biology/mega.pdf"]["page_fingerprints"]) == 1


def test_course_synthesis_failure_leaves_sources_pending(git_repo: Path, make_pdf):
    course = git_repo / "Biology"
    course.mkdir()
    make_pdf(course / "mega.pdf", pages=1)

    class SynthesisFailProvider(FakeProvider):
        def run(self, request):
            self.calls.append(request)
            from arbor_worker.provider.base import ProviderResult

            if "assembling the single study notebook" in request.prompt:
                raise RuntimeError("synthesis exploded")
            return ProviderResult(markdown=GOOD_MD)

    em, buf = _emitter()
    res = run_update(git_repo, "m", SynthesisFailProvider(GOOD_MD), em, default_settings())

    assert res.processed == 1
    assert len(list((course / "digests").glob("*.md"))) == 1
    assert not (course / "arbor-course.json").exists()
    assert not (course / "course.md").exists()
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "course_synthesis_failed" for e in events)
    assert not any(e["type"] == "committed" for e in events)

    plan = build_plan(git_repo, default_settings())
    assert [p.path for p in plan.pending] == ["Biology/mega.pdf"]
