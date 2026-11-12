from __future__ import annotations

import json
import re
import subprocess
import threading
import unicodedata
from pathlib import Path
from typing import Any

from arbor_worker.gitstate import commit_batch, path_has_pending_changes
from arbor_worker.library import LibraryError, assert_can_write
from arbor_worker.study_plan import _validate_exam_date

COURSES_REL = Path(".arbor/courses.json")

_COURSE_META_LOCK = threading.Lock()

_DIGEST_KEY_RE = re.compile(r"^digests/[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$")


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


def _validate_units_value(units: object) -> dict[str, str] | None:
    if units is None:
        return None
    if not isinstance(units, dict):
        raise CourseMetaError("Invalid units")
    normalized: dict[str, str] = {}
    for key, value in units.items():
        if not isinstance(key, str) or not _DIGEST_KEY_RE.match(key):
            raise CourseMetaError("Invalid units key")
        if (
            not isinstance(value, str)
            or not value.strip()
            or len(value) > 80
            or any(unicodedata.category(char) == "Cc" for char in value)
        ):
            raise CourseMetaError("Invalid units value")
        normalized[key] = value.strip()
    return normalized or None


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


def read_course_exam_date(root: Path, course: str) -> str | None:
    entry = read_course_meta_map(root).get(course)
    if not isinstance(entry, dict):
        return None
    exam = entry.get("exam_date")
    if not isinstance(exam, str) or not exam:
        return None
    try:
        return _validate_exam_date(exam)
    except ValueError:
        return None


def _merge_field_clear_or_set(
    entry: dict[str, Any],
    key: str,
    raw: object,
    *,
    validate_token: bool = False,
) -> None:
    if raw is None or raw == "":
        entry.pop(key, None)
        return
    if not isinstance(raw, str):
        raise CourseMetaError(f"Invalid {key}")
    if validate_token:
        _validate_meta_token(raw, key)
    elif key == "exam_date":
        try:
            raw = _validate_exam_date(raw)
        except ValueError as error:
            raise CourseMetaError(str(error)) from error
        if raw is None:
            entry.pop(key, None)
            return
    entry[key] = raw


def apply_course_meta_fields(
    root: Path,
    course: str,
    fields: dict[str, Any],
    runner=subprocess.run,
) -> dict[str, Any]:
    root = Path(root)
    _validate_path_component(course, "course name")

    assert_can_write(root, runner)

    with _COURSE_META_LOCK:
        path = _courses_path(root)
        doc = _read_full_document(path)
        courses = doc["courses"]
        assert isinstance(courses, dict)

        entry: dict[str, Any] = {}
        existing = courses.get(course)
        if isinstance(existing, dict):
            entry = dict(existing)

        if "icon" in fields:
            _merge_field_clear_or_set(entry, "icon", fields["icon"], validate_token=True)
        if "color" in fields:
            _merge_field_clear_or_set(entry, "color", fields["color"], validate_token=True)
        if "exam_date" in fields:
            _merge_field_clear_or_set(entry, "exam_date", fields["exam_date"])
        if "units" in fields:
            units = _validate_units_value(fields["units"])
            if units is None:
                entry.pop("units", None)
            else:
                entry["units"] = units

        if entry:
            courses[course] = entry
        else:
            courses.pop(course, None)

        _write_courses_atomic(path, doc)

        if _is_git_work_tree(root, runner) and path_has_pending_changes(
            root, COURSES_REL, runner=runner
        ):
            commit_batch(
                root,
                [COURSES_REL],
                f"courses: update {course}",
                runner=runner,
            )

    return read_course_meta_map(root)


def set_course_meta(
    root: Path,
    course: str,
    icon: str | None,
    color: str | None,
    runner=subprocess.run,
) -> dict[str, Any]:
    return apply_course_meta_fields(
        root,
        course,
        {"icon": icon, "color": color},
        runner=runner,
    )
