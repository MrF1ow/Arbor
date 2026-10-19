from __future__ import annotations

from pathlib import Path
from typing import Any

from arbor_worker.study_progress import (
    _entry_source,
    _load_artifact_sources,
    _load_progress_document,
    digest_key,
    study_progress_due,
    study_progress_weak,
    validate_course_name,
)


def _load_progress_doc(root: Path, course: str) -> dict[str, Any]:
    return _load_progress_document(root, course)


def _reviewed_digest_keys(root: Path, course: str, doc: dict[str, Any]) -> set[str]:
    card_art, quiz_art = _load_artifact_sources(root, course)
    reviewed: set[str] = set()
    for card_id, entry in doc["cards"].items():
        if entry.get("seen", 0) <= 0:
            continue
        source = _entry_source(entry, card_art, card_id)
        if source and source.get("digest"):
            reviewed.add(digest_key(str(source["digest"])))
    for question_id, entry in doc["questions"].items():
        if entry.get("seen", 0) <= 0:
            continue
        source = _entry_source(entry, quiz_art, question_id)
        if source and source.get("digest"):
            reviewed.add(digest_key(str(source["digest"])))
    return reviewed


def _first_unreviewed_digest(root: Path, course: str, reviewed: set[str]) -> str | None:
    digests_dir = root / course / "digests"
    if not digests_dir.is_dir():
        return None
    for digest_path in sorted(digests_dir.glob("*.md")):
        rel = f"digests/{digest_path.name}"
        if digest_key(rel) not in reviewed:
            return rel
    return None


def study_recommendations(root: Path, course: str, now=None) -> dict[str, Any]:
    validate_course_name(course)
    course_dir = root / course
    if not course_dir.is_dir():
        raise ValueError(f"course directory does not exist: {course_dir}")

    items: list[dict[str, Any]] = []
    due = study_progress_due(root, course, now=now)
    count = due["count"]
    if count > 0:
        label = "Review 1 due card" if count == 1 else f"Review {count} due cards"
        items.append(
            {
                "kind": "due_cards",
                "label": label,
                "view": "flashcards",
                "count": count,
            }
        )

    weak = study_progress_weak(root, course)
    topics = weak.get("topics") or []
    if topics:
        topic = topics[0]
        items.append(
            {
                "kind": "weakest_topic",
                "label": topic["label"],
                "view": "notes",
                "digest": topic.get("digest"),
                "heading": topic.get("heading"),
            }
        )

    doc = _load_progress_doc(root, course)
    reviewed = _reviewed_digest_keys(root, course, doc)
    unreviewed = _first_unreviewed_digest(root, course, reviewed)
    if unreviewed is not None:
        filename = unreviewed.split("/", 1)[1]
        items.append(
            {
                "kind": "unreviewed_digest",
                "label": f"Read {filename}",
                "view": "notes",
                "digest": unreviewed,
                "heading": None,
            }
        )

    return {"items": items}
