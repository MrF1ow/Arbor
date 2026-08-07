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
