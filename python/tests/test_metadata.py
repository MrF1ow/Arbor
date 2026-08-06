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
