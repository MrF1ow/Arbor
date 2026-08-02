from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

SUPPORTED_EXTS = {".pdf": "pdf", ".pptx": "pptx"}


@dataclass(frozen=True)
class LectureSource:
    path: Path        # relative to root
    lecture_dir: Path  # relative to root
    source_type: str


def classify(rel_path: Path) -> str | None:
    return SUPPORTED_EXTS.get(rel_path.suffix.lower())
