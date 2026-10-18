from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import git_user_dirname
from arbor_worker.study_progress import (
    legacy_v41_progress_path,
    progress_path,
    study_progress_grade,
    study_progress_show,
)
from arbor_worker.sync import migrate_derived_files, set_remote, sync_root


def _run_git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _isolated_git_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
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
    for key in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ):
        monkeypatch.delenv(key, raising=False)


def _init_repo(tmp_path: Path, email: str | None, name: str = "Test") -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    if email is not None:
        _run_git(root, "config", "user.email", email)
        _run_git(root, "config", "user.name", name)
    (root / "README.md").write_text("init\n")
    (root / ".gitignore").write_text("_arbor_cache/\nprogress.json.bak\n")
    _run_git(root, "add", "README.md", ".gitignore")
    commit_args = ["git", "-C", str(root), "commit", "-m", "init"]
    if email is None:
        commit_args[3:3] = ["-c", "user.name=Arbor", "-c", "user.email=arbor@localhost"]
    subprocess.run(commit_args, check=True)
    return root


def _course_with_legacy_progress(root: Path, body: bytes) -> None:
    legacy = root / "Biology" / "study" / "progress.json"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(body)
    _run_git(root, "add", "Biology/study/progress.json")
    _run_git(root, "commit", "-m", "legacy progress")


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    import contextlib

    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def test_v41_progress_migration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_repo(tmp_path, "ada@example.com")
    doc = {
        "schema_version": 1,
        "course": "Biology",
        "cards": {"fc1": {"seen": 1, "correct": 0, "wrong": 1, "due_at": None, "interval_days": 0, "ease": 2.5}},
        "questions": {},
    }
    body = (json.dumps(doc, separators=(",", ":"), sort_keys=True) + "\n").encode()
    _course_with_legacy_progress(root, body)

    study_progress_show(root, "Biology")
    new_path = progress_path(root, "Biology")
    bak_path = root / "Biology" / "study" / "progress.json.bak"
    assert new_path.read_bytes() == body
    assert bak_path.read_bytes() == body
    assert not legacy_v41_progress_path(root, "Biology").exists()

    code, _, _ = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc1",
            "--result",
            "mastered",
        ]
    )
    assert code == 0
    tracked = _run_git(root, "ls-files").stdout.splitlines()
    rel = new_path.relative_to(root).as_posix()
    assert rel in tracked
    assert "Biology/study/progress.json" not in tracked
    assert "Biology/study/progress.json.bak" not in tracked
    assert _run_git(root, "check-ignore", "Biology/study/progress.json.bak", check=False).returncode == 0
    assert _run_git(root, "check-ignore", rel, check=False).returncode != 0


def test_two_users_independent_progress(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "shared.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)

    clone_a = tmp_path / "clone-a"
    clone_b = tmp_path / "clone-b"
    subprocess.run(["git", "clone", "-q", str(bare), str(clone_a)], check=True)
    subprocess.run(["git", "clone", "-q", str(bare), str(clone_b)], check=True)
    _run_git(clone_a, "config", "user.email", "a@example.com")
    _run_git(clone_a, "config", "user.name", "A")
    _run_git(clone_b, "config", "user.email", "b@example.com")
    _run_git(clone_b, "config", "user.name", "B")
    set_remote(clone_a, str(bare))
    set_remote(clone_b, str(bare))

    for root in (clone_a, clone_b):
        (root / "Biology" / "study").mkdir(parents=True)
        deck = {
            "schema_version": 1,
            "course": "Biology",
            "cards": [{"id": "fc_shared", "front": "Q", "back": "A"}],
        }
        (root / "Biology" / "study" / "flashcards.json").write_text(
            json.dumps(deck) + "\n", encoding="utf-8"
        )
        _run_git(root, "add", "Biology/study/flashcards.json")
        _run_git(root, "commit", "-m", "deck")

    sync_root(clone_a)

    code, _, _ = _run_cli(
        [
            "study-progress",
            "--root",
            str(clone_a),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_shared",
            "--result",
            "mastered",
        ]
    )
    assert code == 0
    sync_root(clone_a)
    sync_root(clone_b)

    path_a = progress_path(clone_a, "Biology")
    path_a_in_b = clone_b / ".arbor" / "users" / "a@example.com" / "Biology" / "progress.json"
    path_b = progress_path(clone_b, "Biology")

    assert path_a.is_file()
    assert path_a_in_b.is_file()
    assert json.loads(path_a_in_b.read_text(encoding="utf-8"))["cards"]["fc_shared"]["correct"] == 1
    assert not path_b.is_file()

    code, _, _ = _run_cli(
        [
            "study-progress",
            "--root",
            str(clone_b),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_shared",
            "--result",
            "again",
        ]
    )
    assert code == 0

    a_doc = json.loads(path_a.read_text(encoding="utf-8"))
    b_doc = json.loads(path_b.read_text(encoding="utf-8"))
    assert a_doc["cards"]["fc_shared"]["correct"] == 1
    assert b_doc["cards"]["fc_shared"]["correct"] == 0
    assert b_doc["cards"]["fc_shared"]["seen"] == 1

    sync_root(clone_b)
    sync_root(clone_a)
    a_doc_after = json.loads(path_a.read_text(encoding="utf-8"))
    assert a_doc_after["cards"]["fc_shared"]["correct"] == 1
    assert path_a != path_b


def test_library_json_stays_tracked_after_migrate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_repo(tmp_path, "ada@example.com")
    doc = {"name": "Lib", "members": ["ada@example.com"], "created_by": "ada@example.com"}
    lib_path = root / ".arbor" / "library.json"
    lib_path.parent.mkdir(parents=True, exist_ok=True)
    lib_path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    _run_git(root, "add", ".arbor/library.json")
    _run_git(root, "commit", "-m", "library")
    migrate_derived_files(root)
    tracked = _run_git(root, "ls-files").stdout.splitlines()
    assert ".arbor/library.json" in tracked
    assert _run_git(root, "check-ignore", ".arbor/library.json", check=False).returncode != 0
    chat = ".arbor/users/ada@example.com/chat/Biology.jsonl"
    (root / chat).parent.mkdir(parents=True, exist_ok=True)
    (root / chat).write_text('{"role":"user"}\n')
    assert _run_git(root, "check-ignore", chat, check=False).returncode == 0


def test_fallback_user_dir_without_email(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_repo(tmp_path, None)
    assert git_user_dirname(root) == "arbor@localhost"
    study_progress_grade(root, "Biology", "fc_x", "again")
    path = progress_path(root, "Biology")
    assert path.is_file()
    assert path.as_posix().endswith(".arbor/users/arbor@localhost/Biology/progress.json")


def test_unsafe_email_uses_fallback_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_repo(tmp_path, "ada@example.com")
    proc = _run_git(root, "config", "user.email", "bad/../email", check=False)
    if proc.returncode != 0:
        pytest.skip("git refused unsafe user.email")
    assert git_user_dirname(root) == "arbor@localhost"
    study_progress_grade(root, "Biology", "fc_safe", "again")
    path = progress_path(root, "Biology")
    assert "arbor@localhost" in path.as_posix()
    assert path.resolve().is_relative_to((root / ".arbor" / "users").resolve())
