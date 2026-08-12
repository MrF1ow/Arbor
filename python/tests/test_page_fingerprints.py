from pathlib import Path
from unittest.mock import patch

import pytest

from arbor_worker.page_fingerprints import fingerprint_pdf, fingerprint_pptx, fingerprint_source
from arbor_worker.settings import default_settings


def test_pdf_fingerprints_stable(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "deck.pdf", pages=3, text="Lecture")
    first = fingerprint_pdf(src)
    second = fingerprint_pdf(src)
    assert first.kind == "pdf_image"
    assert first.fingerprints == second.fingerprints
    assert len(first.fingerprints) == 3


def test_pdf_fingerprint_changes_only_edited_page(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "deck.pdf", pages=3, text="Lecture")
    before = fingerprint_pdf(src).fingerprints

    import fitz

    doc = fitz.open(str(src))
    page = doc.load_page(1)
    page.insert_text((72, 144), "EDITED")
    edited = tmp_path / "deck-edited.pdf"
    doc.save(str(edited))
    doc.close()
    src = edited

    after = fingerprint_pdf(src).fingerprints
    assert after[0] == before[0]
    assert after[1] != before[1]
    assert after[2] == before[2]


def test_pptx_text_rich_kind(make_pptx, tmp_path: Path):
    body = "The nervous system coordinates body activities. " * 10
    src = make_pptx(tmp_path / "rich.pptx", [body, "Second slide with more text here"])
    result = fingerprint_pptx(src, default_settings())
    assert result.kind == "pptx_text"
    assert len(result.fingerprints) == 2
    assert len(result.fingerprints[0]) == 64


def test_pptx_thin_text_uses_image_kind(make_pptx, tmp_path: Path, make_pdf):
    src = make_pptx(tmp_path / "thin.pptx", ["hi"])
    settings = default_settings()
    fake_pdf = make_pdf(tmp_path / "converted.pdf", pages=1)

    with patch(
        "arbor_worker.page_fingerprints.convert_pptx_to_pdf",
        return_value=fake_pdf,
    ):
        result = fingerprint_pptx(src, settings)

    assert result.kind == "pptx_image"
    assert len(result.fingerprints) == 1


def test_fingerprint_source_dispatches_pdf(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=2)
    result = fingerprint_source(src, "pdf")
    assert result.kind == "pdf_image"
    assert len(result.fingerprints) == 2
