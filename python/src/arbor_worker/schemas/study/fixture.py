from typing import Literal

from pydantic import BaseModel, ConfigDict


class FixtureArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill: Literal["fixture"]
    course: str
    ok: Literal[True]
