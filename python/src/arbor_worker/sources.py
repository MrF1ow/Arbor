from __future__ import annotations

from pathlib import Path

SUPPORTED_EXTS = {".pdf": "pdf", ".pptx": "pptx"}


def classify(rel_path: Path) -> str | None:
    return SUPPORTED_EXTS.get(rel_path.suffix.lower())
