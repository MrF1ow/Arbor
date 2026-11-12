from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.chat import _fts_match_expr, _fts_query, _fts_search
from arbor_worker.events import parse_lines
from arbor_worker.indexer import index_course, open_db, reindex_root
from tests.ui_overhaul_fixtures import FAKE_FLASHCARDS_INTRO_JSON, build_ui_overhaul_root


def _search_hits(
    root: Path,
    query: str,
    *,
    course: str | None = None,
    kinds: tuple[str, ...] | None = None,
    limit: int = 25,
):
    fts = _fts_query(query)
    assert fts is not None
    match_expr = _fts_match_expr(fts)
    clauses = ["search_index MATCH ?"]
    params: list[object] = [match_expr]
    if course is not None:
        clauses.append("course = ?")
        params.append(course)
    if kinds:
        placeholders = ",".join("?" for _ in kinds)
        clauses.append(f"kind IN ({placeholders})")
        params.extend(kinds)
    params.append(limit)
    conn = open_db(root)
    try:
        return conn.execute(
            f"""
            SELECT course, path, kind, title
            FROM search_index
            WHERE {' AND '.join(clauses)}
            ORDER BY rank
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
    finally:
        conn.close()


def _card_source() -> dict:
    return {"digest": "digests/intro.md", "heading": "Intro"}


def test_reindex_indexes_card_with_fragment_path(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    study = course / "study"
    study.mkdir(parents=True)
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "intro.md").write_text("# Intro\n\nWelcome.\n")
    (study / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "cards": [
                    {
                        "id": "fc_frontonly",
                        "front": "Zorbamax",
                        "back": "Rare word back",
                        "source": _card_source(),
                    }
                ],
            }
        )
        + "\n"
    )
    reindex_root(root)
    rows = _search_hits(root, "Zorbamax", course="Bio")
    card_rows = [r for r in rows if r[2] == "card"]
    assert len(card_rows) == 1
    assert card_rows[0][1] == "Bio/study/flashcards.json#fc_frontonly"
    assert card_rows[0][3] == "Zorbamax"


def test_chat_fts_ignores_many_matching_card_rows(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Biology"
    digests = course / "digests"
    study = course / "study"
    digests.mkdir(parents=True)
    study.mkdir(parents=True)
    (course / "course.md").write_text("# Biology\n\nOverview.\n")
    (digests / "lecture.md").write_text(
        "# Lecture\n\n## Pigments\n\nChlorophyll absorbs light.\n"
    )
    cards = []
    for i in range(10):
        cards.append(
            {
                "id": f"fc_noise_{i}",
                "front": f"Chlorophyll card {i}",
                "back": "Answer",
                "source": {"digest": "digests/lecture.md", "heading": "Pigments"},
            }
        )
    (study / "flashcards.json").write_text(
        json.dumps({"schema_version": 1, "course": "Biology", "cards": cards}) + "\n"
    )
    index_course(root, "Biology")
    hits = _fts_search(root, "Biology", "Chlorophyll", 8)
    assert hits
    assert all("digests/" in h["path"] for h in hits)


def test_chat_fts_prefers_digest_over_concept_rows_for_concept(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Biology"
    digests = course / "digests"
    study = course / "study"
    digests.mkdir(parents=True)
    study.mkdir(parents=True)
    (digests / "lecture.md").write_text(
        "# Lecture\n\n## Overview\nThis section discusses concept formation.\n"
    )
    nodes = []
    for i in range(30):
        nodes.append(
            {
                "id": f"c_{i}",
                "name": f"Concept label {i}",
                "summary": f"Noise concept {i}",
                "kind": "concept",
                "sources": [{"digest": "digests/lecture.md"}],
            }
        )
    (study / "concepts.json").write_text(
        json.dumps(
            {"schema_version": 1, "course": "Biology", "nodes": nodes, "edges": []}
        )
        + "\n"
    )
    index_course(root, "Biology")
    hits = _fts_search(root, "Biology", "concept", 8)
    assert hits
    assert any("digests/lecture.md" in h["path"] for h in hits)
    assert not any("/study/" in h["path"] for h in hits)


def test_search_hits_include_concept_rows(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Biology"
    study = course / "study"
    study.mkdir(parents=True)
    (course / "digests").mkdir(parents=True)
    (study / "concepts.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "nodes": [
                    {
                        "id": "c_findme",
                        "name": "Photosynthesis",
                        "summary": "Light reactions",
                        "kind": "concept",
                        "sources": [{"digest": "digests/intro.md"}],
                    }
                ],
                "edges": [],
            }
        )
        + "\n"
    )
    index_course(root, "Biology")
    rows = _search_hits(root, "Photosynthesis", course="Biology", kinds=("concept",))
    assert len(rows) == 1
    assert rows[0][1].endswith("#c_findme")


def test_reindex_drops_removed_cards(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    study = course / "study"
    study.mkdir(parents=True)
    deck = {
        "schema_version": 1,
        "course": "Bio",
        "cards": [
            {
                "id": "fc_keep",
                "front": "Keep",
                "back": "Stay",
                "source": _card_source(),
            },
            {
                "id": "fc_drop",
                "front": "Dropunique",
                "back": "Gone",
                "source": _card_source(),
            },
        ],
    }
    (study / "flashcards.json").write_text(json.dumps(deck) + "\n")
    index_course(root, "Bio")
    deck["cards"] = [c for c in deck["cards"] if c["id"] != "fc_drop"]
    (study / "flashcards.json").write_text(json.dumps(deck) + "\n")
    index_course(root, "Bio")
    conn = open_db(root)
    try:
        drop_rows = conn.execute(
            "SELECT path FROM search_index WHERE path = ?",
            ("Bio/study/flashcards.json#fc_drop",),
        ).fetchall()
        keep_rows = conn.execute(
            "SELECT path FROM search_index WHERE path = ?",
            ("Bio/study/flashcards.json#fc_keep",),
        ).fetchall()
    finally:
        conn.close()
    assert drop_rows == []
    assert len(keep_rows) == 1


def test_generate_reindexes_without_separate_reindex(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    conn = open_db(root)
    conn.execute("DELETE FROM search_index")
    conn.commit()
    conn.close()
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(
            [
                "generate",
                "--root",
                str(root),
                "--course",
                "Bio",
                "--skill",
                "flashcards",
                "--provider",
                "fake",
            ]
        )
    assert code == 0
    rows = _search_hits(root, "life", course="Bio", kinds=("card",))
    assert rows, parse_lines(out.getvalue())


def test_column_filter_ignores_course_path_kind_metadata(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    study = course / "study"
    study.mkdir(parents=True)
    (study / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "cards": [
                    {
                        "id": "fc_meta",
                        "front": "Unrelated front",
                        "back": "Unrelated back",
                        "source": _card_source(),
                    }
                ],
            }
        )
        + "\n"
    )
    index_course(root, "Bio")
    assert _search_hits(root, "Bio", course="Bio") == []
    assert _search_hits(root, "card", course="Bio") == []


def test_invalid_study_json_does_not_break_index(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    digests = course / "digests"
    study = course / "study"
    digests.mkdir(parents=True)
    study.mkdir(parents=True)
    (digests / "intro.md").write_text("# Intro\n\nHello.\n")
    (study / "flashcards.json").write_text("{not json\n")
    count = index_course(root, "Bio")
    assert count == 1
    conn = open_db(root)
    try:
        rows = conn.execute(
            "SELECT kind FROM search_index WHERE course = 'Bio'"
        ).fetchall()
    finally:
        conn.close()
    assert rows == [("digest",)]


def test_concept_figures_are_not_indexed(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    study = course / "study"
    study.mkdir(parents=True)
    (study / "concepts.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "nodes": [
                    {
                        "id": "fig_1",
                        "name": "Figurename",
                        "summary": "Diagram",
                        "kind": "figure",
                        "sources": [],
                    }
                ],
                "edges": [],
            }
        )
        + "\n"
    )
    index_course(root, "Bio")
    rows = _search_hits(root, "Figurename", course="Bio")
    assert rows == []


def _write_one_concept_class(root: Path, course_name: str, concept_name: str) -> None:
    course = root / course_name
    (course / "digests").mkdir(parents=True)
    (course / "study").mkdir(parents=True)
    (course / "study" / "concepts.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": course_name,
                "nodes": [
                    {
                        "id": "c_one",
                        "name": concept_name,
                        "summary": "Plain summary",
                        "kind": "concept",
                        "sources": [],
                    }
                ],
                "edges": [],
            }
        )
        + "\n"
    )


def test_multi_word_query_ignores_metadata_in_either_order(tmp_path: Path):
    root = tmp_path / "Knowledge"
    _write_one_concept_class(root, "Helix", "Light reactions")
    index_course(root, "Helix")
    # "concept" is only the kind, "Helix" only the course, "study" only in the path.
    for query in (
        "light concept",
        "concept light",
        "light Helix",
        "Helix light",
        "light study",
        "study light",
    ):
        assert _search_hits(root, query) == [], query
    assert len(_search_hits(root, "light reactions")) == 1


def test_chat_fts_multi_word_query_ignores_metadata(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Helix"
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "lecture.md").write_text(
        "# Lecture\n\n## Overview\nPlain words only.\n"
    )
    index_course(root, "Helix")
    assert _fts_search(root, "Helix", "plain digest", 8) == []
    assert _fts_search(root, "Helix", "digest plain", 8) == []
    assert _fts_search(root, "Helix", "plain Helix", 8) == []
    assert _fts_search(root, "Helix", "Helix plain", 8) == []
    assert _fts_search(root, "Helix", "plain words", 8)


def test_corrupt_manifest_does_not_abort_reindex(tmp_path: Path):
    root = tmp_path / "Knowledge"
    for name in ("Broken", "Fine"):
        digests = root / name / "digests"
        digests.mkdir(parents=True)
        (digests / "intro.md").write_text(f"# Intro {name}\n\nSomething.\n")
    (root / "Broken" / "study").mkdir()
    (root / "Broken" / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Broken",
                "cards": [
                    {
                        "id": "fc_b",
                        "front": "Brokenfront",
                        "back": "b",
                        "source": {"digest": "digests/intro.md", "heading": "Intro"},
                    }
                ],
            }
        )
        + "\n"
    )
    (root / "Broken" / "arbor-course.json").write_text(
        "<<<<<<< HEAD\n{not json\n=======\n>>>>>>> branch\n"
    )
    reindex_root(root)
    conn = open_db(root)
    try:
        courses = {r[0] for r in conn.execute("SELECT DISTINCT course FROM search_index")}
    finally:
        conn.close()
    assert courses == {"Broken", "Fine"}
    assert _search_hits(root, "Brokenfront", course="Broken", kinds=("card",))


def test_card_row_carries_source_path_and_page_range(tmp_path: Path):
    root = tmp_path / "Knowledge"
    course = root / "Bio"
    (course / "digests").mkdir(parents=True)
    (course / "study").mkdir(parents=True)
    (course / "digests" / "intro.md").write_text(
        "# Intro\n\n<!-- arbor-pages:3-5 -->\nBody.\n"
    )
    (course / "arbor-course.json").write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {"digest_file": "digests/intro.md", "source_path": "Bio/intro.pdf"}
                ],
            }
        )
    )
    (course / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Bio",
                "cards": [
                    {"id": "fc_src", "front": "Srcfront", "back": "b", "source": _card_source()}
                ],
            }
        )
        + "\n"
    )
    index_course(root, "Bio")
    conn = open_db(root)
    try:
        row = conn.execute(
            "SELECT page_range, source_path FROM search_index WHERE kind = 'card'"
        ).fetchone()
    finally:
        conn.close()
    assert row == ("3-5", "Bio/intro.pdf")
