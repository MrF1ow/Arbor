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
