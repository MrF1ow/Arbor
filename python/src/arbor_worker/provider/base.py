from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class ProviderStatus:
    available: bool
    reason: str


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


def image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


@runtime_checkable
class CliProvider(Protocol):
    name: str

    def status(self) -> ProviderStatus: ...

    def is_available(self) -> bool: ...

    def list_models(self) -> list[Model]: ...

    def run(self, request: ProviderRequest) -> ProviderResult: ...
