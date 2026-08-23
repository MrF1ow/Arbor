from __future__ import annotations

import contextlib
import io
import json
import subprocess
from pathlib import Path

from arbor_worker import cli
from arbor_worker.events import parse_lines
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.skills import SKILLS
from arbor_worker.skills.concepts import ConceptsSkill
from arbor_worker.skills.diagrams import DiagramsSkill


def _source(digest: str = "digests/2026-08-15.md", heading: str | None = "Figures") -> dict:
    source = {"digest": digest}
    if heading is not None:
        source["heading"] = heading
    return source


def _node(name: str, *, kind: str | None = None, node_id: str | None = None) -> dict:
    node = {
        "name": name,
        "summary": f"{name} summary.",
        "sources": [_source()],
    }
    if kind is not None:
        node["kind"] = kind
    if node_id is not None:
        node["id"] = node_id
    return node


def _graph(*nodes: dict) -> dict:
    return {
        "schema_version": 1,
        "course": "Biology",
        "nodes": list(nodes),
        "edges": [],
    }


def _write_digest(root: Path) -> None:
    digest = root / "Biology" / "digests" / "2026-08-15.md"
    digest.parent.mkdir(parents=True, exist_ok=True)
    digest.write_text("# Cells\n\nCells divide.\n")


def _seed_text_concepts(root: Path) -> None:
    study = root / "Biology" / "study"
    study.mkdir(parents=True, exist_ok=True)
    graph = ConceptsSkill().validate(_graph(_node("Glycolysis")))
    (study / "concepts.json").write_text(
        json.dumps(graph.model_dump(mode="json", by_alias=True), indent=2) + "\n"
    )


def _run_generate(root: Path, skill: str = "diagrams", *extra: str) -> tuple[int, list[dict]]:
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
                skill,
                "--provider",
                "fake",
                *extra,
            ]
        )
    return code, parse_lines(out.getvalue())


def _fake_figure() -> str:
    return json.dumps(_graph(_node("Mitochondrion diagram", kind="figure")))


def test_validate_forces_figure_kind_and_fig_prefix():
    graph = DiagramsSkill().validate(_graph(_node("Krebs cycle", node_id="junk")))

    assert graph.nodes[0].kind == "figure"
    assert graph.nodes[0].id == "fig-krebs-cycle"
    assert graph.nodes[0].id != "junk"


def test_validate_allows_empty_figures():
    graph = DiagramsSkill().validate(_graph())

    assert graph.nodes == []
    assert graph.course == "Biology"


def test_generate_merges_figure_into_existing_concepts(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    _seed_text_concepts(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _fake_figure())

    code, events = _run_generate(git_repo)

    assert code == 0
    artifact = json.loads((git_repo / "Biology" / "study" / "concepts.json").read_text())
    by_id = {node["id"]: node for node in artifact["nodes"]}
    assert "glycolysis" in by_id
    assert by_id["glycolysis"].get("kind", "concept") == "concept"
    assert by_id["fig-mitochondrion-diagram"]["kind"] == "figure"
    assert not (git_repo / "Biology" / "study" / "figures.json").exists()
    assert not (git_repo / "Biology" / "study" / "diagrams.json").exists()
    manifest = json.loads((git_repo / "Biology" / "study" / "manifest.json").read_text())
    assert manifest["artifacts"]["diagrams"]["file"] == "concepts.json"
    assert "skill_done" in [event["type"] for event in events]


def test_empty_figures_is_success_and_leaves_concepts(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    _seed_text_concepts(git_repo)
    prior = (git_repo / "Biology" / "study" / "concepts.json").read_bytes()
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(_graph()))

    code, events = _run_generate(git_repo)

    assert code == 0
    assert (git_repo / "Biology" / "study" / "concepts.json").read_bytes() == prior
    assert not (git_repo / "Biology" / "study" / "figures.json").exists()
    assert "skill_done" in [event["type"] for event in events]
    subject = subprocess.run(
        ["git", "-C", str(git_repo), "log", "-1", "--pretty=%s"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.strip()
    assert subject == "study: Biology diagrams"


def test_generate_passes_prepare_cache_images(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    cache = git_repo / "_arbor_cache" / "src-hash"
    cache.mkdir(parents=True)
    image = cache / "page-00001.png"
    image.write_bytes(b"png-bytes")
    calls = []

    class Capture(FakeProvider):
        def run(self, request):
            calls.append(request)
            return super().run(request)

    monkeypatch.setattr(
        "arbor_worker.commands.FakeProvider",
        lambda markdown: Capture(markdown),
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", _fake_figure())

    code, _ = _run_generate(git_repo)

    assert code == 0
    assert calls
    assert image.resolve() in [path.resolve() for path in calls[0].image_paths]
    assert image.name in SKILLS["diagrams"].build_prompt(
        course="Biology",
        digest_text="x",
        image_paths=[image],
    )


def test_concepts_refresh_keeps_figure_nodes(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    _seed_text_concepts(git_repo)
    monkeypatch.setenv("ARBOR_FAKE_MD", _fake_figure())
    first_code, _ = _run_generate(git_repo)
    assert first_code == 0
    monkeypatch.setenv(
        "ARBOR_FAKE_MD",
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "nodes": [
                    {
                        "name": "Pyruvate",
                        "summary": "Three-carbon product.",
                        "sources": [_source("digests/2026-08-15.md", "Cells")],
                    }
                ],
                "edges": [],
            }
        ),
    )

    code, _ = _run_generate(git_repo, "concepts", "--force")

    assert code == 0
    artifact = json.loads((git_repo / "Biology" / "study" / "concepts.json").read_text())
    by_id = {node["id"]: node for node in artifact["nodes"]}
    assert "pyruvate" in by_id
    assert by_id["fig-mitochondrion-diagram"]["kind"] == "figure"
