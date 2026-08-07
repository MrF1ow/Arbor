import dataclasses
import io
from pathlib import Path

from arbor_worker.events import EventEmitter, parse_lines
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.settings import default_settings
from arbor_worker.pipeline import run_update

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


def test_git_state_error_emits_run_done(tmp_path: Path):
    em, buf = _emitter()
    res = run_update(tmp_path, "m", FakeProvider(GOOD_MD), em, default_settings())
    assert res.processed == 0 and res.commit is None
    events = parse_lines(buf.getvalue())
    assert events[0]["type"] == "run_started"
    assert any(e["type"] == "error" for e in events)
    assert any(e["type"] == "run_done" for e in events)
    assert events[-1]["type"] == "run_done"


def test_write_failure_removes_lecture_md(git_repo: Path, make_pdf, monkeypatch):
    from arbor_worker import pipeline as pipeline_mod

    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)

    def fail_metadata(meta, dest):
        raise OSError("disk full")

    monkeypatch.setattr(pipeline_mod, "write_metadata", fail_metadata)
    em, buf = _emitter()
    res = run_update(git_repo, "m", FakeProvider(GOOD_MD), em, default_settings())
    assert res.failed == 1
    assert not (d / "lecture.md").exists()
    assert not (d / "metadata.json").exists()
    events = parse_lines(buf.getvalue())
    assert any(e["type"] == "lecture_failed" and e["stage"] == "write" for e in events)


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


def test_pptx_images_fallback_uses_chunked(git_repo: Path, make_pptx, monkeypatch):
    from arbor_worker import pipeline as pipeline_mod
    from arbor_worker.prepare import PrepareResult

    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pptx(d / "source.pptx", ["hi"])

    cache_imgs_dir = git_repo / "_arbor_cache" / "stub"
    cache_imgs_dir.mkdir(parents=True)
    images = []
    for i in range(5):
        p = cache_imgs_dir / f"page-{i + 1:05d}.png"
        p.write_bytes(b"\x89PNG")
        images.append(p)

    def stub_prepare(*_args, **_kwargs):
        return PrepareResult(
            "pptx_images_fallback",
            image_paths=images,
            text=None,
            detail={"page_count": len(images)},
        )

    monkeypatch.setattr(pipeline_mod, "prepare_source", stub_prepare)
    prov = FakeProvider(GOOD_MD)
    em, buf = _emitter()
    res = run_update(git_repo, "m", prov, em, _chunk_settings())
    assert res.processed == 1 and res.failed == 0
    meta = (d / "metadata.json").read_text()
    assert '"generate_mode": "chunked"' in meta
    assert '"processing_path": "pptx_images_fallback"' in meta
    types = [e["type"] for e in parse_lines(buf.getvalue())]
    assert types.count("chunk_done") == 3
    assert "synthesis_done" in types


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
