from pathlib import Path

from arbor_worker.schemas.study.concepts import ConceptNode, ConceptSource
from arbor_worker.schemas.study.flashcards import CardSource, Flashcard
from arbor_worker.skills.citations import digest_body


def test_digest_body_reads_digests_folder_for_bare_filename(tmp_path: Path):
    course = tmp_path / "Biology"
    digests = course / "digests"
    digests.mkdir(parents=True)
    (digests / "2026-10-17.md").write_text("# Cells\n\nMitochondria produce ATP.\n")

    body = digest_body(course, "2026-10-17.md")

    assert body is not None
    assert "Mitochondria produce ATP." in body


def test_digest_body_rejects_path_outside_course(tmp_path: Path):
    course = tmp_path / "Biology"
    course.mkdir()
    (tmp_path / "secret.md").write_text("outside\n")

    assert digest_body(course, "../secret.md") is None


def test_card_source_normalizes_bare_digest_filename():
    source = CardSource(digest="2026-10-17.md")
    assert source.digest == "digests/2026-10-17.md"


def test_card_source_leaves_prefixed_and_escape_paths():
    assert CardSource(digest="digests/2026-10-17.md").digest == "digests/2026-10-17.md"
    assert CardSource(digest="../secret.md").digest == "../secret.md"


def test_concept_source_normalizes_bare_digest_filename():
    node = ConceptNode(
        id="atp",
        name="ATP",
        summary="Cellular energy currency.",
        sources=[ConceptSource(digest="2026-10-17.md")],
    )
    assert node.sources[0].digest == "digests/2026-10-17.md"


def test_flashcard_model_normalizes_nested_source():
    card = Flashcard(
        front="What is ATP?",
        back="Energy currency.",
        source=CardSource(digest="2026-10-17.md"),
    )
    assert card.source.digest == "digests/2026-10-17.md"
