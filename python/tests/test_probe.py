from pathlib import Path

import pytest

from arbor_worker.errors import ProbeError
from arbor_worker.probe import count_pages


def test_count_pages_pdf(tmp_path: Path, make_pdf):
    pdf = make_pdf(tmp_path / "a.pdf", pages=3)
    assert count_pages(pdf, "pdf") == 3


def test_count_pages_pptx(tmp_path: Path, make_pptx):
    pptx = make_pptx(tmp_path / "a.pptx", ["one", "two"])
    assert count_pages(pptx, "pptx") == 2


def test_count_pages_unsupported_type(tmp_path: Path):
    with pytest.raises(ProbeError):
        count_pages(tmp_path / "a.txt", "txt")
