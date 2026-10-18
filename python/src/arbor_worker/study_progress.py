from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from arbor_worker.cache import ensure_gitignored
from arbor_worker.gitstate import git_user_dirname
from arbor_worker.schemas.study.digest import normalize_study_digest

DEFAULT_EASE = 2.5
SCHEMA_VERSION = 1
WRONG_RETRY_MINUTES = 10


class StudyProgressError(Exception):
    """Corrupt progress file or invalid stored document."""


def validate_course_name(course: str) -> None:
    if not course or course in (".", "..") or "/" in course or "\\" in course:
        raise ValueError(f"invalid course name: {course!r}")


def legacy_v41_progress_path(root: Path, course: str) -> Path:
    validate_course_name(course)
    return root / course / "study" / "progress.json"


def progress_path(root: Path, course: str) -> Path:
    validate_course_name(course)
    dirname = git_user_dirname(root)
    return root / ".arbor" / "users" / dirname / course / "progress.json"


def _migrate_v41_progress_unlocked(root: Path, course: str) -> None:
    new_path = progress_path(root, course)
    if new_path.is_file():
        return
    legacy = legacy_v41_progress_path(root, course)
    if not legacy.is_file():
        return
    new_path.parent.mkdir(parents=True, exist_ok=True)
    new_path.write_bytes(legacy.read_bytes())
    bak_path = legacy.parent / "progress.json.bak"
    if not bak_path.is_file():
        legacy.rename(bak_path)
    else:
        legacy.unlink()


def migrate_v41_progress(root: Path, course: str) -> None:
    validate_course_name(course)
    with progress_lock(root, course):
        _migrate_v41_progress_unlocked(root, course)


def legacy_flashcards_path(root: Path, course: str) -> Path:
    return root / ".arbor" / "progress" / f"{course}.flashcards.json"


def legacy_quiz_path(root: Path, course: str) -> Path:
    return root / ".arbor" / "progress" / f"{course}.quiz.json"


def parse_utc_now(raw: str | None) -> datetime:
    if raw is None:
        return datetime.now(timezone.utc).replace(microsecond=0)
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def format_due_at(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def digest_key(digest: str) -> str:
    normalized = digest.replace("\\", "/")
    if "digests/" in normalized:
        idx = normalized.index("digests/")
        return normalized[idx:]
    return normalize_study_digest(digest)


def heading_key(heading: str | None) -> str | None:
    if heading is None:
        return None
    stripped = heading.strip()
    return stripped if stripped else None


def _empty_document(course: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "course": course,
        "cards": {},
        "questions": {},
    }


def _serialize_document(doc: dict[str, Any]) -> str:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(
        f".{path.name}.tmp-{os.getpid()}-{threading.get_ident()}-{uuid.uuid4().hex[:8]}"
    )
    try:
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


@contextmanager
def progress_lock(root: Path, course: str):
    validate_course_name(course)
    if os.name == "nt":
        yield
        return
    try:
        import fcntl
    except ImportError:
        yield
        return
    locks_dir = root / ".arbor" / "locks"
    locks_dir.mkdir(parents=True, exist_ok=True)
    ensure_gitignored(root, ".arbor/locks")
    lock_path = locks_dir / f"progress-{course}.lock"
    with open(lock_path, "a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _load_legacy_counts(path: Path) -> dict[str, dict[str, int]] | None:
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"skip invalid progress file {path}: {error}", file=sys.stderr)
        return None
    if not isinstance(raw, dict):
        print(f"skip invalid progress file {path}: expected object", file=sys.stderr)
        return None
    out: dict[str, dict[str, int]] = {}
    for card_id, entry in raw.items():
        if not isinstance(card_id, str) or not card_id:
            continue
        if not isinstance(entry, dict):
            continue
        seen = entry.get("seen", 0)
        correct = entry.get("correct", 0)
        wrong = entry.get("wrong", 0)
        if not all(isinstance(v, int) and v >= 0 for v in (seen, correct, wrong)):
            continue
        out[card_id] = {"seen": seen, "correct": correct, "wrong": wrong}
    return out


def _source_from_artifact(entry: dict[str, Any]) -> dict[str, Any] | None:
    source = entry.get("source")
    if not isinstance(source, dict):
        return None
    digest = source.get("digest")
    if not isinstance(digest, str) or not digest.strip():
        return None
    heading = source.get("heading")
    if heading is not None and not isinstance(heading, str):
        heading = None
    return {"digest": normalize_study_digest(digest), "heading": heading}


def _load_artifact_sources(root: Path, course: str) -> tuple[dict[str, dict], dict[str, dict]]:
    card_sources: dict[str, dict] = {}
    quiz_sources: dict[str, dict] = {}
    deck_path = root / course / "study" / "flashcards.json"
    if deck_path.is_file():
        try:
            deck = json.loads(deck_path.read_text(encoding="utf-8"))
            if isinstance(deck, dict) and deck.get("schema_version") == 1:
                for card in deck.get("cards") or []:
                    if isinstance(card, dict) and isinstance(card.get("id"), str) and card["id"]:
                        src = _source_from_artifact(card)
                        if src:
                            card_sources[card["id"]] = src
        except (OSError, json.JSONDecodeError):
            pass
    quiz_path = root / course / "study" / "quiz.json"
    if quiz_path.is_file():
        try:
            pack = json.loads(quiz_path.read_text(encoding="utf-8"))
            if isinstance(pack, dict) and pack.get("schema_version") == 1:
                for question in pack.get("questions") or []:
                    if (
                        isinstance(question, dict)
                        and isinstance(question.get("id"), str)
                        and question["id"]
                    ):
                        src = _source_from_artifact(question)
                        if src:
                            quiz_sources[question["id"]] = src
        except (OSError, json.JSONDecodeError):
            pass
    return card_sources, quiz_sources


def _build_from_legacy(root: Path, course: str) -> dict[str, Any] | None:
    if legacy_v41_progress_path(root, course).is_file():
        return None
    legacy_cards = _load_legacy_counts(legacy_flashcards_path(root, course))
    legacy_questions = _load_legacy_counts(legacy_quiz_path(root, course))
    if not legacy_cards and not legacy_questions:
        return None
    card_sources, quiz_sources = _load_artifact_sources(root, course)
    doc = _empty_document(course)
    for card_id, counts in (legacy_cards or {}).items():
        entry: dict[str, Any] = {
            "seen": counts["seen"],
            "correct": counts["correct"],
            "wrong": counts["wrong"],
            "due_at": None,
            "interval_days": 0,
            "ease": DEFAULT_EASE,
        }
        if card_id in card_sources:
            entry["source"] = card_sources[card_id]
        doc["cards"][card_id] = entry
    for question_id, counts in (legacy_questions or {}).items():
        entry = {
            "seen": counts["seen"],
            "correct": counts["correct"],
            "wrong": counts["wrong"],
        }
        if question_id in quiz_sources:
            entry["source"] = quiz_sources[question_id]
        doc["questions"][question_id] = entry
    return doc


def _validate_card_entry(card_id: str, entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise StudyProgressError(f"invalid card entry for {card_id!r}")
    for key in ("seen", "correct", "wrong"):
        val = entry.get(key)
        if not isinstance(val, int) or val < 0:
            raise StudyProgressError(f"invalid card counts for {card_id!r}")
    due_at = entry.get("due_at")
    if due_at is not None and not isinstance(due_at, str):
        raise StudyProgressError(f"invalid due_at for {card_id!r}")
    if isinstance(due_at, str) and due_at.strip():
        try:
            parse_utc_now(due_at)
        except ValueError:
            raise StudyProgressError(f"invalid due_at for {card_id!r}") from None
    interval_days = entry.get("interval_days")
    if not isinstance(interval_days, (int, float)):
        raise StudyProgressError(f"invalid interval_days for {card_id!r}")
    ease = entry.get("ease")
    if not isinstance(ease, (int, float)):
        raise StudyProgressError(f"invalid ease for {card_id!r}")
    out: dict[str, Any] = {
        "seen": entry["seen"],
        "correct": entry["correct"],
        "wrong": entry["wrong"],
        "due_at": due_at,
        "interval_days": interval_days,
        "ease": ease,
    }
    source = entry.get("source")
    if source is not None:
        if not isinstance(source, dict):
            raise StudyProgressError(f"invalid source for {card_id!r}")
        digest = source.get("digest")
        if not isinstance(digest, str) or not digest.strip():
            raise StudyProgressError(f"invalid source digest for {card_id!r}")
        heading = source.get("heading")
        if heading is not None and not isinstance(heading, str):
            raise StudyProgressError(f"invalid source heading for {card_id!r}")
        out["source"] = {"digest": digest, "heading": heading}
    return out


def _validate_question_entry(question_id: str, entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise StudyProgressError(f"invalid question entry for {question_id!r}")
    for key in ("seen", "correct", "wrong"):
        val = entry.get(key)
        if not isinstance(val, int) or val < 0:
            raise StudyProgressError(f"invalid question counts for {question_id!r}")
    out: dict[str, Any] = {
        "seen": entry["seen"],
        "correct": entry["correct"],
        "wrong": entry["wrong"],
    }
    source = entry.get("source")
    if source is not None:
        if not isinstance(source, dict):
            raise StudyProgressError(f"invalid source for {question_id!r}")
        digest = source.get("digest")
        if not isinstance(digest, str) or not digest.strip():
            raise StudyProgressError(f"invalid source digest for {question_id!r}")
        heading = source.get("heading")
        if heading is not None and not isinstance(heading, str):
            raise StudyProgressError(f"invalid source heading for {question_id!r}")
        out["source"] = {"digest": digest, "heading": heading}
    return out


def _validate_document(raw: Any, course: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise StudyProgressError("progress file must be a JSON object")
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise StudyProgressError("unsupported schema_version")
    if raw.get("course") != course:
        raise StudyProgressError("course mismatch in progress file")
    cards_raw = raw.get("cards")
    questions_raw = raw.get("questions")
    if not isinstance(cards_raw, dict) or not isinstance(questions_raw, dict):
        raise StudyProgressError("cards and questions must be objects")
    cards: dict[str, Any] = {}
    for card_id, entry in cards_raw.items():
        if not isinstance(card_id, str) or not card_id:
            raise StudyProgressError("invalid card id")
        cards[card_id] = _validate_card_entry(card_id, entry)
    questions: dict[str, Any] = {}
    for question_id, entry in questions_raw.items():
        if not isinstance(question_id, str) or not question_id:
            raise StudyProgressError("invalid question id")
        questions[question_id] = _validate_question_entry(question_id, entry)
    return {
        "schema_version": SCHEMA_VERSION,
        "course": course,
        "cards": cards,
        "questions": questions,
    }


def _read_document(path: Path, course: str) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StudyProgressError(f"cannot read progress file: {error}") from error
    return _validate_document(raw, course)


def _load_progress_document(root: Path, course: str) -> dict[str, Any]:
    with progress_lock(root, course):
        _migrate_v41_progress_unlocked(root, course)
        path = progress_path(root, course)
        if path.is_file():
            return _read_document(path, course)
        migrated = _build_from_legacy(root, course)
        if migrated is not None:
            _write_atomic(path, _serialize_document(migrated))
            return migrated
        return _empty_document(course)


def _ensure_document(
    root: Path,
    course: str,
    *,
    write_migration: bool,
) -> dict[str, Any]:
    _migrate_v41_progress_unlocked(root, course)
    path = progress_path(root, course)
    if path.is_file():
        return _read_document(path, course)
    migrated = _build_from_legacy(root, course)
    if migrated is None:
        return _empty_document(course)
    if write_migration:
        _write_atomic(path, _serialize_document(migrated))
    return migrated


def _lookup_card_source(root: Path, course: str, card_id: str) -> dict[str, Any] | None:
    deck_path = root / course / "study" / "flashcards.json"
    if not deck_path.is_file():
        return None
    try:
        deck = json.loads(deck_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(deck, dict) or deck.get("schema_version") != 1:
        return None
    for card in deck.get("cards") or []:
        if isinstance(card, dict) and card.get("id") == card_id:
            return _source_from_artifact(card)
    return None


def _lookup_question_source(root: Path, course: str, question_id: str) -> dict[str, Any] | None:
    quiz_path = root / course / "study" / "quiz.json"
    if not quiz_path.is_file():
        return None
    try:
        pack = json.loads(quiz_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(pack, dict) or pack.get("schema_version") != 1:
        return None
    for question in pack.get("questions") or []:
        if isinstance(question, dict) and question.get("id") == question_id:
            return _source_from_artifact(question)
    return None


class _MISSING:
    pass


def _apply_source(
    entry: dict[str, Any],
    *,
    digest: str | None,
    heading: str | None | type[_MISSING],
    lookup: Callable[[], dict[str, Any] | None],
) -> None:
    if digest is not None:
        resolved_heading: str | None
        if heading is not _MISSING:
            resolved_heading = None if heading == "" else heading
        else:
            prior = entry.get("source")
            if isinstance(prior, dict) and "heading" in prior:
                resolved_heading = prior.get("heading")
            else:
                looked = lookup()
                resolved_heading = looked.get("heading") if looked else None
        entry["source"] = {
            "digest": normalize_study_digest(digest),
            "heading": resolved_heading,
        }
        return
    if heading is not _MISSING:
        src = entry.get("source")
        if not isinstance(src, dict):
            looked = lookup()
            if looked is None:
                return
            src = dict(looked)
            entry["source"] = src
        src["heading"] = None if heading == "" else heading
        return
    if "source" not in entry:
        looked = lookup()
        if looked:
            entry["source"] = looked


def _default_card_entry() -> dict[str, Any]:
    return {
        "seen": 0,
        "correct": 0,
        "wrong": 0,
        "due_at": None,
        "interval_days": 0,
        "ease": DEFAULT_EASE,
    }


def _default_question_entry() -> dict[str, Any]:
    return {"seen": 0, "correct": 0, "wrong": 0}


def _parse_due_at(value: str | None) -> datetime | None:
    if value is None:
        return None
    return parse_utc_now(value)


def _card_is_due(entry: dict[str, Any] | None, now: datetime) -> bool:
    if entry is None:
        return True
    due_at = entry.get("due_at")
    if due_at is None:
        return True
    due = _parse_due_at(due_at)
    if due is None:
        return True
    return due <= now


def _load_deck_ids(root: Path, course: str) -> list[str]:
    deck_path = root / course / "study" / "flashcards.json"
    if not deck_path.is_file():
        return []
    try:
        deck = json.loads(deck_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(deck, dict) or deck.get("schema_version") != 1:
        return []
    ids: list[str] = []
    for card in deck.get("cards") or []:
        if isinstance(card, dict) and isinstance(card.get("id"), str) and card["id"]:
            ids.append(card["id"])
    return ids


def study_progress_show(root: Path, course: str) -> dict[str, Any]:
    validate_course_name(course)
    return _load_progress_document(root, course)


def study_progress_grade(
    root: Path,
    course: str,
    card_id: str,
    result: str,
    *,
    now: datetime | None = None,
    digest: str | None = None,
    heading: str | None | type[_MISSING] = _MISSING,
) -> dict[str, Any]:
    validate_course_name(course)
    if not card_id:
        raise ValueError("card id must be non-empty")
    if result not in {"again", "wrong", "mastered"}:
        raise ValueError(f"invalid grade result: {result!r}")
    with progress_lock(root, course):
        clock = now or parse_utc_now(None)
        doc = _ensure_document(root, course, write_migration=True)
        cards = doc["cards"]
        entry = cards.get(card_id)
        if entry is None:
            entry = _default_card_entry()
            cards[card_id] = entry
        _apply_source(
            entry,
            digest=digest,
            heading=heading,
            lookup=lambda: _lookup_card_source(root, course, card_id),
        )
        if result == "again":
            entry["seen"] += 1
        elif result == "wrong":
            entry["seen"] += 1
            entry["wrong"] += 1
            entry["interval_days"] = 0
            entry["due_at"] = format_due_at(clock + timedelta(minutes=WRONG_RETRY_MINUTES))
        else:
            entry["seen"] += 1
            entry["correct"] += 1
            ease = float(entry["ease"])
            interval = float(entry["interval_days"])
            if interval <= 0:
                interval = 1.0
            else:
                interval = interval * ease
                if interval < 1:
                    interval = 1.0
            entry["interval_days"] = interval
            entry["due_at"] = format_due_at(clock + timedelta(days=interval))
        path = progress_path(root, course)
        _write_atomic(path, _serialize_document(doc))
        return doc


def study_progress_quiz(
    root: Path,
    course: str,
    question_id: str,
    result: str,
    *,
    now: datetime | None = None,
    digest: str | None = None,
    heading: str | None | type[_MISSING] = _MISSING,
) -> dict[str, Any]:
    validate_course_name(course)
    if not question_id:
        raise ValueError("question id must be non-empty")
    if result not in {"correct", "wrong"}:
        raise ValueError(f"invalid quiz result: {result!r}")
    _ = now  # reserved for API symmetry
    with progress_lock(root, course):
        doc = _ensure_document(root, course, write_migration=True)
        questions = doc["questions"]
        entry = questions.get(question_id)
        if entry is None:
            entry = _default_question_entry()
            questions[question_id] = entry
        _apply_source(
            entry,
            digest=digest,
            heading=heading,
            lookup=lambda: _lookup_question_source(root, course, question_id),
        )
        entry["seen"] += 1
        if result == "correct":
            entry["correct"] += 1
        else:
            entry["wrong"] += 1
        path = progress_path(root, course)
        _write_atomic(path, _serialize_document(doc))
        return doc


def study_progress_due(
    root: Path,
    course: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    validate_course_name(course)
    clock = now or parse_utc_now(None)
    deck_ids = _load_deck_ids(root, course)
    doc = _load_progress_document(root, course)
    cards = doc["cards"]
    due_ids = [card_id for card_id in deck_ids if _card_is_due(cards.get(card_id), clock)]
    return {"due_ids": due_ids, "count": len(due_ids), "deck_count": len(deck_ids)}


def _entry_source(
    entry: dict[str, Any],
    artifact_sources: dict[str, dict],
    entry_id: str,
) -> dict[str, Any] | None:
    source = entry.get("source")
    if isinstance(source, dict) and source.get("digest"):
        return {
            "digest": normalize_study_digest(str(source["digest"])),
            "heading": source.get("heading"),
        }
    return artifact_sources.get(entry_id)


def _concept_matches(concept_sources: list[dict], digest: str, heading: str | None) -> bool:
    h = heading_key(heading)
    if h is None:
        return False
    key = digest_key(digest)
    for src in concept_sources:
        if not isinstance(src, dict):
            continue
        d = src.get("digest")
        if not isinstance(d, str):
            continue
        if digest_key(d) != key:
            continue
        if heading_key(src.get("heading")) == h:
            return True
    return False


def study_progress_weak(root: Path, course: str) -> dict[str, Any]:
    validate_course_name(course)
    doc = _load_progress_document(root, course)

    card_art, quiz_art = _load_artifact_sources(root, course)
    concepts_path = root / course / "study" / "concepts.json"
    concept_nodes: list[dict] = []
    if concepts_path.is_file():
        try:
            graph = json.loads(concepts_path.read_text(encoding="utf-8"))
            if isinstance(graph, dict) and graph.get("schema_version") == 1:
                for node in graph.get("nodes") or []:
                    if isinstance(node, dict) and node.get("kind") == "concept":
                        concept_nodes.append(node)
        except (OSError, json.JSONDecodeError):
            pass

    concept_stats: dict[str, dict[str, Any]] = {}
    heading_stats: dict[tuple[str, str], dict[str, Any]] = {}
    headings_with_concept: set[tuple[str, str]] = set()

    for node in concept_nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str):
            continue
        concept_stats[node_id] = {
            "label": node.get("name") if isinstance(node.get("name"), str) else node_id,
            "concept_id": node_id,
            "wrong": 0,
            "correct": 0,
            "digest": None,
            "heading": None,
            "sources": node.get("sources") if isinstance(node.get("sources"), list) else [],
        }
        for src in concept_stats[node_id]["sources"]:
            if isinstance(src, dict) and isinstance(src.get("digest"), str):
                dkey = digest_key(src["digest"])
                hkey = heading_key(src.get("heading"))
                if hkey is not None:
                    headings_with_concept.add((dkey, hkey))

    def accumulate(entry_id: str, entry: dict[str, Any], artifact_sources: dict[str, dict]) -> None:
        correct = entry.get("correct", 0)
        wrong = entry.get("wrong", 0)
        if correct + wrong == 0:
            return
        source = _entry_source(entry, artifact_sources, entry_id)
        if source is None:
            return
        digest = source["digest"]
        heading = source.get("heading")
        h = heading_key(heading)
        if h is None:
            return
        dkey = digest_key(digest)
        matched_any = False
        for node in concept_nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            sources = node.get("sources") if isinstance(node.get("sources"), list) else []
            if not _concept_matches(sources, digest, heading):
                continue
            matched_any = True
            stats = concept_stats.setdefault(
                node_id,
                {
                    "label": node.get("name") if isinstance(node.get("name"), str) else node_id,
                    "concept_id": node_id,
                    "wrong": 0,
                    "correct": 0,
                    "digest": None,
                    "heading": None,
                    "sources": sources,
                },
            )
            stats["wrong"] += wrong
            stats["correct"] += correct
            if stats["digest"] is None:
                stats["digest"] = digest
                stats["heading"] = heading
        if not matched_any and (dkey, h) not in headings_with_concept:
            key = (dkey, h)
            row = heading_stats.setdefault(
                key,
                {
                    "label": h,
                    "concept_id": None,
                    "wrong": 0,
                    "correct": 0,
                    "digest": digest,
                    "heading": heading,
                },
            )
            row["wrong"] += wrong
            row["correct"] += correct

    for card_id, entry in doc["cards"].items():
        accumulate(card_id, entry, card_art)
    for question_id, entry in doc["questions"].items():
        accumulate(question_id, entry, quiz_art)

    topics: list[dict[str, Any]] = []
    for stats in concept_stats.values():
        wrong = stats["wrong"]
        correct = stats["correct"]
        if wrong <= 0:
            continue
        rate = wrong / (correct + wrong)
        digest_out = stats["digest"]
        heading_out = stats["heading"]
        if digest_out is None and stats["sources"]:
            first = stats["sources"][0]
            if isinstance(first, dict) and isinstance(first.get("digest"), str):
                digest_out = normalize_study_digest(first["digest"])
                heading_out = first.get("heading")
        topics.append(
            {
                "kind": "concept",
                "label": stats["label"],
                "concept_id": stats["concept_id"],
                "digest": digest_out,
                "heading": heading_out,
                "wrong": wrong,
                "correct": correct,
                "wrong_rate": rate,
            }
        )

    for (_dkey, _h), stats in heading_stats.items():
        wrong = stats["wrong"]
        correct = stats["correct"]
        if wrong <= 0:
            continue
        rate = wrong / (correct + wrong)
        topics.append(
            {
                "kind": "heading",
                "label": stats["label"],
                "concept_id": None,
                "digest": stats["digest"],
                "heading": stats["heading"],
                "wrong": wrong,
                "correct": correct,
                "wrong_rate": rate,
            }
        )

    topics.sort(key=lambda t: (-t["wrong_rate"], -t["wrong"], t["label"]))
    return {"topics": topics[:5]}


def emit_json_line(value: Any) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
