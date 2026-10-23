from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path
from typing import Any

from arbor_worker.gitstate import commit_batch, path_has_pending_changes
from arbor_worker.library import LibraryError, assert_can_write

COURSES_REL = Path(".arbor/courses.json")

_COURSE_META_LOCK = threading.Lock()


class CourseMetaError(Exception):
    pass


def _validate_path_component(value: str, label: str) -> None:
    if not value or "/" in value or "\\" in value or ".." in value:
        raise CourseMetaError(f"Invalid {label}")


def _validate_meta_token(value: str, label: str) -> None:
    if not value or len(value) > 40:
        raise CourseMetaError(f"Invalid {label}")
    if not all(c.isascii() and (c.islower() or c.isdigit() or c == "-") for c in value):
        raise CourseMetaError(f"Invalid {label}")


def _courses_path(root: Path) -> Path:
    return root / ".arbor" / "courses.json"


def _empty_courses_map() -> dict[str, Any]:
    return {}


def _read_courses_map_from_disk(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return _empty_courses_map()
    try:
        text = path.read_text(encoding="utf-8")
        doc = json.loads(text)
    except (OSError, json.JSONDecodeError):
        return _empty_courses_map()
    courses = doc.get("courses") if isinstance(doc, dict) else None
    if not isinstance(courses, dict):
        return _empty_courses_map()
    return courses


def _normalize_full_document(data: object) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"version": 1, "courses": {}}
    doc = dict(data)
    courses = doc.get("courses")
    if not isinstance(courses, dict):
        doc["courses"] = {}
    if doc.get("version") is None:
        doc["version"] = 1
    return doc


def _read_full_document(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"version": 1, "courses": {}}
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "courses": {}}
    return _normalize_full_document(data)


def _write_courses_atomic(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / ".courses.json.tmp"
    tmp.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _entry_has_icon_or_color(entry: dict[str, Any]) -> bool:
    return "icon" in entry or "color" in entry


def _git(root: Path, args: list[str], runner=subprocess.run) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


def _is_git_work_tree(root: Path, runner=subprocess.run) -> bool:
    """True only when root is the top of its own repo, never a folder inside another repo."""
    proc = _git(root, ["rev-parse", "--show-toplevel"], runner)
    if proc.returncode != 0:
        return False
    top = (proc.stdout or "").strip()
    if not top:
        return False
    return Path(top).resolve() == Path(root).resolve()


def read_course_meta_map(root: Path) -> dict[str, Any]:
    return _read_courses_map_from_disk(_courses_path(Path(root)))


def set_course_meta(
    root: Path,
    course: str,
    icon: str | None,
    color: str | None,
    runner=subprocess.run,
) -> dict[str, Any]:
    root = Path(root)
    _validate_path_component(course, "course name")
    if icon is not None:
        _validate_meta_token(icon, "icon")
    if color is not None:
        _validate_meta_token(color, "color")

    assert_can_write(root, runner)

    with _COURSE_META_LOCK:
        path = _courses_path(root)
        doc = _read_full_document(path)
        courses = doc["courses"]
        assert isinstance(courses, dict)

        entry: dict[str, Any] = {}
        existing = courses.pop(course, None)
        if isinstance(existing, dict):
            entry = dict(existing)

        if icon is None:
            entry.pop("icon", None)
        else:
            entry["icon"] = icon
        if color is None:
            entry.pop("color", None)
        else:
            entry["color"] = color

        if _entry_has_icon_or_color(entry):
            courses[course] = entry

        _write_courses_atomic(path, doc)

        if _is_git_work_tree(root, runner) and path_has_pending_changes(
            root, COURSES_REL, runner=runner
        ):
            commit_batch(root, [COURSES_REL], "courses: update icon", runner=runner)

    return read_course_meta_map(root)
