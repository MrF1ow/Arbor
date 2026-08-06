from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Model:
    id: str
    label: str


@dataclass(frozen=True)
class ProviderRequest:
    prompt: str
    model_id: str
    image_paths: list[Path] = field(default_factory=list)
    cwd: Path = field(default_factory=lambda: Path("."))


@dataclass(frozen=True)
class ProviderResult:
    markdown: str


@runtime_checkable
class CliProvider(Protocol):
    name: str

    def is_available(self) -> bool: ...

    def list_models(self) -> list[Model]: ...

    def run(self, request: ProviderRequest) -> ProviderResult: ...
