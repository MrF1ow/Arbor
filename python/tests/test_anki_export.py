from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PACKAGE_PY = _REPO_ROOT / "marketplace" / "packages" / "anki-export" / "anki_export.py"


def _load_export_deck():
    spec = importlib.util.spec_from_file_location("anki_export_under_test", _PACKAGE_PY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.export_deck


class _FakeContext:
    def __init__(self, deck_bytes: bytes) -> None:
        self._deck_bytes = deck_bytes
        self.writes: list[tuple[str, bytes]] = []

    def read_course_file(self, relative: str) -> bytes:
        assert relative == "study/flashcards.json"
        return self._deck_bytes

    def write_export(self, relative: str, data: bytes) -> None:
        self.writes.append((relative, data))


def test_export_deck_writes_tsv_with_sanitized_fields() -> None:
    deck = {
        "schema_version": 1,
        "course": "Biology",
        "cards": [
            {
                "id": "c1",
                "front": "What\tis\nthis?",
                "back": "A cell",
                "tags": ["bio", "unit-1"],
                "source": {},
            },
            {
                "id": "c2",
                "front": "Second",
                "back": "Answer",
                "tags": [],
                "source": {},
            },
        ],
    }
    ctx = _FakeContext(json.dumps(deck).encode("utf-8"))
    _load_export_deck()(ctx)

    assert len(ctx.writes) == 1
    name, payload = ctx.writes[0]
    assert name == "anki-export.tsv"

    lines = payload.decode("utf-8").splitlines()
    assert len(lines) == 2

    front0, back0, tags0 = lines[0].split("\t")
    assert len(lines[0].split("\t")) == 3
    assert "\t" not in front0
    assert "\n" not in front0
    assert front0 == "What is this?"
    assert back0 == "A cell"
    assert tags0 == "bio unit-1"

    front1, back1, tags1 = lines[1].split("\t")
    assert front1 == "Second"
    assert back1 == "Answer"
    assert tags1 == ""


@pytest.mark.parametrize(
    "deck_bytes",
    [
        b"not json",
        json.dumps({"schema_version": 1, "course": "X", "cards": []}).encode("utf-8"),
    ],
)
def test_invalid_deck_raises_and_writes_nothing(deck_bytes: bytes) -> None:
    ctx = _FakeContext(deck_bytes)
    with pytest.raises(ValueError):
        _load_export_deck()(ctx)
    assert ctx.writes == []


def test_anki_export_source_has_no_arbor_worker() -> None:
    source = _PACKAGE_PY.read_text(encoding="utf-8")
    assert "arbor_worker" not in source
