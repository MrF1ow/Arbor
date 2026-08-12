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
        "generate_mode", "chunk_count", "chunk_size", "page_ranges",
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
