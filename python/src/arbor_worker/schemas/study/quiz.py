from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from arbor_worker.schemas.study.flashcards import CardSource


class QuizQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = ""
    type: Literal["multiple_choice"]
    prompt: str
    choices: list[str] = Field(min_length=4, max_length=4)
    answer_index: int = Field(ge=0, le=3)
    explanation: str
    source: CardSource

    @field_validator("prompt", "explanation")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question text must not be blank")
        return value

    @field_validator("choices")
    @classmethod
    def choices_must_not_be_blank(cls, value: list[str]) -> list[str]:
        if any(not choice.strip() for choice in value):
            raise ValueError("choices must not be blank")
        return value


class QuizPack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    course: str
    questions: list[QuizQuestion] = Field(min_length=1)
