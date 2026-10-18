from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import effective_git_email
from arbor_worker.library import (
    LIBRARY_REL,
    LibraryError,
    create_shared_library,
    join_library,
    load_library,
)
from arbor_worker.sync import migrate_derived_files, set_remote, sync_pull_strategy


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


def _init_work_repo(tmp_path: Path, email: str | None = None) -> Path:
    root = tmp_path / "work"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    if email is not None:
        _run_git(root, "config", "user.email", email)
        _run_git(root, "config", "user.name", "Test")
    (root / "README.md").write_text("init\n")
    _run_git(root, "add", "README.md")
    if email is not None:
        _run_git(root, "commit", "-m", "init")
    else:
        subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "user.name=Arbor",
                "-c",
                "user.email=arbor@localhost",
                "commit",
                "-m",
                "init",
            ],
            check=True,
        )
    return root


def _bare_with_library(tmp_path: Path, lib_name: str = "SharedLib") -> Path:
    bare = tmp_path / "lib.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", "-q", str(bare), str(seed)], check=True)
    _run_git(seed, "config", "user.email", "owner@test.local")
    _run_git(seed, "config", "user.name", "Owner")
    lib_dir = seed / ".arbor"
    lib_dir.mkdir()
    doc = {
        "name": lib_name,
        "members": ["owner@test.local"],
        "created_by": "owner@test.local",
    }
    (lib_dir / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    _run_git(seed, "add", ".arbor/library.json")
    _run_git(seed, "commit", "-m", "library")
    _run_git(seed, "push", "-u", "origin", "HEAD")
    return bare


def test_effective_git_email_isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = tmp_path / "bare-email"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    assert effective_git_email(root) == "arbor@localhost"
    _run_git(root, "config", "user.email", "ada@example.com")
    assert effective_git_email(root) == "ada@example.com"


def test_create_without_remote_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    with pytest.raises(LibraryError, match="Arbor remote"):
        create_shared_library(root)
    assert not (root / LIBRARY_REL).exists()


def test_create_with_remote_writes_and_commits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    doc = create_shared_library(root, name="Botany")
    assert doc == {
        "name": "Botany",
        "members": ["ada@example.com"],
        "created_by": "ada@example.com",
    }
    assert load_library(root) == doc
    tracked = _run_git(root, "ls-files").stdout
    assert ".arbor/library.json" in tracked
    ignore = subprocess.run(
        ["git", "-C", str(root), "check-ignore", ".arbor/library.json"],
        capture_output=True,
        text=True,
    )
    assert ignore.returncode != 0
    sync_json = json.loads((root / ".arbor/sync.json").read_text())
    assert sync_json.get("shared") is True


def test_create_does_not_commit_hand_staged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    (root / "unrelated.txt").write_text("x\n")
    _run_git(root, "add", "unrelated.txt")
    create_shared_library(root)
    show = _run_git(root, "show", "--name-only", "--pretty=format:").stdout
    assert "library.json" in show
    assert "unrelated.txt" not in show
    status = _run_git(root, "status", "--porcelain").stdout
    assert status.startswith("A  unrelated.txt")


def test_create_fallback_email_commits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email=None)
    set_remote(root, str(bare))
    doc = create_shared_library(root)
    assert doc["created_by"] == "arbor@localhost"
    assert doc["members"] == ["arbor@localhost"]
    assert _run_git(root, "rev-parse", "HEAD").returncode == 0


def test_create_again_no_extra_commit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    first = create_shared_library(root, name="Botany")
    count = _run_git(root, "rev-list", "--count", "HEAD").stdout.strip()
    second = create_shared_library(root, name="Ignored")
    assert second == first
    assert _run_git(root, "rev-list", "--count", "HEAD").stdout.strip() == count


def test_library_json_not_ignored_after_migrate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    root = _init_work_repo(tmp_path, email="ada@example.com")
    set_remote(root, str(bare))
    create_shared_library(root)
    migrate_derived_files(root)
    ignore = subprocess.run(
        ["git", "-C", str(root), "check-ignore", ".arbor/library.json"],
        capture_output=True,
        text=True,
    )
    assert ignore.returncode != 0


def test_sync_pull_strategy_library_json(tmp_path: Path):
    root = tmp_path / "root"
    root.mkdir()
    lib = root / ".arbor"
    lib.mkdir()
    doc = {
        "name": "Lib",
        "members": ["a@test.local"],
        "created_by": "a@test.local",
    }
    (lib / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    assert sync_pull_strategy(root) == "merge"
    plain = tmp_path / "plain"
    plain.mkdir()
    assert sync_pull_strategy(plain) == "rebase"


def test_join_into_missing_dest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path, "Botany")
    dest = tmp_path / "joined"
    result = join_library(str(bare), dest)
    assert result["kind"] == "shared"
    assert result["name"] == "Botany"
    assert (dest / LIBRARY_REL).is_file()
    remotes = _run_git(dest, "remote").stdout.splitlines()
    assert "arbor" in remotes


def test_join_nonempty_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path)
    dest = tmp_path / "occupied"
    dest.mkdir()
    (dest / "existing.txt").write_text("stay\n")
    with pytest.raises(LibraryError, match="not empty"):
        join_library(str(bare), dest)
    assert not (dest / ".git").exists()
    assert (dest / "existing.txt").read_text() == "stay\n"


def test_join_missing_library_json_cleanup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = tmp_path / "plain.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", "-q", str(bare), str(seed)], check=True)
    _run_git(seed, "config", "user.email", "a@test.local")
    _run_git(seed, "config", "user.name", "A")
    (seed / "note.md").write_text("x\n")
    _run_git(seed, "add", "note.md")
    _run_git(seed, "commit", "-m", "init")
    _run_git(seed, "push", "-u", "origin", "HEAD")
    dest = tmp_path / "fail-join"
    with pytest.raises(LibraryError, match="library.json"):
        join_library(str(bare), dest)
    assert not dest.exists()


def test_join_refuses_embedded_password(tmp_path: Path):
    dest = tmp_path / "never"
    with pytest.raises(LibraryError, match="embedded password"):
        join_library("https://user:secret@example.com/lib.git", dest)
    assert not dest.exists()


def test_cli_library_create_join(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    _isolated_git_env(monkeypatch, tmp_path)
    bare = _bare_with_library(tmp_path, "CLI Lib")
    root = _init_work_repo(tmp_path, email="cli@test.local")
    set_remote(root, str(bare))
    code = cli.main(["library-create", "--root", str(root), "--name", "CLI Lib"])
    assert code == 0
    out = capsys.readouterr().out
    assert json.loads(out)["name"] == "CLI Lib"
    dest = tmp_path / "cli-dest"
    code = cli.main(["library-join", "--url", str(bare), "--dest", str(dest)])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["kind"] == "shared"
