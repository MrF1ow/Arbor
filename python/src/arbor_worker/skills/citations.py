from __future__ import annotations

from pathlib import Path

from arbor_worker.schemas.study.citations import CitationFailure, CitationsReport
from arbor_worker.schemas.study.concepts import ConceptGraph
from arbor_worker.schemas.study.flashcards import FlashcardDeck
from arbor_worker.schemas.study.quiz import QuizPack


def normalize_claim(text: str) -> str:
    return " ".join(text.lower().split())


def digest_body(course_dir: Path, digest: str) -> str | None:
    path = course_dir / digest
    if not path.is_file():
        return None
    return path.read_text()


def claim_in_digest(claim: str, body: str) -> bool:
    needle = normalize_claim(claim)
    haystack = normalize_claim(body)
    if not needle:
        return False
    if needle in haystack:
        return True
    tokens = [token for token in needle.split() if len(token) > 3]
    return bool(tokens) and all(token in haystack for token in tokens)


def heading_in_digest(heading: str | None, body: str) -> bool:
    if heading is None or not heading.strip():
        return True
    return normalize_claim(heading) in normalize_claim(body)


class CitationsSkill:
    name = "citations"

    def build_prompt(self, *, course: str, digest_text: str) -> str:
        return (
            "Return only one JSON object with schema_version 1, the exact course "
            f'name "{course}", and a failures array. Citation checks run locally '
            "and ignore this prompt. Do not include markdown fences.\n\n"
            f"Course digests:\n\n{digest_text}"
        )

    def validate(self, payload: dict) -> CitationsReport:
        return CitationsReport.model_validate(payload)

    def verify(self, course_dir: Path, course: str) -> CitationsReport:
        failures: list[CitationFailure] = []
        failures.extend(_check_flashcards(course_dir))
        failures.extend(_check_quiz(course_dir))
        failures.extend(_check_concepts(course_dir))
        return CitationsReport(schema_version=1, course=course, failures=failures)


def _check_source(
    course_dir: Path, *, path: str, item_id: str, claim: str, digest: str, heading: str | None
) -> CitationFailure | None:
    body = digest_body(course_dir, digest)
    if body is None:
        return CitationFailure(path=path, id=item_id, reason="missing digest")
    if not heading_in_digest(heading, body):
        return CitationFailure(path=path, id=item_id, reason="missing heading")
    if not claim_in_digest(claim, body):
        return CitationFailure(path=path, id=item_id, reason="claim not in digest")
    return None


def _check_flashcards(course_dir: Path) -> list[CitationFailure]:
    path = course_dir / "study" / "flashcards.json"
    if not path.is_file():
        return []
    deck = FlashcardDeck.model_validate_json(path.read_text())
    failures: list[CitationFailure] = []
    for card in deck.cards:
        failure = _check_source(
            course_dir,
            path="study/flashcards.json",
            item_id=card.id,
            claim=card.back,
            digest=card.source.digest,
            heading=card.source.heading,
        )
        if failure is not None:
            failures.append(failure)
    return failures


def _check_quiz(course_dir: Path) -> list[CitationFailure]:
    path = course_dir / "study" / "quiz.json"
    if not path.is_file():
        return []
    pack = QuizPack.model_validate_json(path.read_text())
    failures: list[CitationFailure] = []
    for question in pack.questions:
        failure = _check_source(
            course_dir,
            path="study/quiz.json",
            item_id=question.id,
            claim=question.explanation,
            digest=question.source.digest,
            heading=question.source.heading,
        )
        if failure is not None:
            failures.append(failure)
    return failures


def _check_concepts(course_dir: Path) -> list[CitationFailure]:
    path = course_dir / "study" / "concepts.json"
    if not path.is_file():
        return []
    graph = ConceptGraph.model_validate_json(path.read_text())
    failures: list[CitationFailure] = []
    for node in graph.nodes:
        if not node.sources:
            failures.append(
                CitationFailure(
                    path="study/concepts.json",
                    id=node.id,
                    reason="missing digest",
                )
            )
            continue
        for source in node.sources:
            failure = _check_source(
                course_dir,
                path="study/concepts.json",
                item_id=node.id,
                claim=node.summary,
                digest=source.digest,
                heading=source.heading,
            )
            if failure is not None:
                failures.append(failure)
    return failures
