from __future__ import annotations

import contextlib
import hashlib
import io
import json
import subprocess
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.events import parse_lines
from arbor_worker.skills import SKILLS
from tests.ui_overhaul_fixtures import (
    FAKE_FLASHCARDS_INTRO_JSON,
    FAKE_FLASHCARDS_JSON,
    FAKE_QUIZ_INTRO_JSON,
    build_ui_overhaul_root,
)


def _run_generate(root: Path, *extra: str, env: dict | None = None) -> tuple[int, list[dict]]:
    out = io.StringIO()
    argv = [
        "generate",
        "--root",
        str(root),
        "--course",
        "Bio",
        "--skill",
        "flashcards",
        "--provider",
        "fake",
        *extra,
    ]
    with contextlib.redirect_stdout(out):
        if env:
            import os

            for key, value in env.items():
                os.environ[key] = value
            try:
                code = cli.main(argv)
            finally:
                for key in env:
                    os.environ.pop(key, None)
        else:
            code = cli.main(argv)
    return code, parse_lines(out.getvalue())


def _manifest_bytes(root: Path) -> bytes:
    return (root / "Bio" / "study" / "manifest.json").read_bytes()


def _deck_ids(root: Path) -> list[str]:
    deck = json.loads((root / "Bio" / "study" / "flashcards.json").read_text())
    return [card["id"] for card in deck["cards"]]


def _origins(root: Path) -> dict[str, str]:
    path = root / "Bio" / "study" / "origins.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text())["items"]


def test_scoped_fake_run_preserves_cards_adds_and_leaves_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    prior_ids = set(_deck_ids(root))
    manifest_before = _manifest_bytes(root)
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)

    code, events = _run_generate(
        root,
        "--digests",
        "Bio/digests/intro.md",
    )

    assert code == 0
    done = next(e for e in events if e["type"] == "skill_done")
    added = done["added_ids"]
    assert added
    after_ids = _deck_ids(root)
    assert prior_ids.issubset(set(after_ids))
    assert set(added).issubset(set(after_ids))
    assert _manifest_bytes(root) == manifest_before
    assert _origins(root)[added[0]] == "scoped"


def test_scoped_without_manifest_succeeds_then_full_generate_not_stale(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    manifest = root / "Bio" / "study" / "manifest.json"
    manifest.unlink()
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(root), "commit", "-q", "-m", "drop manifest"],
        check=True,
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)

    code, events = _run_generate(
        root,
        "--digests",
        "Bio/digests/intro.md",
        "--no-commit",
    )
    assert code == 0
    assert not manifest.exists()
    commit_paths = next(e for e in events if e["type"] == "commit_paths")
    paths = commit_paths["paths"]
    assert "Bio/study/manifest.json" not in paths
    assert any(p.endswith("flashcards.json") for p in paths)
    assert any(p.endswith("origins.json") for p in paths)

    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_JSON)
    code2, events2 = _run_generate(root, "--force")
    assert code2 == 0
    assert "skill_stale_skipped" not in [e["type"] for e in events2]


def test_full_generate_keeps_scoped_and_manual_drops_deleted_digest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    _, scoped_events = _run_generate(root, "--digests", "Bio/digests/intro.md")
    intro_scoped_id = next(
        e for e in scoped_events if e["type"] == "skill_done"
    )["added_ids"][0]

    from arbor_worker.append_card import append_flashcard

    manual = append_flashcard(
        root,
        "Bio",
        "Manual?",
        "Manual.",
        "digests/unit-2.md",
        heading="Unit 2",
    )

    # First full run establishes a replaceable full-origin card on intro.
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    _run_generate(root, "--force")

    reworded_obj = json.loads(FAKE_FLASHCARDS_INTRO_JSON)
    reworded_obj["cards"][0]["front"] = "What is life reworded?"
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(reworded_obj))
    _run_generate(root, "--force")

    deck = json.loads((root / "Bio" / "study" / "flashcards.json").read_text())
    fronts = [c["front"] for c in deck["cards"]]
    assert fronts.count("What is life reworded?") == 1
    assert manual["id"] in {c["id"] for c in deck["cards"]}
    assert intro_scoped_id in {c["id"] for c in deck["cards"]}

    (root / "Bio" / "digests" / "unit-2.md").unlink()
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    _run_generate(root, "--force")
    deck2 = json.loads((root / "Bio" / "study" / "flashcards.json").read_text())
    assert manual["id"] not in {c["id"] for c in deck2["cards"]}
    assert manual["id"] not in {c["id"] for c in deck2["cards"]}


def test_digest_form_matches_full_run_ids_and_rejects_foreign_class(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    expected = SKILLS["flashcards"].validate(json.loads(FAKE_FLASHCARDS_INTRO_JSON)).cards[0].id
    code, events = _run_generate(root, "--digests", "Bio/digests/intro.md")
    assert code == 0
    scoped_id = next(e for e in events if e["type"] == "skill_done")["added_ids"][0]
    assert scoped_id == expected

    code_bad, events_bad = _run_generate(
        root,
        "--digests",
        "Chem/digests/periodic.md",
    )
    assert code_bad == 1
    assert events_bad[-1]["type"] == "skill_failed"

    code_missing, _ = _run_generate(root, "--digests", "Bio/digests/missing.md")
    assert code_missing == 1


def test_viewer_scoped_generate_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from tests.test_library_roles import _init_repo, _isolated_git_env, _library_doc, _run_cli

    _isolated_git_env(monkeypatch, tmp_path)
    viewer = "viewer@test.local"
    owner = "owner@test.local"
    root = _init_repo(tmp_path, viewer, with_library=_library_doc(owner=owner, viewer=viewer))
    bio = root / "Biology"
    bio.mkdir()
    digest = bio / "digests"
    digest.mkdir(parents=True)
    (digest / "a.md").write_text("# A\n")
    (bio / "study").mkdir()
    (bio / "study" / "flashcards.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "course": "Biology",
                "cards": [
                    {
                        "id": "fc_x",
                        "front": "Q",
                        "back": "A",
                        "source": {"digest": "digests/a.md"},
                    }
                ],
            }
        )
        + "\n"
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON.replace("Bio", "Biology"))
    code, out, err = _run_cli(
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
            "--digests",
            "Biology/digests/a.md",
        ]
    )
    assert code == 1
    combined = out + err
    assert "skill_failed" in combined
    assert "viewer" in combined.lower()


def test_quiz_scoped_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_QUIZ_INTRO_JSON)
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
                "quiz",
                "--provider",
                "fake",
                "--digests",
                "Bio/digests/intro.md",
            ]
        )
    assert code == 0
    pack = json.loads((root / "Bio" / "study" / "quiz.json").read_text())
    assert pack["questions"]


def test_full_with_digests_behaves_as_full_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    manifest = root / "Bio" / "study" / "manifest.json"
    manifest_before = manifest.read_bytes()
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
                "--digests",
                "Bio/digests/intro.md",
                "--full",
                "--force",
            ]
        )
    assert code == 0
    assert manifest.read_bytes() != manifest_before
    assert _origins(root)


def test_digest_list_rejects_path_traversal(tmp_path: Path):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    code, events = _run_generate(root, "--digests", "Bio/digests/../intro.md")
    assert code == 1
    assert events[-1]["type"] == "skill_failed"


def _run_generate_skill(
    root: Path, skill: str, *extra: str, env: dict | None = None
) -> tuple[int, list[dict]]:
    out = io.StringIO()
    argv = [
        "generate",
        "--root",
        str(root),
        "--course",
        "Bio",
        "--skill",
        skill,
        "--provider",
        "fake",
        *extra,
    ]
    with contextlib.redirect_stdout(out):
        if env:
            import os

            for key, value in env.items():
                os.environ[key] = value
            try:
                code = cli.main(argv)
            finally:
                for key in env:
                    os.environ.pop(key, None)
        else:
            code = cli.main(argv)
    return code, parse_lines(out.getvalue())


def _quiz_ids(root: Path) -> list[str]:
    pack = json.loads((root / "Bio" / "study" / "quiz.json").read_text())
    return [q["id"] for q in pack["questions"]]


def test_cross_skill_origins_flashcards_full_then_quiz_full(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from arbor_worker.append_card import append_flashcard

    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_QUIZ_INTRO_JSON)
    _, quiz_scoped = _run_generate_skill(
        root, "quiz", "--digests", "Bio/digests/intro.md"
    )
    quiz_scoped_id = next(e for e in quiz_scoped if e["type"] == "skill_done")["added_ids"][0]
    manual = append_flashcard(
        root, "Bio", "Manual?", "Manual.", "digests/unit-2.md", heading="Unit 2"
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    assert _run_generate_skill(root, "flashcards", "--force")[0] == 0
    assert _origins(root)[quiz_scoped_id] == "scoped"
    assert _origins(root)[manual["id"]] == "manual"

    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_QUIZ_INTRO_JSON)
    assert _run_generate_skill(root, "quiz", "--force")[0] == 0
    assert quiz_scoped_id in _quiz_ids(root)
    assert manual["id"] in _deck_ids(root)


def test_cross_skill_origins_quiz_full_then_flashcards_full(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from arbor_worker.append_card import append_flashcard

    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    _, fc_scoped = _run_generate(
        root, "--digests", "Bio/digests/intro.md"
    )
    fc_scoped_id = next(e for e in fc_scoped if e["type"] == "skill_done")["added_ids"][0]
    manual = append_flashcard(
        root, "Bio", "Manual?", "Manual.", "digests/unit-2.md", heading="Unit 2"
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_QUIZ_INTRO_JSON)
    assert _run_generate_skill(root, "quiz", "--force")[0] == 0
    assert _origins(root)[fc_scoped_id] == "scoped"
    assert _origins(root)[manual["id"]] == "manual"

    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    assert _run_generate(root, "--force")[0] == 0
    assert fc_scoped_id in _deck_ids(root)
    assert manual["id"] in _deck_ids(root)


def test_full_run_keeps_course_prefixed_digest_citation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    prefixed = json.loads(FAKE_FLASHCARDS_INTRO_JSON)
    prefixed["cards"][0]["source"]["digest"] = "Bio/digests/intro.md"
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(prefixed))
    code, events = _run_generate(root, "--force")
    assert code == 0
    assert events[-1]["type"] == "skill_done"
    deck = json.loads((root / "Bio" / "study" / "flashcards.json").read_text())
    assert any(c["source"]["digest"] == "Bio/digests/intro.md" for c in deck["cards"])


def test_corrupt_origins_scoped_skill_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    (root / "Bio" / "study" / "origins.json").write_text("{not json\n")
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    code, events = _run_generate(root, "--digests", "Bio/digests/intro.md")
    assert code == 1
    assert events[-1]["type"] == "skill_failed"


def test_scoped_run_without_matching_digest_citations_skill_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    wrong = json.loads(FAKE_FLASHCARDS_INTRO_JSON)
    wrong["cards"][0]["source"]["digest"] = "digests/unit-2.md"
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(wrong))
    code, events = _run_generate(root, "--digests", "Bio/digests/intro.md")
    assert code == 1
    assert events[-1]["type"] == "skill_failed"


def test_added_ids_follow_deck_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    batch = json.loads(FAKE_FLASHCARDS_INTRO_JSON)
    extra = json.loads(FAKE_FLASHCARDS_INTRO_JSON)
    extra["cards"][0]["front"] = "Second scoped?"
    extra["cards"][0]["back"] = "Second."
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(batch))
    _run_generate(root, "--digests", "Bio/digests/intro.md")
    monkeypatch.setenv("ARBOR_FAKE_MD", json.dumps(extra))
    _, events = _run_generate(root, "--digests", "Bio/digests/intro.md")
    added = next(e for e in events if e["type"] == "skill_done")["added_ids"]
    deck_ids = _deck_ids(root)
    assert added == [deck_ids[-1]]


def test_scoped_repeat_no_commit_emits_empty_commit_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    _run_generate(root, "--digests", "Bio/digests/intro.md")
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(root), "commit", "-q", "-m", "scoped once"],
        check=True,
    )
    code, events = _run_generate(
        root,
        "--digests",
        "Bio/digests/intro.md",
        "--no-commit",
    )
    assert code == 0
    paths = next(e for e in events if e["type"] == "commit_paths")["paths"]
    assert paths == []


def test_corrupt_origins_concepts_generate_ignores_origins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    fx = build_ui_overhaul_root(tmp_path)
    root = fx.root
    study = root / "Bio" / "study"
    study.mkdir(parents=True, exist_ok=True)
    (study / "origins.json").write_text("{not json\n")
    fake_graph = json.dumps(
        {
            "schema_version": 1,
            "course": "Bio",
            "nodes": [
                {
                    "id": "intro",
                    "name": "Intro",
                    "summary": "Welcome.",
                    "sources": [{"digest": "digests/intro.md", "heading": "Intro"}],
                }
            ],
            "edges": [],
        }
    )
    monkeypatch.setenv("ARBOR_FAKE_MD", fake_graph)
    code, events = _run_generate_skill(root, "concepts", "--force")
    assert code == 0
    assert events[-1]["type"] == "skill_done"
