from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker.course_meta import (
    COURSES_REL,
    CourseMetaError,
    _normalize_full_document,
    _read_full_document,
    read_course_meta_map,
    set_course_meta,
)
from arbor_worker.library import LIBRARY_REL, LibraryError, migrate_library_file


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def _init_git_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, email: str) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    _run_git(root, "init")
    _run_git(root, "config", "user.email", email)
    _run_git(root, "config", "user.name", "Test")
    (root / ".arbor").mkdir()
    _run_git(root, "add", ".")
    _run_git(root, "commit", "-m", "init", "--allow-empty")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", email)
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", email)
    return root


def _init_library_repo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, email: str, viewer: str | None = None
) -> Path:
    root = _init_git_root(tmp_path, monkeypatch, email)
    members = [{"email": email, "role": "owner"}]
    if viewer:
        members.append({"email": viewer, "role": "viewer"})
    doc = {
        "name": "Test Library",
        "created_by": email,
        "members": members,
    }
    (root / LIBRARY_REL).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    migrate_library_file(root)
    _run_git(root, "add", str(LIBRARY_REL))
    _run_git(root, "commit", "-m", "library")
    return root


def test_git_root_commits_courses_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = _init_git_root(tmp_path, monkeypatch, "owner@test.local")
    result = set_course_meta(root, "bio", "leaf", "moss")
    assert result["bio"]["icon"] == "leaf"
    assert _run_git(root, "status", "--porcelain").stdout.strip() == ""
    log = _run_git(root, "log", "-1", "--pretty=format:%s").stdout
    assert log == "courses: update icon"
    show = _run_git(root, "show", "--name-only", "--pretty=format:").stdout
    assert str(COURSES_REL) in show or ".arbor/courses.json" in show


def test_viewer_refused_without_file_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _init_library_repo(tmp_path, monkeypatch, "owner@test.local", viewer="viewer@test.local")
    _run_git(root, "config", "user.email", "viewer@test.local")
    path = root / COURSES_REL
    before_bytes = path.read_bytes() if path.is_file() else None
    with pytest.raises(LibraryError, match="viewer"):
        set_course_meta(root, "bio", "leaf", None)
    if before_bytes is None:
        assert not path.is_file()
    else:
        assert path.read_bytes() == before_bytes


def test_non_git_root_writes_only(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    root.mkdir()
    set_course_meta(root, "bio", "leaf", "olive")
    data = json.loads((root / COURSES_REL).read_text(encoding="utf-8"))
    assert data["courses"]["bio"]["icon"] == "leaf"


def test_folder_inside_another_repo_is_not_committed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    outer = _init_git_root(tmp_path, monkeypatch, "owner@test.local")
    head_before = _run_git(outer, "rev-parse", "HEAD").stdout.strip()
    root = outer / "knowledge"
    root.mkdir()
    set_course_meta(root, "bio", "leaf", None)
    assert (root / COURSES_REL).is_file()
    assert _run_git(outer, "rev-parse", "HEAD").stdout.strip() == head_before


def test_invalid_course_and_icon_rejected(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    root.mkdir()
    with pytest.raises(CourseMetaError):
        set_course_meta(root, "../evil", "leaf", None)
    with pytest.raises(CourseMetaError):
        set_course_meta(root, "bio", "Bad Icon", None)


def test_non_object_json_normalized_on_write(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    (root / ".arbor").mkdir(parents=True)
    (root / COURSES_REL).write_text("[]\n", encoding="utf-8")
    set_course_meta(root, "bio", "dna", None)
    doc = json.loads((root / COURSES_REL).read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    assert doc["courses"]["bio"]["icon"] == "dna"


def test_normalize_full_document_repairs_types() -> None:
    assert _normalize_full_document([]) == {"version": 1, "courses": {}}
    assert _normalize_full_document({"version": 1, "courses": True})["courses"] == {}
    path_doc = _read_full_document(Path("/nonexistent/courses.json"))
    assert path_doc == {"version": 1, "courses": {}}


def test_read_full_document_non_object_file(tmp_path: Path) -> None:
    path = tmp_path / "courses.json"
    path.write_text('"oops"\n', encoding="utf-8")
    assert _read_full_document(path) == {"version": 1, "courses": {}}


def test_round_trip_and_clear(tmp_path: Path) -> None:
    root = tmp_path / "plain"
    root.mkdir()
    set_course_meta(root, "bio", "leaf", "moss")
    assert read_course_meta_map(root)["bio"]["color"] == "moss"
    cleared = set_course_meta(root, "bio", None, None)
    assert "bio" not in cleared
