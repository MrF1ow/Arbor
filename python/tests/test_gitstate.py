import subprocess
from pathlib import Path

import pytest

from arbor_worker.gitstate import (
    FALLBACK_IDENTITY_NOTICE,
    GitStateError,
    commit_and_note,
    commit_batch,
)


def _isolated_git_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    xdg = tmp_path / "xdg"
    xdg.mkdir()
    global_cfg = tmp_path / "global.gitconfig"
    global_cfg.write_text("")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(global_cfg))
    _clear_git_identity_env(monkeypatch)
    return global_cfg


def _clear_git_identity_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ):
        monkeypatch.delenv(key, raising=False)


def test_commit_batch_only_named_paths(git_repo: Path, make_pdf, git):
    g = git(git_repo)
    d = git_repo / "Bio"
    d.mkdir(parents=True)
    make_pdf(d / "source.pdf", pages=1)
    (d / "course.md").write_text("# digest\n")
    result = commit_batch(
        git_repo,
        [Path("Bio/source.pdf"), Path("Bio/course.md")],
        "digest: Bio",
    )
    assert result.rev
    assert result.notice is None
    assert g("log", "-1", "--pretty=%s").strip() == "digest: Bio"


def test_commit_batch_rejects_empty_path_list(git_repo: Path):
    with pytest.raises(GitStateError):
        commit_batch(git_repo, [], "digest: nothing")


def test_commit_batch_fallback_without_user_email(tmp_path: Path, monkeypatch):
    global_cfg = _isolated_git_env(monkeypatch, tmp_path)
    assert global_cfg.read_text() == ""

    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "note.txt").write_text("hello\n")

    result = commit_batch(root, [Path("note.txt")], "digest: fallback")

    assert result.notice == FALLBACK_IDENTITY_NOTICE
    author = subprocess.run(
        ["git", "-C", str(root), "log", "-1", "--format=%an <%ae>"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert author == "Arbor <arbor@localhost>"
    email = subprocess.run(
        ["git", "-C", str(root), "config", "--get", "user.email"],
        capture_output=True,
        text=True,
    )
    assert email.returncode != 0 or not (email.stdout or "").strip()


def test_commit_batch_keeps_env_git_identity_without_config_email(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    global_cfg = _isolated_git_env(monkeypatch, tmp_path)
    assert global_cfg.read_text() == ""

    monkeypatch.setenv("GIT_AUTHOR_NAME", "CI Bot")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "ci@example.test")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "CI Bot")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "ci@example.test")

    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "note.txt").write_text("hello\n")

    result = commit_batch(root, [Path("note.txt")], "digest: env identity")

    assert result.notice is None
    author = subprocess.run(
        ["git", "-C", str(root), "log", "-1", "--format=%an <%ae>"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert author == "CI Bot <ci@example.test>"


def test_commit_batch_keeps_configured_local_email(
    git_repo: Path, monkeypatch: pytest.MonkeyPatch
):
    _clear_git_identity_env(monkeypatch)
    (git_repo / "extra.txt").write_text("x\n")
    result = commit_batch(git_repo, [Path("extra.txt")], "digest: local identity")
    assert result.notice is None
    author = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--format=%an <%ae>"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert author == "Arbor Test <test@arbor.local>"


def test_commit_batch_keeps_effective_global_email(tmp_path: Path, monkeypatch):
    global_cfg = _isolated_git_env(monkeypatch, tmp_path)
    global_cfg.write_text(
        "[user]\n\tname = Global Arbor\n\temail = global@arbor.test\n"
    )

    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "note.txt").write_text("hello\n")

    result = commit_batch(root, [Path("note.txt")], "digest: global")

    assert result.notice is None
    author = subprocess.run(
        ["git", "-C", str(root), "log", "-1", "--format=%an <%ae>"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert author == "Global Arbor <global@arbor.test>"


class _RecordingEmitter:
    def __init__(self) -> None:
        self.warnings: list[dict] = []

    def warning(self, **fields):
        self.warnings.append(fields)


def test_commit_and_note_emits_warning_when_fallback_used(tmp_path: Path, monkeypatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    (root / "note.txt").write_text("hello\n")

    emitter = _RecordingEmitter()
    rev = commit_and_note(root, [Path("note.txt")], "digest: warn", emitter)

    assert rev
    assert emitter.warnings == [{"message": FALLBACK_IDENTITY_NOTICE}]
