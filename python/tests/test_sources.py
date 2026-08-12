from pathlib import Path

from arbor_worker.sources import classify


def test_classify_extensions():
    assert classify(Path("a/b.pdf")) == "pdf"
    assert classify(Path("a/b.PPTX")) == "pptx"
    assert classify(Path("a/b.md")) is None
    assert classify(Path("a/course.md")) is None
