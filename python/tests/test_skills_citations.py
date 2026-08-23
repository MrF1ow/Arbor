from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

from arbor_worker import cli
from arbor_worker.events import parse_lines
from arbor_worker.skills.citations import CitationsSkill, claim_in_digest


def _write_digest(root: Path, text: str = "# Cells\n\nCells divide.\n") -> None:
    digest = root / "Biology" / "digests" / "2026-08-15.md"
    digest.parent.mkdir(parents=True, exist_ok=True)
    digest.write_text(text)


def _write_json(root: Path, name: str, payload: dict) -> None:
    path = root / "Biology" / "study" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _run_generate(root: Path, *extra: str) -> tuple[int, list[dict]]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(
            [
                "generate",
                "--root",
                str(root),
                "--course",
                "Biology",
                "--skill",
                "citations",
                "--provider",
                "fake",
                *extra,
            ]
        )
    return code, parse_lines(out.getvalue())


def test_matching_claim_passes_invented_claim_fails():
    assert claim_in_digest("Cells divide.", "# Cells\n\nCells divide.\n")
    assert not claim_in_digest("Unicorns photosynthesize.", "# Cells\n\nCells divide.\n")


def test_generate_flags_bogus_card_only(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "flashcards.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": [
                {
                    "id": "fc_honest",
                    "front": "What do cells do?",
                    "back": "Cells divide.",
                    "tags": [],
                    "source": {
                        "digest": "digests/2026-08-15.md",
                        "heading": "Cells",
                    },
                },
                {
                    "id": "fc_bogus",
                    "front": "What about unicorns?",
                    "back": "Unicorns photosynthesize.",
                    "tags": [],
                    "source": {
                        "digest": "digests/2026-08-15.md",
                        "heading": "Cells",
                    },
                },
            ],
        },
    )
    prior = (git_repo / "Biology" / "study" / "flashcards.json").read_bytes()

    code, events = _run_generate(git_repo)

    assert code == 0
    assert (git_repo / "Biology" / "study" / "flashcards.json").read_bytes() == prior
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert [event["id"] for event in failed] == ["fc_bogus"]
    assert failed[0]["path"] == "study/flashcards.json"
    report = json.loads((git_repo / "Biology" / "study" / "citations.json").read_text())
    assert [item["id"] for item in report["failures"]] == ["fc_bogus"]
    assert "skill_done" in [event["type"] for event in events]


def test_missing_digest_fails_without_crash(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "flashcards.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": [
                {
                    "id": "fc_gone",
                    "front": "Missing source?",
                    "back": "Cells divide.",
                    "tags": [],
                    "source": {"digest": "digests/missing.md", "heading": "Cells"},
                }
            ],
        },
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert failed[0]["id"] == "fc_gone"
    assert failed[0]["reason"] == "missing digest"


def test_generate_flags_bogus_quiz_question(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "quiz.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "questions": [
                {
                    "id": "q_honest",
                    "type": "multiple_choice",
                    "prompt": "What do cells do?",
                    "choices": ["Divide", "Fly", "Sing", "Rust"],
                    "answer_index": 0,
                    "explanation": "Cells divide.",
                    "source": {
                        "digest": "digests/2026-08-15.md",
                        "heading": "Cells",
                    },
                },
                {
                    "id": "q_bogus",
                    "type": "multiple_choice",
                    "prompt": "What about unicorns?",
                    "choices": ["Photosynthesis", "Divide", "Fly", "Sing"],
                    "answer_index": 0,
                    "explanation": "Unicorns photosynthesize.",
                    "source": {
                        "digest": "digests/2026-08-15.md",
                        "heading": "Cells",
                    },
                },
            ],
        },
    )
    prior = (git_repo / "Biology" / "study" / "quiz.json").read_bytes()

    code, events = _run_generate(git_repo)

    assert code == 0
    assert (git_repo / "Biology" / "study" / "quiz.json").read_bytes() == prior
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert [event["id"] for event in failed] == ["q_bogus"]
    assert failed[0]["path"] == "study/quiz.json"


def test_missing_heading_fails_without_crash(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "flashcards.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": [
                {
                    "id": "fc_heading",
                    "front": "What do cells do?",
                    "back": "Cells divide.",
                    "tags": [],
                    "source": {
                        "digest": "digests/2026-08-15.md",
                        "heading": "Mitochondria",
                    },
                }
            ],
        },
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert failed[0]["id"] == "fc_heading"
    assert failed[0]["reason"] == "missing heading"


def test_figure_nodes_are_not_citation_checked(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "concepts.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "nodes": [
                {
                    "id": "fig-mitochondrion-diagram",
                    "name": "Mitochondrion diagram",
                    "summary": "Labeled organelle on slide 4.",
                    "kind": "figure",
                    "sources": [
                        {
                            "digest": "digests/2026-08-15.md",
                            "heading": "Cells",
                        }
                    ],
                }
            ],
            "edges": [],
        },
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    assert [event["type"] for event in events if event["type"] == "citation_failed"] == []
    report = json.loads((git_repo / "Biology" / "study" / "citations.json").read_text())
    assert report["failures"] == []


def test_digest_path_outside_course_is_missing(git_repo: Path):
    _write_digest(git_repo)
    (git_repo / "secret.md").write_text("Cells divide.\n")
    _write_json(
        git_repo,
        "flashcards.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "cards": [
                {
                    "id": "fc_escape",
                    "front": "What do cells do?",
                    "back": "Cells divide.",
                    "tags": [],
                    "source": {
                        "digest": "../secret.md",
                        "heading": "Cells",
                    },
                }
            ],
        },
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert failed[0]["id"] == "fc_escape"
    assert failed[0]["reason"] == "missing digest"


def test_concept_later_source_is_checked(git_repo: Path):
    _write_digest(git_repo)
    _write_json(
        git_repo,
        "concepts.json",
        {
            "schema_version": 1,
            "course": "Biology",
            "nodes": [
                {
                    "id": "glycolysis",
                    "name": "Glycolysis",
                    "summary": "Cells divide.",
                    "sources": [
                        {
                            "digest": "digests/2026-08-15.md",
                            "heading": "Cells",
                        },
                        {
                            "digest": "digests/missing.md",
                            "heading": "Later lecture",
                        },
                    ],
                }
            ],
            "edges": [],
        },
    )

    code, events = _run_generate(git_repo)

    assert code == 0
    failed = [event for event in events if event["type"] == "citation_failed"]
    assert [event["id"] for event in failed] == ["glycolysis"]
    assert failed[0]["reason"] == "missing digest"


def test_validate_accepts_empty_failures():
    report = CitationsSkill().validate(
        {"schema_version": 1, "course": "Biology", "failures": []}
    )
    assert report.failures == []
