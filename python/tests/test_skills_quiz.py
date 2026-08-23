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


def _question(
    prompt: str,
    *,
    digest: str = "digests/2026-08-15.md",
    question_id: str | None = None,
    choices: list[str] | None = None,
    answer_index: int = 1,
    extra: dict | None = None,
) -> dict:
    question = {
        "type": "multiple_choice",
        "prompt": prompt,
        "choices": choices
        or ["Nucleus", "Cytoplasm", "Mitochondria", "Golgi"],
        "answer_index": answer_index,
        "explanation": f"Explanation for {prompt}",
        "source": {"digest": digest, "heading": "Cells"},
    }
    if question_id is not None:
        question["id"] = question_id
    if extra:
        question.update(extra)
    return question


def _pack(*questions: dict) -> dict:
    return {
        "schema_version": 1,
        "course": "Biology",
        "questions": list(questions),
    }


def _write_digests(root: Path) -> None:
    digest_dir = root / "Biology" / "digests"
    digest_dir.mkdir(parents=True)
    (digest_dir / "2026-08-15.md").write_text("# Cells\n\nCells divide.\n")
    (digest_dir / "2026-08-16.md").write_text("# Mitosis\n\nMitosis produces two cells.\n")


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
                "quiz",
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


def _valid_fake_pack(count: int = 10) -> str:
    return json.dumps(
        _pack(
            *[
                _question(f"Where does process {index} occur?", question_id="model-junk")
                for index in range(count)
            ]
        )
    )


def _skill():
    return SKILLS["quiz"]


def test_validate_assigns_stable_ids_and_ignores_model_ids():
    skill = _skill()

    first = skill.validate(
        _pack(_question("  Where   Does Glycolysis Occur?  ", question_id="junk"))
    )
    same = skill.validate(_pack(_question("where does glycolysis occur?")))
    different_digest = skill.validate(
        _pack(_question("where does glycolysis occur?", digest="digests/2026-08-16.md"))
    )

    assert first.questions[0].id.startswith("q_")
    assert len(first.questions[0].id) == 10
    assert first.questions[0].id != "junk"
    assert first.questions[0].id == same.questions[0].id
    assert first.questions[0].id != different_digest.questions[0].id


@pytest.mark.parametrize(
    "payload",
    [
        _pack(_question("")),
        _pack(_question("Where does glycolysis occur?", choices=["A", "B", "C"])),
        _pack(_question("Where does glycolysis occur?", answer_index=4)),
        _pack(_question("Where does glycolysis occur?", extra={"hint": "cytoplasm"})),
    ],
)
def test_validate_rejects_invalid_cards(payload: dict):
    with pytest.raises(ValidationError):
        _skill().validate(payload)


def test_validate_rejects_duplicate_normalized_prompts():
    with pytest.raises(ValueError, match="duplicate"):
        _skill().validate(
            _pack(
                _question("Where does glycolysis occur?"),
                _question("  where   DOES glycolysis occur?  "),
            )
        )


def test_generate_writes_quiz_manifest_and_commit(git_repo: Path, monkeypatch):
    _write_digests(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_pack())

    code, events = _run_generate(git_repo)

    assert code == 0
    artifact = json.loads((git_repo / "Biology" / "study" / "quiz.json").read_text())
    assert len(artifact["questions"]) >= 10
    assert all(question["id"].startswith("q_") for question in artifact["questions"])
    manifest = json.loads(
        (git_repo / "Biology" / "study" / "manifest.json").read_text()
    )
    assert manifest["artifacts"]["quiz"]["file"] == "quiz.json"
    subject = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--pretty=%s"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    assert subject == "study: Biology quiz"
    assert "skill_done" in [event["type"] for event in events]


def test_second_generate_skips_unchanged_digests(git_repo: Path, monkeypatch):
    _write_digests(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_pack())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    prior_head = _head(git_repo)

    code, events = _run_generate(git_repo)

    assert code == 0
    assert [event["type"] for event in events] == ["skill_stale_skipped"]
    assert _head(git_repo) == prior_head


def test_force_regenerates_with_stable_ids(git_repo: Path, monkeypatch):
    _write_digests(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_pack())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    artifact_path = git_repo / "Biology" / "study" / "quiz.json"
    first_ids = [
        question["id"] for question in json.loads(artifact_path.read_text())["questions"]
    ]

    refreshed = _pack(
        *[_question(f"Where does process {index} occur?", question_id="different-junk")
          for index in range(10)],
        _question("Where does meiosis occur?"),
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(refreshed))
    code, events = _run_generate(git_repo, "--force")
    second_ids = [
        question["id"] for question in json.loads(artifact_path.read_text())["questions"]
    ]

    assert code == 0
    assert "skill_done" in [event["type"] for event in events]
    assert second_ids[:10] == first_ids


def test_invalid_json_leaves_prior_quiz_untouched(git_repo: Path, monkeypatch):
    _write_digests(git_repo)
    artifact_path = git_repo / "Biology" / "study" / "quiz.json"
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
            return ProviderResult(markdown=_valid_fake_pack(2))

    monkeypatch.setattr(
        "arbor_worker.commands.FakeProvider",
        lambda markdown: CountingProvider(),
    )

    code, _ = _run_generate(git_repo)

    assert code == 0
    assert len(requests) == 2
    artifact = json.loads((git_repo / "Biology" / "study" / "quiz.json").read_text())
    assert len(artifact["questions"]) == 2
