from pathlib import Path

from arbor_worker.cache import CacheDir, ensure_gitignored


def test_for_hash_creates_dir(tmp_path: Path):
    c = CacheDir(tmp_path, "_arbor_cache")
    d = c.for_hash("abc123")
    assert d.is_dir()
    assert d == tmp_path / "_arbor_cache" / "abc123"


def test_marker_roundtrip(tmp_path: Path):
    c = CacheDir(tmp_path, "_arbor_cache")
    assert c.read_marker("h") is None
    c.write_marker("h", {"processing_path": "pdf_images", "page_count": 3})
    assert c.read_marker("h") == {"processing_path": "pdf_images", "page_count": 3}


def test_ensure_gitignored_appends_once(tmp_path: Path):
    ensure_gitignored(tmp_path, "_arbor_cache")
    ensure_gitignored(tmp_path, "_arbor_cache")
    content = (tmp_path / ".gitignore").read_text()
    assert content.count("_arbor_cache/") == 1


def test_ensure_gitignored_appends_extra_entries_once(tmp_path: Path):
    extras = [".arbor/progress/", ".arbor/vectors.sqlite"]

    ensure_gitignored(tmp_path, "_arbor_cache", extras)
    ensure_gitignored(tmp_path, "_arbor_cache", extras)

    content = (tmp_path / ".gitignore").read_text()
    assert content.count("_arbor_cache/") == 1
    assert content.count(".arbor/progress/") == 1
    assert content.count(".arbor/vectors.sqlite") == 1
