from __future__ import annotations

import contextlib
import io
import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from arbor_worker import cli
from arbor_worker.events import parse_lines
from arbor_worker.provider.base import ProviderResult
from arbor_worker.skills import SKILLS


def _card(
    front: str,
    *,
    digest: str = "digests/2026-08-15.md",
    card_id: str | None = None,
) -> dict:
    card = {
        "front": front,
        "back": f"Answer for {front}",
        "tags": ["biology"],
        "source": {"digest": digest, "heading": "Cells"},
    }
    if card_id is not None:
        card["id"] = card_id
    return card


def _deck(*cards: dict) -> dict:
    return {
        "schema_version": 1,
        "course": "Biology",
        "cards": list(cards),
    }


def _write_digest(root: Path) -> None:
    digest = root / "Biology" / "digests" / "2026-08-15.md"
    digest.parent.mkdir(parents=True)
    digest.write_text("# Cells\n\nCells divide.\n")


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
                "flashcards",
                "--provider",
                "fake",
                *extra,
            ]
        )
    return code, parse_lines(out.getvalue())


def _head(root: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()


def _valid_fake_deck() -> str:
    return json.dumps(
        _deck(
            _card("What is a cell?", card_id="model-junk"),
            _card("What does mitosis produce?"),
        )
    )


def _skill():
    return SKILLS["flashcards"]


def test_validate_assigns_stable_ids_and_ignores_model_ids():
    skill = _skill()

    first = skill.validate(_deck(_card("  What   Is A Cell?  ", card_id="junk")))
    same = skill.validate(_deck(_card("what is a cell?")))
    different_digest = skill.validate(
        _deck(_card("what is a cell?", digest="digests/2026-08-16.md"))
    )

    assert first.cards[0].id.startswith("fc_")
    assert len(first.cards[0].id) == 11
    assert first.cards[0].id != "junk"
    assert first.cards[0].id == same.cards[0].id
    assert first.cards[0].id != different_digest.cards[0].id


@pytest.mark.parametrize(
    "payload",
    [
        _deck(),
        _deck(_card("")),
        _deck(
            {
                "front": "What is a cell?",
                "back": "The basic unit of life.",
                "source": {},
            }
        ),
    ],
)
def test_validate_rejects_invalid_cards(payload: dict):
    with pytest.raises(ValidationError):
        _skill().validate(payload)


def test_generate_writes_flashcards_manifest_and_commit(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_deck())

    code, events = _run_generate(git_repo)

    assert code == 0
    artifact = json.loads(
        (git_repo / "Biology" / "study" / "flashcards.json").read_text()
    )
    assert len(artifact["cards"]) == 2
    assert all(card["id"].startswith("fc_") for card in artifact["cards"])
    manifest = json.loads(
        (git_repo / "Biology" / "study" / "manifest.json").read_text()
    )
    assert manifest["artifacts"]["flashcards"]["file"] == "flashcards.json"
    subject = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--pretty=%s"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    assert subject == "study: Biology flashcards"
    assert "skill_done" in [event["type"] for event in events]


def test_second_generate_skips_unchanged_digests(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_deck())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    prior_head = _head(git_repo)

    code, events = _run_generate(git_repo)

    assert code == 0
    assert [event["type"] for event in events] == ["skill_stale_skipped"]
    assert _head(git_repo) == prior_head


def test_force_regenerates_with_stable_ids(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_deck())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    artifact_path = git_repo / "Biology" / "study" / "flashcards.json"
    first_ids = [card["id"] for card in json.loads(artifact_path.read_text())["cards"]]

    refreshed = _deck(
        _card("What is a cell?", card_id="different-junk"),
        _card("What does mitosis produce?"),
        _card("What is meiosis?"),
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(refreshed))
    code, events = _run_generate(git_repo, "--force")
    second_ids = [card["id"] for card in json.loads(artifact_path.read_text())["cards"]]

    assert code == 0
    assert "skill_done" in [event["type"] for event in events]
    assert second_ids[:2] == first_ids


def test_invalid_json_leaves_prior_flashcards_untouched(
    git_repo: Path, monkeypatch
):
    _write_digest(git_repo)
    artifact_path = git_repo / "Biology" / "study" / "flashcards.json"
    artifact_path.parent.mkdir()
    artifact_path.write_bytes(b'{"prior":true}\n')
    prior = artifact_path.read_bytes()
    monkeypatch.setenv("ARBOR_FAKE_MD", "not json")

    code, events = _run_generate(git_repo)

    assert code == 1
    assert [event["type"] for event in events].count("skill_progress") == 2
    assert events[-1]["type"] == "skill_failed"
    assert artifact_path.read_bytes() == prior


def test_generate_splits_oversized_input_per_digest_and_deduplicates(
    git_repo: Path, monkeypatch
):
    first = git_repo / "Biology" / "digests" / "2026-08-15.md"
    first.parent.mkdir(parents=True)
    first.write_text("a" * 100_001)
    (first.parent / "2026-08-16.md").write_text("# Mitosis\n")
    requests = []

    class CountingProvider:
        name = "counting"

        def run(self, request):
            requests.append(request)
            return ProviderResult(markdown=_valid_fake_deck())

    monkeypatch.setattr(
        "arbor_worker.commands.FakeProvider",
        lambda markdown: CountingProvider(),
    )

    code, _ = _run_generate(git_repo)

    assert code == 0
    assert len(requests) == 2
    artifact = json.loads(
        (git_repo / "Biology" / "study" / "flashcards.json").read_text()
    )
    assert len(artifact["cards"]) == 2
