from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ConceptSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    digest: str
    heading: str | None = None

    @field_validator("digest")
    @classmethod
    def digest_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source.digest must not be blank")
        return value


class ConceptNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = ""
    name: str
    summary: str
    kind: Literal["concept", "figure"] = "concept"
    sources: list[ConceptSource] = Field(default_factory=list)

    @field_validator("name", "summary")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("concept text must not be blank")
        return value


class ConceptEdge(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
    )

    from_: str = Field(alias="from")
    to: str
    relation: str
    sources: list[ConceptSource] = Field(default_factory=list)

    @field_validator("from_", "to", "relation")
    @classmethod
    def edge_text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("edge fields must not be blank")
        return value


class ConceptGraph(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)

    schema_version: Literal[1]
    course: str
    nodes: list[ConceptNode] = Field(min_length=1)
    edges: list[ConceptEdge] = Field(default_factory=list)
