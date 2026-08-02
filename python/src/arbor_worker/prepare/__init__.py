from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


class PrepareError(Exception):
    pass


@dataclass(frozen=True)
class PrepareResult:
    processing_path: str  # "pdf_images" | "pptx_text" | "pptx_images_fallback"
    image_paths: list[Path] = field(default_factory=list)
    text: str | None = None
    detail: dict = field(default_factory=dict)
