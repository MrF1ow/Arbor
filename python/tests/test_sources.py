from pathlib import Path

from arbor_worker.sources import classify, LectureSource


def test_classify_extensions():
    assert classify(Path("a/b.pdf")) == "pdf"
    assert classify(Path("a/b.PPTX")) == "pptx"
    assert classify(Path("a/b.md")) is None
    assert classify(Path("a/metadata.json")) is None


def test_lecture_source_dir_is_parent():
    rel = Path("Biology/Lecture 01/source.pdf")
    ls = LectureSource(path=rel, lecture_dir=rel.parent, source_type="pdf")
    assert ls.lecture_dir == Path("Biology/Lecture 01")
