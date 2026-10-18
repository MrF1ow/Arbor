from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer

from arbor_worker.schemas.study.digest import normalize_study_digest


class CardSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    digest: str
    heading: str | None = None
    page: str | None = None

    @field_validator("digest")
    @classmethod
    def digest_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source.digest must not be blank")
        return normalize_study_digest(value)

    @model_serializer(mode="wrap")
    def _serialize(self, serializer):
        data = serializer(self)
        if data.get("page") is None:
            data.pop("page", None)
        return data


class Flashcard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = ""
    front: str
    back: str
    tags: list[str] = Field(default_factory=list)
    source: CardSource

    @field_validator("front", "back")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("card text must not be blank")
        return value


class FlashcardDeck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    course: str
    cards: list[Flashcard] = Field(min_length=1)
