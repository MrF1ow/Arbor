from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from arbor_worker.course_meta import read_course_exam_date
from arbor_worker.machine import PROGRESS_BAK_GIT_EXCLUDE, ensure_git_exclude_pattern
from arbor_worker.study_plan import plan_markdown_path, study_plan_status
from arbor_worker.study_progress import (
    StudyProgressError,
    empty_quiz_week_totals,
    parse_utc_now,
    study_progress_class_mastery,
    study_progress_due,
    study_progress_stats,
    study_progress_weak,
    validate_course_name,
)

# Weak topics merged across classes: highest wrong_rate first, stable after that.
WEAK_TOPICS_CAP = 10

_RESERVED_TOP_LEVEL = frozenset(
    {"_arbor_cache", "study", "digests", "local", "chat"},
)


def list_knowledge_courses(root: Path) -> list[str]:
    """Top-level course folders, matching Rust ``list_courses`` skip rules."""
    if not root.is_dir():
        return []
    courses: list[str] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        name = child.name
        if not name or name.startswith("."):
            continue
        if name.casefold() in _RESERVED_TOP_LEVEL:
            continue
        try:
            validate_course_name(name)
        except ValueError:
            continue
        courses.append(name)
    courses.sort(key=lambda name: name.casefold())
    return courses


def _utc_calendar_date(clock: datetime) -> date:
    return clock.astimezone(timezone.utc).date()


def days_to_exam(clock: datetime, exam_date: str | None) -> int | None:
    if exam_date is None:
        return None
    exam = date.fromisoformat(exam_date)
    return (exam - _utc_calendar_date(clock)).days


def _digest_count(root: Path, course: str) -> int:
    dig_dir = root / course / "digests"
    if not dig_dir.is_dir():
        return 0
    return len(list(dig_dir.glob("*.md")))


def _weak_topics_for_course(root: Path, course: str) -> list[dict[str, Any]]:
    weak = study_progress_weak(root, course, limit=None)
    out: list[dict[str, Any]] = []
    for topic in weak.get("topics") or []:
        if not isinstance(topic, dict):
            continue
        if topic.get("wrong", 0) <= 0:
            continue
        out.append(
            {
                "course": course,
                "label": topic.get("label"),
                "digest": topic.get("digest"),
                "heading": topic.get("heading"),
                "wrong_rate": topic.get("wrong_rate"),
            }
        )
    return out


def _merge_quiz_accuracy(totals: dict[str, Any], course_stats: dict[str, Any]) -> None:
    for week in ("this_week", "last_week"):
        bucket = totals[week]
        src = course_stats["quiz"][week]
        bucket["correct"] += src["correct"]
        bucket["total"] += src["total"]


def _pick_next_exam(
    root: Path,
    courses: list[str],
    clock: datetime,
) -> dict[str, Any] | None:
    today = _utc_calendar_date(clock)
    best: tuple[date, str, str] | None = None
    for course in courses:
        exam_date = read_course_exam_date(root, course)
        if exam_date is None:
            continue
        exam = date.fromisoformat(exam_date)
        if exam < today:
            continue
        if best is None or exam < best[0] or (exam == best[0] and course.casefold() < best[1].casefold()):
            best = (exam, course, exam_date)
    if best is None:
        return None
    _exam, course, exam_date = best
    return {
        "course": course,
        "exam_date": exam_date,
        "days_to_exam": (best[0] - today).days,
    }


def _empty_course_row(course: str, *, exam_date: str | None = None) -> dict[str, Any]:
    return {
        "course": course,
        "digest_count": 0,
        "due_ids": [],
        "deck_count": 0,
        "mastered": 0,
        "mastery": None,
        "exam_date": exam_date,
        "days_to_exam": None,
        "plan": None,
    }


def _plan_progress(root: Path, course: str) -> dict[str, int] | None:
    """`{done, total}` when the class has a readable plan.md, else None."""
    try:
        if not plan_markdown_path(root, course).is_file():
            return None
        status = study_plan_status(root, course)
    except (OSError, ValueError):
        return None  # an unreadable plan blanks this field only, never the row
    return {"done": status["done"], "total": status["total"]}


def _course_payload(root: Path, course: str, clock: datetime) -> dict[str, Any]:
    digest_count = _digest_count(root, course)
    try:
        due = study_progress_due(root, course, now=clock)
        mastered, mastery = study_progress_class_mastery(root, course, now=clock)
        exam_date = read_course_exam_date(root, course)
        row = {
            "course": course,
            "digest_count": digest_count,
            "due_ids": due["due_ids"],
            "deck_count": due["deck_count"],
            "mastered": mastered,
            "mastery": mastery,
            "exam_date": exam_date,
            "days_to_exam": days_to_exam(clock, exam_date),
            "plan": _plan_progress(root, course),
        }
        return {
            "row": row,
            "weak": _weak_topics_for_course(root, course),
            "stats": study_progress_stats(root, course, now=clock),
        }
    except (StudyProgressError, ValueError, OSError) as error:
        exam_date = None
        try:
            exam_date = read_course_exam_date(root, course)
        except (OSError, ValueError):
            pass
        row = _empty_course_row(course, exam_date=exam_date)
        row["digest_count"] = digest_count
        row["days_to_exam"] = days_to_exam(clock, exam_date)
        row["error"] = str(error)
        return {"row": row, "weak": [], "stats": None}


def study_today(root: Path, *, now: datetime | None = None) -> dict[str, Any]:
    clock = now or parse_utc_now(None)
    ensure_git_exclude_pattern(root, PROGRESS_BAK_GIT_EXCLUDE)
    courses = list_knowledge_courses(root)

    course_rows: list[dict[str, Any]] = []
    weak_topics: list[dict[str, Any]] = []
    quiz_accuracy = {
        "this_week": empty_quiz_week_totals(),
        "last_week": empty_quiz_week_totals(),
    }

    for course in courses:
        payload = _course_payload(root, course, clock)
        course_rows.append(payload["row"])
        weak_topics.extend(payload["weak"])
        if payload["stats"] is not None:
            _merge_quiz_accuracy(quiz_accuracy, payload["stats"])

    weak_topics.sort(
        key=lambda row: (
            -(row.get("wrong_rate") or 0),
            row.get("label") or "",
            row.get("course") or "",
        )
    )
    weak_topics = weak_topics[:WEAK_TOPICS_CAP]

    return {
        "courses": course_rows,
        "weak_topics": weak_topics,
        "quiz_accuracy": quiz_accuracy,
        "next_exam": _pick_next_exam(root, courses, clock),
    }
