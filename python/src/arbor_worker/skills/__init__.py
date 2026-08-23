from arbor_worker.skills.base import StudySkill
from arbor_worker.skills.citations import CitationsSkill
from arbor_worker.skills.concepts import ConceptsSkill
from arbor_worker.skills.diagrams import DiagramsSkill
from arbor_worker.skills.fixture import FixtureSkill
from arbor_worker.skills.flashcards import FlashcardsSkill
from arbor_worker.skills.quiz import QuizSkill


SKILLS: dict[str, StudySkill] = {
    "fixture": FixtureSkill(),
    "flashcards": FlashcardsSkill(),
    "quiz": QuizSkill(),
    "concepts": ConceptsSkill(),
    "diagrams": DiagramsSkill(),
    "citations": CitationsSkill(),
}

