from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CitationFailure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    id: str
    reason: str

    @field_validator("path", "id", "reason")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("citation failure fields must not be blank")
        return value


class CitationsReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    course: str
    failures: list[CitationFailure] = Field(default_factory=list)
