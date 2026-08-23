from arbor_worker.skills.base import StudySkill
from arbor_worker.skills.fixture import FixtureSkill


SKILLS: dict[str, StudySkill] = {
    "fixture": FixtureSkill(),
}

