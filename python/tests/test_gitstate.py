from pathlib import Path

import pytest

from arbor_worker.gitstate import (
    dirty_sources,
    validate_single_source_per_lecture,
    commit_batch,
    GitStateError,
)
from arbor_worker.sources import LectureSource


def test_untracked_and_modified_sources_detected(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    # committed, unchanged source -> should be skipped
    d1 = git_repo / "Bio" / "L1"
    d1.mkdir(parents=True)
    make_pdf(d1 / "source.pdf", pages=1)
    g("add", "Bio/L1/source.pdf")
    g("commit", "-q", "-m", "add L1")
    # new untracked source
    d2 = git_repo / "Bio" / "L2"
    d2.mkdir(parents=True)
    make_pdf(d2 / "slides.pdf", pages=1)
    # modify committed source
    make_pdf(d1 / "source.pdf", pages=2)

    found = {str(s.path) for s in dirty_sources(git_repo)}
    assert "Bio/L2/slides.pdf" in found
    assert "Bio/L1/source.pdf" in found


def test_digest_only_edits_do_not_count(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "lecture.md").write_text("# old")
    g("add", "-A")
    g("commit", "-q", "-m", "add")
    (d / "lecture.md").write_text("# edited by hand")
    found = {str(s.path) for s in dirty_sources(git_repo)}
    assert found == set()


def test_validate_single_source_per_lecture():
    a = LectureSource(Path("C/L/one.pdf"), Path("C/L"), "pdf")
    b = LectureSource(Path("C/L/two.pptx"), Path("C/L"), "pptx")
    with pytest.raises(GitStateError):
        validate_single_source_per_lecture([a, b])
    validate_single_source_per_lecture([a])  # ok


def test_commit_batch_only_named_paths(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio" / "L1"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "lecture.md").write_text("# digest\n")
    (d / "metadata.json").write_text("{}\n")
    commit = commit_batch(
        git_repo,
        [Path("Bio/L1/source.pdf"), Path("Bio/L1/lecture.md"), Path("Bio/L1/metadata.json")],
        "digest: Bio/L1",
    )
    assert commit
    log = g("log", "-1", "--pretty=%s")
    assert log.strip() == "digest: Bio/L1"


def test_dirty_sources_raises_outside_repo(tmp_path: Path):
    with pytest.raises(GitStateError):
        dirty_sources(tmp_path)
