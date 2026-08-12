from pathlib import Path

from arbor_worker.courses import CourseSource, discover_sources


def _discover(root: Path):
    return discover_sources(root, cache_dir_name="_arbor_cache", digests_dirname="digests")


def test_finds_sources_in_courses_including_nested(tmp_path: Path, make_pdf, make_pptx):
    (tmp_path / "Biology" / "readings").mkdir(parents=True)
    make_pdf(tmp_path / "Biology" / "mega.pdf", pages=1)
    make_pdf(tmp_path / "Biology" / "readings" / "chapter.pdf", pages=1)
    (tmp_path / "Chemistry").mkdir()
    make_pptx(tmp_path / "Chemistry" / "deck.pptx", ["one"])

    found = _discover(tmp_path)
    assert [str(s.path) for s in found] == [
        "Biology/mega.pdf",
        "Biology/readings/chapter.pdf",
        "Chemistry/deck.pptx",
    ]
    assert {str(s.course_dir) for s in found} == {"Biology", "Chemistry"}
    assert found[2].source_type == "pptx"


def test_ignores_root_files_cache_digests_and_dotdirs(tmp_path: Path, make_pdf):
    make_pdf(tmp_path / "loose.pdf", pages=1)
    (tmp_path / "_arbor_cache" / "abc").mkdir(parents=True)
    make_pdf(tmp_path / "_arbor_cache" / "abc" / "cached.pdf", pages=1)
    (tmp_path / ".arbor").mkdir()
    make_pdf(tmp_path / ".arbor" / "hidden.pdf", pages=1)
    (tmp_path / "Biology" / "digests").mkdir(parents=True)
    make_pdf(tmp_path / "Biology" / "digests" / "old.pdf", pages=1)
    make_pdf(tmp_path / "Biology" / "real.pdf", pages=1)

    found = _discover(tmp_path)
    assert [str(s.path) for s in found] == ["Biology/real.pdf"]


def test_ignores_non_source_extensions(tmp_path: Path, make_pdf):
    (tmp_path / "Biology").mkdir()
    make_pdf(tmp_path / "Biology" / "a.pdf", pages=1)
    (tmp_path / "Biology" / "course.md").write_text("# notes\n")
    (tmp_path / "Biology" / "arbor-course.json").write_text("{}")

    found = _discover(tmp_path)
    assert found == [CourseSource(Path("Biology/a.pdf"), Path("Biology"), "pdf")]
