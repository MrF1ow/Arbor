from pathlib import Path

import pytest

from arbor_worker.gitstate import GitStateError, commit_batch


def test_commit_batch_only_named_paths(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "course.md").write_text("# digest\n")
    commit = commit_batch(
        git_repo,
        [Path("Bio/source.pdf"), Path("Bio/course.md")],
        "digest: Bio",
    )
    assert commit
    assert g("log", "-1", "--pretty=%s").strip() == "digest: Bio"


def test_commit_batch_rejects_empty_path_list(git_repo: Path):
    with pytest.raises(GitStateError):
        commit_batch(git_repo, [], "digest: nothing")
