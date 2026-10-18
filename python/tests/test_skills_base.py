import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from arbor_worker.provider.base import ProviderRequest, ProviderResult
from arbor_worker.skills.base import parse_and_validate, run_skill
from arbor_worker.skills.concepts import ConceptsSkill
from arbor_worker.skills.diagrams import DiagramsSkill
from arbor_worker.skills.fixture import FixtureSkill


class SequenceProvider:
    name = "sequence"

    def __init__(self, responses: list[str]):
        self._responses = iter(responses)
        self.calls: list[ProviderRequest] = []

    def run(self, request: ProviderRequest) -> ProviderResult:
        self.calls.append(request)
        return ProviderResult(markdown=next(self._responses))


@pytest.mark.parametrize(
    "payload",
    [
        {"course": "Biology", "ok": True},
        {"skill": "fixture", "course": "Biology", "ok": True, "extra": "no"},
    ],
)
def test_fixture_validation_rejects_broken_payloads(payload: dict):
    with pytest.raises(ValidationError):
        FixtureSkill().validate(payload)


def test_parse_and_validate_accepts_preamble_before_json_object():
    preamble = (
        "I'll inspect the course digests and page images so the figure graph "
        "only includes real lecture diagrams."
    )
    diagrams_body = json.dumps(
        {
            "schema_version": 1,
            "course": "Botany",
            "nodes": [
                {
                    "name": "Leaf cross-section",
                    "summary": "Diagram of leaf layers.",
                    "kind": "figure",
                    "sources": [{"digest": "digests/2026-08-15.md", "heading": "Figures"}],
                }
            ],
            "edges": [],
        },
        separators=(",", ":"),
    )
    concepts_body = json.dumps(
        {
            "schema_version": 1,
            "course": "Botany",
            "nodes": [
                {
                    "name": "Photosynthesis",
                    "summary": "Light-driven sugar synthesis.",
                    "sources": [{"digest": "digests/2026-08-15.md", "heading": "Cells"}],
                }
            ],
            "edges": [],
        },
        separators=(",", ":"),
    )

    diagrams = parse_and_validate(f"{preamble}{diagrams_body} trailing note", DiagramsSkill())
    concepts = parse_and_validate(f"{preamble}{concepts_body}", ConceptsSkill())

    assert diagrams.nodes[0].id == "fig-leaf-cross-section"
    assert concepts.nodes[0].id == "photosynthesis"


def test_parse_and_validate_rejects_empty_string():
    with pytest.raises(json.JSONDecodeError):
        parse_and_validate("", DiagramsSkill())


def test_fixture_validation_accepts_golden_payload():
    artifact = FixtureSkill().validate(
        {"skill": "fixture", "course": "Biology", "ok": True}
    )

    assert artifact.model_dump() == {
        "skill": "fixture",
        "course": "Biology",
        "ok": True,
    }


def test_run_skill_retries_json_failures_until_valid():
    provider = SequenceProvider(
        [
            "not json",
            '{"skill":',
            '{"skill":"fixture","course":"Biology","ok":true}',
        ]
    )
    request = ProviderRequest(prompt="fixture", model_id="fake-model")

    artifact = run_skill(provider, request, FixtureSkill())

    assert artifact.course == "Biology"
    assert len(provider.calls) == 3


def test_run_skill_failure_leaves_prior_artifact_untouched(tmp_path: Path):
    artifact_path = tmp_path / "fixture.json"
    artifact_path.write_bytes(b'{"prior":true}\n')
    prior = artifact_path.read_bytes()
    provider = SequenceProvider(["bad", "bad", "bad"])
    request = ProviderRequest(prompt="fixture", model_id="fake-model")

    with pytest.raises(ValueError):
        run_skill(provider, request, FixtureSkill())

    assert len(provider.calls) == 3
    assert artifact_path.read_bytes() == prior
