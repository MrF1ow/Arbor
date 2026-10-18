"""Export the shared course deck to an Anki-importable TSV.

Anki's native .apkg format wraps a collection database whose schema changes
between Anki versions; generating .apkg with only the standard library would
be fragile. This skill writes UTF-8 TSV instead. Import it in Anki with fields
separated by Tab (Front, Back, Tags).
"""

from __future__ import annotations

import json


def _sanitize_field(value: str) -> str:
    return value.replace("\t", " ").replace("\r", " ").replace("\n", " ")


def export_deck(ctx) -> None:
    raw = ctx.read_course_file("study/flashcards.json")
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid flashcards JSON") from exc

    if not isinstance(doc, dict):
        raise ValueError("invalid flashcards deck")
    if doc.get("schema_version") != 1:
        raise ValueError("unsupported flashcards schema")

    cards = doc.get("cards")
    if not isinstance(cards, list) or not cards:
        raise ValueError("deck has no cards")

    lines: list[str] = []
    for card in cards:
        if not isinstance(card, dict):
            raise ValueError("invalid card")
        front = card.get("front")
        back = card.get("back")
        if not isinstance(front, str) or not isinstance(back, str):
            raise ValueError("card missing front or back")

        tags_raw = card.get("tags", [])
        if tags_raw is None:
            tags_raw = []
        if not isinstance(tags_raw, list):
            raise ValueError("invalid tags")
        for tag in tags_raw:
            if not isinstance(tag, str):
                raise ValueError("invalid tags")
        tag_str = " ".join(tags_raw)

        lines.append(
            f"{_sanitize_field(front)}\t{_sanitize_field(back)}\t{_sanitize_field(tag_str)}"
        )

    ctx.write_export("anki-export.tsv", "\n".join(lines).encode("utf-8"))
