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
