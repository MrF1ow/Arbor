from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from arbor_worker.course_manifest import CourseManifest

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


def _natural_key(text: str) -> list[Any]:
    """Case-insensitive key that reads digit runs as numbers (`09-x` < `10-x`)."""
    # Splitting on a capturing group puts text at even indices and digit runs at odd ones.
    return [int(part) if i % 2 else part for i, part in enumerate(re.split(r"(\d+)", text.casefold()))]


def _stem_key(name: str) -> tuple[str, int, str]:
    """A `-N` after a `THHMM` stamp is a number; no suffix reads as 1 (`T2228` < `T2228-2` < `T2228-10`).

    The worker writes `YYYY-MM-DD`, `YYYY-MM-DDTHHMM` and `YYYY-MM-DDTHHMM-N`, so the date-only stem
    `2026-09-13` has no suffix.
    """
    stem = name.rsplit("/", 1)[-1].removesuffix(".md")
    match = re.fullmatch(r"(.*?T\d{4})(?:-(\d+))?|(.*)", stem)
    assert match is not None
    return (match.group(1) or match.group(3), int(match.group(2) or 1), name)


def _first_unreviewed_digest(root: Path, course: str, reviewed: set[str]) -> str | None:
    """First digest not yet reviewed, in the order the lecture list shows them.

    Manifest records come first in natural `source_path` order (then the stem rule for digests of
    one source); digests the manifest does not know follow by the stem rule.
    """
    course_dir = root / course
    digests_dir = course_dir / "digests"
    if not digests_dir.is_dir():
        return None
    on_disk = {f"digests/{path.name}" for path in digests_dir.glob("*.md")}
    try:
        manifest_records = CourseManifest.load(course_dir).records()
    except (OSError, ValueError, AttributeError, TypeError):
        # A corrupt manifest counts as none, like the desktop: fall back to the stem order.
        manifest_records = []
    # The desktop files a digest under the first manifest record that names it; do the same.
    first_record: dict[str, dict[str, Any]] = {}
    for rec in manifest_records:
        if not isinstance(rec, dict):
            continue
        rel = rec.get("digest_file")
        if rec.get("source_path") and rel in on_disk:
            first_record.setdefault(str(rel), rec)
    records = sorted(
        first_record.values(),
        key=lambda rec: (_natural_key(str(rec["source_path"])), _stem_key(str(rec["digest_file"]))),
    )
    ordered = [str(rec["digest_file"]) for rec in records]
    ordered.extend(sorted(on_disk - set(ordered), key=_stem_key))
    for rel in ordered:
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
