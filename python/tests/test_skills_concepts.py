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


def _source(digest: str, heading: str | None = "Cells") -> dict:
    source = {"digest": digest}
    if heading is not None:
        source["heading"] = heading
    return source


def _node(
    name: str,
    *,
    digest: str = "digests/2026-08-15.md",
    heading: str | None = "Cells",
    summary: str | None = None,
    node_id: str | None = None,
    sources: list[dict] | None = None,
) -> dict:
    node = {
        "name": name,
        "summary": summary or f"{name} summary.",
        "sources": sources or [_source(digest, heading)],
    }
    if node_id is not None:
        node["id"] = node_id
    return node


def _edge(
    from_id: str,
    to_id: str,
    *,
    relation: str = "related to",
    digest: str = "digests/2026-08-15.md",
) -> dict:
    return {
        "from": from_id,
        "to": to_id,
        "relation": relation,
        "sources": [_source(digest)],
    }


def _graph(*nodes: dict, edges: list[dict] | None = None) -> dict:
    return {
        "schema_version": 1,
        "course": "Biology",
        "nodes": list(nodes),
        "edges": edges or [],
    }


def _write_digest(root: Path, name: str = "2026-08-15.md", text: str = "# Cells\n\nCells divide.\n") -> None:
    digest = root / "Biology" / "digests" / name
    digest.parent.mkdir(parents=True, exist_ok=True)
    digest.write_text(text)


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
                "concepts",
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


def _valid_fake_graph() -> str:
    return json.dumps(
        _graph(
            _node("Glycolysis", node_id="model-junk"),
            _node("Pyruvate"),
            edges=[_edge("glycolysis", "pyruvate", relation="produces")],
        )
    )


def _skill():
    return SKILLS["concepts"]


def test_validate_assigns_slug_ids_from_name_and_ignores_model_ids():
    skill = _skill()

    first = skill.validate(
        _graph(_node("  Citric   Acid Cycle  ", node_id="junk"))
    )
    same = skill.validate(_graph(_node("citric acid cycle")))

    assert first.nodes[0].id == "citric-acid-cycle"
    assert first.nodes[0].id != "junk"
    assert first.nodes[0].id == same.nodes[0].id


def test_validate_merges_duplicate_names_from_two_sources():
    graph = _skill().validate(
        _graph(
            _node("Glycolysis", digest="digests/2026-08-15.md", node_id="a"),
            _node("glycolysis", digest="digests/2026-08-16.md", node_id="b"),
        )
    )

    assert len(graph.nodes) == 1
    assert graph.nodes[0].id == "glycolysis"
    sources = {(source.digest, source.heading) for source in graph.nodes[0].sources}
    assert sources == {
        ("digests/2026-08-15.md", "Cells"),
        ("digests/2026-08-16.md", "Cells"),
    }


@pytest.mark.parametrize(
    "payload",
    [
        _graph(),
        _graph(_node("")),
        _graph(_node("Glycolysis", summary=" ")),
        _graph(
            _node("Glycolysis"),
            edges=[_edge("glycolysis", "pyruvate", relation="")],
        ),
        _graph(
            _node(
                "Glycolysis",
                sources=[{"digest": " ", "heading": "Cells"}],
            )
        ),
    ],
)
def test_validate_rejects_invalid_graphs(payload: dict):
    with pytest.raises((ValidationError, ValueError)):
        _skill().validate(payload)


def test_validate_rejects_unknown_and_self_edges():
    skill = _skill()

    with pytest.raises(ValueError, match="unknown"):
        skill.validate(
            _graph(
                _node("Glycolysis"),
                edges=[_edge("glycolysis", "missing")],
            )
        )
    with pytest.raises(ValueError, match="self"):
        skill.validate(
            _graph(
                _node("Glycolysis"),
                edges=[_edge("glycolysis", "glycolysis")],
            )
        )


def test_generate_writes_concepts_manifest_and_commit(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_graph())

    code, events = _run_generate(git_repo)

    assert code == 0
    artifact = json.loads(
        (git_repo / "Biology" / "study" / "concepts.json").read_text()
    )
    assert {node["id"] for node in artifact["nodes"]} == {"glycolysis", "pyruvate"}
    assert artifact["edges"][0]["from"] == "glycolysis"
    assert artifact["edges"][0]["to"] == "pyruvate"
    manifest = json.loads(
        (git_repo / "Biology" / "study" / "manifest.json").read_text()
    )
    assert manifest["artifacts"]["concepts"]["file"] == "concepts.json"
    subject = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--pretty=%s"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    assert subject == "study: Biology concepts"
    assert "skill_done" in [event["type"] for event in events]


def test_second_generate_skips_unchanged_digests(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_graph())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    prior_head = _head(git_repo)

    code, events = _run_generate(git_repo)

    assert code == 0
    assert [event["type"] for event in events] == ["skill_stale_skipped"]
    assert _head(git_repo) == prior_head


def test_force_regenerates_concepts(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _valid_fake_graph())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    prior_head = _head(git_repo)
    refreshed = _graph(
        _node("Glycolysis", node_id="different-junk"),
        _node("Pyruvate"),
        _node("ATP"),
        edges=[_edge("glycolysis", "pyruvate", relation="produces")],
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(refreshed))

    code, events = _run_generate(git_repo, "--force")

    artifact = json.loads(
        (git_repo / "Biology" / "study" / "concepts.json").read_text()
    )
    assert code == 0
    assert "skill_done" in [event["type"] for event in events]
    assert _head(git_repo) != prior_head
    assert {node["id"] for node in artifact["nodes"]} == {
        "glycolysis",
        "pyruvate",
        "atp",
    }


def test_invalid_json_leaves_prior_concepts_untouched(
    git_repo: Path, monkeypatch
):
    _write_digest(git_repo)
    artifact_path = git_repo / "Biology" / "study" / "concepts.json"
    artifact_path.parent.mkdir()
    artifact_path.write_bytes(b'{"prior":true}\n')
    prior = artifact_path.read_bytes()
    monkeypatch.setenv("ARBOR_FAKE_MD", "not json")

    code, events = _run_generate(git_repo)

    assert code == 1
    assert [event["type"] for event in events].count("skill_progress") == 2
    assert events[-1]["type"] == "skill_failed"
    assert artifact_path.read_bytes() == prior


def test_generate_splits_oversized_input_and_merges_duplicate_names(
    git_repo: Path, monkeypatch
):
    _write_digest(git_repo, text="a" * 100_001)
    _write_digest(git_repo, name="2026-08-16.md", text="# Mitosis\n")
    payloads = [
        _graph(
            _node("Glycolysis", digest="digests/2026-08-15.md", node_id="left"),
            _node("Pyruvate", digest="digests/2026-08-15.md"),
            edges=[
                _edge(
                    "glycolysis",
                    "pyruvate",
                    relation="produces",
                    digest="digests/2026-08-15.md",
                )
            ],
        ),
        _graph(
            _node("Glycolysis", digest="digests/2026-08-16.md", node_id="right"),
            _node("NADH", digest="digests/2026-08-16.md"),
            edges=[
                _edge(
                    "glycolysis",
                    "nadh",
                    relation="produces",
                    digest="digests/2026-08-16.md",
                )
            ],
        ),
    ]
    requests = []

    class CountingProvider:
        name = "counting"

        def run(self, request):
            payload = payloads[len(requests)]
            requests.append(request)
            return ProviderResult(markdown=json.dumps(payload))

    monkeypatch.setattr(
        "arbor_worker.commands.FakeProvider",
        lambda markdown: CountingProvider(),
    )

    code, _ = _run_generate(git_repo)

    assert code == 0
    assert len(requests) == 2
    artifact = json.loads(
        (git_repo / "Biology" / "study" / "concepts.json").read_text()
    )
    glycolysis = next(node for node in artifact["nodes"] if node["id"] == "glycolysis")
    assert {source["digest"] for source in glycolysis["sources"]} == {
        "digests/2026-08-15.md",
        "digests/2026-08-16.md",
    }
    assert {node["id"] for node in artifact["nodes"]} == {
        "glycolysis",
        "pyruvate",
        "nadh",
    }
    assert len(artifact["edges"]) == 2
