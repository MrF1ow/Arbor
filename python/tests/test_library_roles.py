from __future__ import annotations

import io
import json
import contextlib
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.gitstate import commit_batch, git_user_dirname
from arbor_worker.library import (
    VIEWER_WRITE_DENIED,
    LibraryError,
    assert_can_write,
    current_role,
)
from arbor_worker.sync import GitSyncError, set_remote, sync_root


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


def _init_repo(tmp_path: Path, email: str, *, with_library: dict | None = None) -> Path:
    root = tmp_path / f"repo-{email.split('@')[0]}"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    _run_git(root, "config", "user.email", email)
    _run_git(root, "config", "user.name", "Test")
    (root / "README.md").write_text("init\n")
    _run_git(root, "add", "README.md")
    _run_git(root, "commit", "-m", "init")
    if with_library is not None:
        lib_dir = root / ".arbor"
        lib_dir.mkdir()
        (lib_dir / "library.json").write_text(json.dumps(with_library, indent=2) + "\n")
        _run_git(root, "add", ".arbor/library.json")
        _run_git(root, "commit", "-m", "library")
    return root


def _library_doc(
    *,
    owner: str,
    editor: str | None = None,
    viewer: str | None = None,
) -> dict:
    members = [{"email": owner, "role": "owner"}]
    if editor:
        members.append({"email": editor, "role": "editor"})
    if viewer:
        members.append({"email": viewer, "role": "viewer"})
    return {
        "name": "Shared",
        "created_by": owner,
        "members": members,
    }


def _run_cli(argv: list[str]) -> tuple[int, str, str]:
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def _commit_count(root: Path) -> int:
    proc = _run_git(root, "log", "--oneline", check=False)
    if proc.returncode != 0:
        return 0
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return len(lines)


def test_viewer_write_commands_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    viewer = "viewer@test.local"
    owner = "owner@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner=owner, viewer=viewer),
    )
    course = root / "Biology"
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "a.md").write_text("# Cells\n\nBody\n")
    commits_before = _commit_count(root)

    code, out, err = _run_cli(
        [
            "update",
            "--root",
            str(root),
            "--model",
            "x",
            "--provider",
            "fake",
        ]
    )
    assert code == 1
    assert "Viewers cannot run write jobs" in out or "Viewers cannot run write jobs" in err
    assert not (course / "study" / "plan.md").exists()
    assert _commit_count(root) == commits_before

    code, out, err = _run_cli(
        [
            "generate",
            "--root",
            str(root),
            "--course",
            "Biology",
            "--skill",
            "flashcards",
            "--provider",
            "fake",
            "--model",
            "x",
        ]
    )
    assert code == 1
    combined = out + err
    assert "Viewers cannot run write jobs" in combined
    assert not (course / "study" / "flashcards.json").exists()
    assert _commit_count(root) == commits_before

    code, out, err = _run_cli(
        [
            "study-plan",
            "--root",
            str(root),
            "--course",
            "Biology",
            "--provider",
            "fake",
            "--model",
            "x",
        ]
    )
    assert code == 1
    assert VIEWER_WRITE_DENIED in err
    assert not (course / "study" / "plan.md").exists()

    code, out, err = _run_cli(
        [
            "append-card",
            "--root",
            str(root),
            "--course",
            "Biology",
            "--front",
            "Q",
            "--back",
            "A",
            "--digest",
            "digests/a.md",
        ]
    )
    assert code == 1
    assert VIEWER_WRITE_DENIED in err
    assert not (course / "study" / "flashcards.json").exists()


def test_owner_update_not_viewer_denied(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    root = _init_repo(
        tmp_path,
        owner,
        with_library=_library_doc(owner=owner),
    )
    code, out, err = _run_cli(
        [
            "update",
            "--root",
            str(root),
            "--model",
            "x",
            "--provider",
            "fake",
        ]
    )
    combined = out + err
    assert VIEWER_WRITE_DENIED not in combined
    assert code != 1 or VIEWER_WRITE_DENIED not in combined


def test_assert_can_write_by_role(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    editor = "editor@test.local"
    viewer = "viewer@test.local"
    doc = _library_doc(owner=owner, editor=editor, viewer=viewer)

    editor_root = _init_repo(tmp_path, editor, with_library=doc)
    assert_can_write(editor_root)

    viewer_root = _init_repo(tmp_path, viewer, with_library=doc)
    with pytest.raises(LibraryError, match="viewer"):
        assert_can_write(viewer_root)


def test_no_library_unrestricted_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    root = _init_repo(tmp_path, "solo@test.local")
    assert_can_write(root)
    (root / "README.md").write_text("solo edit\n")
    result = commit_batch(root, [Path("README.md")], "readme")
    assert result.rev


def test_viewer_commit_batch_progress_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner=owner, viewer=viewer),
    )
    user_dir = git_user_dirname(root)
    progress_rel = Path(".arbor/users") / user_dir / "Biology" / "progress.json"
    progress_abs = root / progress_rel
    progress_abs.parent.mkdir(parents=True)
    progress_abs.write_text("{}\n")
    before = _commit_count(root)
    result = commit_batch(root, [progress_rel], "study: Biology progress")
    assert result.rev
    assert _commit_count(root) == before + 1
    assert _run_git(root, "ls-files", str(progress_rel)).stdout.strip() == str(progress_rel)

    (root / "README.md").write_text("blocked\n")
    head_before = _run_git(root, "rev-parse", "HEAD").stdout.strip()
    with pytest.raises(LibraryError) as exc:
        commit_batch(root, [Path("README.md")], "readme")
    assert VIEWER_WRITE_DENIED in str(exc.value)
    assert _run_git(root, "rev-parse", "HEAD").stdout.strip() == head_before


def test_viewer_study_progress_grade_still_works(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    owner = "owner@test.local"
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner=owner, viewer=viewer),
    )
    course = root / "Biology"
    (course / "study").mkdir(parents=True)
    (course / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": [
                    {
                        "id": "fc_cli",
                        "front": "Q",
                        "back": "A",
                        "source": {"digest": "digests/a.md", "heading": "Cells"},
                    }
                ],
            }
        )
        + "\n"
    )
    init_count = _commit_count(root)
    code, out, err = _run_cli(
        [
            "study-progress",
            "--root",
            str(root),
            "--course",
            "Biology",
            "grade",
            "--id",
            "fc_cli",
            "--result",
            "mastered",
            "--digest",
            "digests/a.md",
            "--heading",
            "Cells",
        ]
    )
    assert code == 0, err
    json.loads(out.strip())
    user_dir = git_user_dirname(root)
    progress = f".arbor/users/{user_dir}/Biology/progress.json"
    assert _run_git(root, "ls-files", progress).stdout.strip() == progress
    assert _commit_count(root) == init_count + 1


def test_viewer_skill_run_write_grant_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner="owner@test.local", viewer=viewer),
    )
    export = tmp_path / "export"
    export.mkdir()
    course = root / "Biology"
    course.mkdir()
    code, out, err = _run_cli(
        [
            "skill-run",
            "--id",
            "demo-skill",
            "--commit",
            "a" * 40,
            "--root",
            str(root),
            "--course",
            "Biology",
            "--export-dir",
            str(export),
            "--confirmed",
            "--grant",
            "write_course_study",
        ]
    )
    assert code == 1
    assert VIEWER_WRITE_DENIED in err

    code, out, err = _run_cli(
        [
            "skill-run",
            "--id",
            "demo-skill",
            "--commit",
            "a" * 40,
            "--root",
            str(root),
            "--course",
            "Biology",
            "--export-dir",
            str(export),
            "--confirmed",
            "--grant",
            "read_course",
        ]
    )
    assert code == 1
    assert VIEWER_WRITE_DENIED not in err


def _library_bare_clones(tmp_path: Path) -> tuple[Path, Path, Path]:
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", "-q", str(bare), str(seed)], check=True)
    owner = "owner@test.local"
    viewer = "viewer@test.local"
    _run_git(seed, "config", "user.email", owner)
    _run_git(seed, "config", "user.name", "Owner")
    lib_dir = seed / ".arbor"
    lib_dir.mkdir()
    doc = _library_doc(owner=owner, viewer=viewer)
    (lib_dir / "library.json").write_text(json.dumps(doc, indent=2) + "\n")
    (seed / "README.md").write_text("seed\n")
    _run_git(seed, "add", "-A")
    _run_git(seed, "commit", "-m", "init")
    _run_git(seed, "push", "-u", "origin", "HEAD")

    a = tmp_path / "a"
    b = tmp_path / "b"
    subprocess.run(["git", "clone", "-q", str(bare), str(a)], check=True)
    _run_git(a, "config", "user.email", owner)
    _run_git(a, "config", "user.name", "Owner")
    set_remote(a, str(bare))

    subprocess.run(["git", "clone", "-q", str(bare), str(b)], check=True)
    _run_git(b, "config", "user.email", viewer)
    _run_git(b, "config", "user.name", "Viewer")
    set_remote(b, str(bare))
    return bare, a, b


def test_sync_viewer_pulls_but_cannot_push(tmp_path: Path) -> None:
    bare, a, b = _library_bare_clones(tmp_path)
    bare_head_before = _run_git(bare, "rev-parse", "HEAD").stdout.strip()

    (a / "shared.md").write_text("from owner\n")
    _run_git(a, "add", "shared.md")
    _run_git(a, "commit", "-m", "owner note")
    sync_root(a)
    bare_head_after_owner = _run_git(bare, "rev-parse", "HEAD").stdout.strip()
    assert bare_head_after_owner != bare_head_before

    report = sync_root(b)
    assert report.ok
    assert (b / "shared.md").read_text() == "from owner\n"
    assert _run_git(bare, "rev-parse", "HEAD").stdout.strip() == bare_head_after_owner

    (b / "viewer-local.md").write_text("local only\n")
    _run_git(b, "add", "viewer-local.md")
    _run_git(b, "commit", "-m", "viewer local")
    with pytest.raises(GitSyncError) as exc:
        sync_root(b)
    assert VIEWER_WRITE_DENIED in str(exc.value)
    assert _run_git(bare, "rev-parse", "HEAD").stdout.strip() == bare_head_after_owner
    assert "viewer-local" not in _run_git(bare, "log", "--oneline").stdout


def test_viewer_read_commands_no_denial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    viewer = "viewer@test.local"
    root = _init_repo(
        tmp_path,
        viewer,
        with_library=_library_doc(owner="owner@test.local", viewer=viewer),
    )
    code, out, err = _run_cli(
        [
            "embed-search",
            "--root",
            str(root),
            "--query",
            "cells",
            "--provider",
            "hashed",
        ]
    )
    assert code == 0
    combined = out + err
    assert VIEWER_WRITE_DENIED not in combined

    code, out, err = _run_cli(["library-show", "--root", str(root)])
    assert code == 0
    combined = out + err
    assert VIEWER_WRITE_DENIED not in combined


def test_current_role_editor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _isolated_git_env(monkeypatch, tmp_path)
    editor = "editor@test.local"
    root = _init_repo(
        tmp_path,
        editor,
        with_library=_library_doc(owner="owner@test.local", editor=editor),
    )
    assert current_role(root) == "editor"
