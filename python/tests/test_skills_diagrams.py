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
from arbor_worker.skills.diagrams import DiagramsSkill, cached_page_images, merge_figures


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


def _edge(from_id: str, to_id: str, *, relation: str = "illustrates") -> dict:
    return {
        "from": from_id,
        "to": to_id,
        "relation": relation,
        "sources": [_source()],
    }


def _graph(*nodes: dict, edges: list[dict] | None = None) -> dict:
    return {
        "schema_version": 1,
        "course": "Biology",
        "nodes": list(nodes),
        "edges": edges or [],
    }


def _write_course_hashes(root: Path, course: str, *hashes: str) -> None:
    course_dir = root / course
    course_dir.mkdir(parents=True, exist_ok=True)
    (course_dir / "arbor-course.json").write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {"source_path": f"sources/{source_hash}.pdf", "source_hash": source_hash}
                    for source_hash in hashes
                ],
            }
        )
        + "\n"
    )


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


def test_cached_page_images_skips_other_courses(tmp_path: Path):
    bio = tmp_path / "_arbor_cache" / "bio-hash" / "page-00001.png"
    chem = tmp_path / "_arbor_cache" / "chem-hash" / "page-00001.png"
    bio.parent.mkdir(parents=True)
    chem.parent.mkdir(parents=True)
    bio.write_bytes(b"bio")
    chem.write_bytes(b"chem")
    _write_course_hashes(tmp_path, "Biology", "bio-hash")
    _write_course_hashes(tmp_path, "Chemistry", "chem-hash")

    images = cached_page_images(tmp_path, "_arbor_cache", tmp_path / "Biology")

    assert [path.resolve() for path in images] == [bio.resolve()]


def test_validate_keeps_edges_linking_figures_to_topics():
    graph = DiagramsSkill().validate(
        _graph(
            _node("Mitochondrion diagram", kind="figure"),
            edges=[_edge("mitochondrion-diagram", "glycolysis")],
        )
    )

    assert [(edge.from_, edge.to, edge.relation) for edge in graph.edges] == [
        ("fig-mitochondrion-diagram", "glycolysis", "illustrates")
    ]


def test_merge_figures_keeps_link_to_existing_concept():
    existing = ConceptsSkill().validate(_graph(_node("Glycolysis")))
    figures = DiagramsSkill().validate(
        _graph(
            _node("Mitochondrion diagram", kind="figure"),
            edges=[_edge("fig-mitochondrion-diagram", "glycolysis")],
        )
    )

    merged = merge_figures(existing, figures)
    pairs = {(edge.from_, edge.to) for edge in merged.edges}

    assert ("fig-mitochondrion-diagram", "glycolysis") in pairs


def test_generate_passes_prepare_cache_images(git_repo: Path, monkeypatch):
    _write_digest(git_repo)
    _write_course_hashes(git_repo, "Biology", "src-hash")
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
    monkeypatch.setenv(
        "ARBOR_FAKE_MD",
        json.dumps(
            _graph(
                _node("Mitochondrion diagram", kind="figure"),
                edges=[_edge("fig-mitochondrion-diagram", "glycolysis")],
            )
        ),
    )
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
                        "name": "Glycolysis",
                        "summary": "Cytoplasmic breakdown of glucose to pyruvate.",
                        "sources": [_source("digests/2026-08-15.md", "Cells")],
                    },
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
    pairs = {(edge["from"], edge["to"]) for edge in artifact["edges"]}
    assert ("fig-mitochondrion-diagram", "glycolysis") in pairs
