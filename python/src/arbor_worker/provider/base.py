from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from collections.abc import Callable
from typing import Protocol, runtime_checkable

DeltaFn = Callable[[str], None]


class ProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        kind: str = "unknown",
        exit_code: int | None = None,
        summary: str | None = None,
        detail: str = "",
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.exit_code = exit_code
        self.summary = message if summary is None else summary
        self.detail = detail

    def event_fields(self) -> dict[str, object]:
        fields: dict[str, object] = {"kind": self.kind}
        if self.exit_code is not None:
            fields["exit_code"] = self.exit_code
        return fields


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
    system: str | None = None


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
class Provider(Protocol):
    name: str

    def status(self) -> ProviderStatus: ...

    def is_available(self) -> bool: ...

    def list_models(self) -> list[Model]: ...

    def run(self, request: ProviderRequest) -> ProviderResult: ...


def supports_stream(provider: object) -> bool:
    return callable(getattr(provider, "stream", None))


CliProvider = Provider
