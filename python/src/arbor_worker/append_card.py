from __future__ import annotations

import json
import os
import re
from pathlib import Path

from arbor_worker.schemas.study.flashcards import CardSource, Flashcard, FlashcardDeck
from arbor_worker.skills.flashcards import card_id
from arbor_worker.study_progress import validate_course_name

_MAX_TEXT = 2000
_MAX_HEADING = 200
_MAX_PAGE = 32
_PAGE_RE = re.compile(r"^[0-9]+(-[0-9]+)?$")


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _validate_card_text(field: str, value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{field} must not be empty")
    if "\0" in stripped:
        raise ValueError(f"{field} must not contain NUL")
    if len(stripped) > _MAX_TEXT:
        raise ValueError(f"{field} exceeds maximum length")
    return stripped


def _validate_digest(root: Path, course: str, digest: str) -> str:
    if "\\" in digest or ".." in digest or digest.startswith("/"):
        raise ValueError(f"invalid digest path: {digest!r}")
    if not digest.startswith("digests/") or not digest.endswith(".md"):
        raise ValueError(f"invalid digest path: {digest!r}")
    parts = digest.split("/")
    if len(parts) != 2 or not parts[1]:
        raise ValueError(f"invalid digest path: {digest!r}")
    course_dir = (root / course).resolve()
    digest_path = (root / course / digest).resolve()
    try:
        digest_path.relative_to(course_dir)
    except ValueError as error:
        raise ValueError(f"invalid digest path: {digest!r}") from error
    if not digest_path.is_file():
        raise ValueError(f"digest file does not exist: {digest}")
    return digest


def _normalize_heading(heading: str | None) -> str | None:
    if heading is None:
        return None
    stripped = heading.strip()
    if not stripped:
        return None
    if "\n" in stripped or "\r" in stripped:
        raise ValueError("heading must not contain newlines")
    if len(stripped) > _MAX_HEADING:
        raise ValueError("heading exceeds maximum length")
    return stripped


def _normalize_page(page: str | None) -> str | None:
    if page is None:
        return None
    stripped = page.strip()
    if not stripped:
        return None
    if len(stripped) > _MAX_PAGE:
        raise ValueError("page exceeds maximum length")
    if not _PAGE_RE.match(stripped):
        raise ValueError(f"invalid page: {page!r}")
    return stripped


def _deck_to_json(deck: FlashcardDeck) -> str:
    return json.dumps(deck.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"


def _card_to_dict(card: Flashcard) -> dict:
    payload = card.model_dump(mode="json")
    source = payload.get("source") or {}
    if source.get("page") is None:
        source.pop("page", None)
    payload["source"] = source
    return payload


def append_flashcard(
    root: Path,
    course: str,
    front: str,
    back: str,
    digest: str,
    heading: str | None = None,
    page: str | None = None,
) -> dict:
    validate_course_name(course)
    course_dir = root / course
    if not course_dir.is_dir():
        raise ValueError(f"course directory does not exist: {course_dir}")

    front_text = _validate_card_text("front", front)
    back_text = _validate_card_text("back", back)
    digest_path = _validate_digest(root, course, digest)
    heading_text = _normalize_heading(heading)
    page_text = _normalize_page(page)

    source_kwargs: dict = {"digest": digest_path, "heading": heading_text}
    if page_text is not None:
        source_kwargs["page"] = page_text
    source = CardSource(**source_kwargs)
    card = Flashcard(front=front_text, back=back_text, tags=[], source=source)
    new_id = card_id(card)
    card = card.model_copy(update={"id": new_id})

    deck_path = course_dir / "study" / "flashcards.json"
    if deck_path.is_file():
        try:
            raw = json.loads(deck_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"invalid flashcards.json: {error}") from error
        deck = FlashcardDeck.model_validate(raw)
        if deck.course != course:
            raise ValueError("course mismatch in flashcards.json")
        if any(existing.id == new_id for existing in deck.cards):
            raise ValueError("flashcard already exists")
        deck = deck.model_copy(update={"cards": [*deck.cards, card]})
    else:
        deck = FlashcardDeck(schema_version=1, course=course, cards=[card])

    _write_atomic(deck_path, _deck_to_json(deck))
    return _card_to_dict(card)
