from pathlib import Path

import pytest

from arbor_worker.cache import CacheDir
from arbor_worker.hashing import hash_file
from arbor_worker.settings import default_settings
from arbor_worker.prepare import prepare_source, PrepareError
from arbor_worker.prepare.pptx import extract_pptx_text


def _prep(source, source_type, tmp_path, **overrides):
    settings = default_settings()
    for k, v in overrides.items():
        object.__setattr__(settings, k, v)
    cache = CacheDir(tmp_path, settings.cache_dir_name)
    return prepare_source(source, source_type, hash_file(source), cache, settings)


def test_extract_text_from_pptx(make_pptx, tmp_path: Path):
    src = make_pptx(tmp_path / "s.pptx", ["Mitochondria is the powerhouse", "Cells divide"])
    text = extract_pptx_text(src)
    assert "Mitochondria" in text and "Cells divide" in text


def test_pptx_text_path_when_enough_text(make_pptx, tmp_path: Path):
    body = "The nervous system coordinates body activities. " * 10
    src = make_pptx(tmp_path / "s.pptx", [body])
    res = _prep(src, "pptx", tmp_path)
    assert res.processing_path == "pptx_text"
    assert res.text and "nervous system" in res.text
    assert res.image_paths == []


def test_pptx_thin_text_triggers_fallback_or_clear_error(make_pptx, tmp_path: Path):
    src = make_pptx(tmp_path / "s.pptx", ["hi"])  # below threshold
    # If soffice is unavailable in CI, prepare must raise a clear PrepareError.
    try:
        res = _prep(src, "pptx", tmp_path, pptx_min_chars=200)
    except PrepareError as e:
        assert "libreoffice" in str(e).lower() or "soffice" in str(e).lower()
        return
    assert res.processing_path == "pptx_images_fallback"
    assert len(res.image_paths) >= 1


def test_pdf_routes_to_images(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=2)
    res = _prep(src, "pdf", tmp_path)
    assert res.processing_path == "pdf_images"
    assert len(res.image_paths) == 2


def test_resume_reuses_cache(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=2)
    r1 = _prep(src, "pdf", tmp_path)
    mtimes = {p: p.stat().st_mtime_ns for p in r1.image_paths}
    r2 = _prep(src, "pdf", tmp_path)
    assert r2.image_paths == r1.image_paths
    # not re-rendered
    assert all(p.stat().st_mtime_ns == mtimes[p] for p in r2.image_paths)
