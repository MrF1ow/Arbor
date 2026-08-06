from pathlib import Path

import pytest

from arbor_worker.prepare import PrepareError
from arbor_worker.prepare.pdf import render_pdf_to_images


def test_renders_all_pages(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "s.pdf", pages=3)
    out = tmp_path / "cache"
    out.mkdir()
    images = render_pdf_to_images(src, out, dpi=100)
    assert len(images) == 3
    assert all(p.suffix == ".png" and p.stat().st_size > 0 for p in images)
    assert images == sorted(images)


def test_raises_on_zero_pages(tmp_path: Path):
    src = tmp_path / "empty.pdf"
    # PyMuPDF 1.28+ cannot save zero-page documents; write minimal PDF directly.
    src.write_bytes(
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
        b"xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n00000000058 00000 n \n"
        b"trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n109\n%%EOF\n"
    )
    out = tmp_path / "cache"
    out.mkdir()
    with pytest.raises(PrepareError):
        render_pdf_to_images(src, out, dpi=100)
