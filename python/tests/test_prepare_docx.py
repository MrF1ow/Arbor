from pathlib import Path

from arbor_worker.prepare.docx import docx_page_count, extract_docx_text
from arbor_worker.probe import count_pages
from arbor_worker.sources import classify
from tests.docx_helpers import make_docx


def test_classify_docx():
    assert classify(Path("notes.docx")) == "docx"


def test_extract_docx_text(tmp_path: Path):
    src = make_docx(tmp_path / "a.docx", ["Hello world", "Second paragraph"])
    text = extract_docx_text(src)
    assert "Hello world" in text
    assert "Second paragraph" in text


def test_docx_page_count(tmp_path: Path):
    src = make_docx(tmp_path / "a.docx", ["One", "Two", "Three"])
    assert docx_page_count(src) == 3
    assert count_pages(src, "docx") == 3
