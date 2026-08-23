from __future__ import annotations

from arbor_worker.schemas.study.fixture import FixtureArtifact


class FixtureSkill:
    name = "fixture"

    def build_prompt(self, *, course: str, digest_text: str) -> str:
        return (
            "Return only JSON matching "
            f'{{"skill":"fixture","course":"{course}","ok":true}}.\n\n'
            f"Course digests:\n\n{digest_text}"
        )

    def validate(self, payload: dict) -> FixtureArtifact:
        return FixtureArtifact.model_validate(payload)
