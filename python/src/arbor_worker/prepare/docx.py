from __future__ import annotations

from pathlib import Path

from docx import Document

from arbor_worker.prepare import PrepareError


def extract_docx_text(source: Path) -> str:
    doc = Document(str(source))
    parts: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def docx_page_count(source: Path) -> int:
    text = extract_docx_text(source)
    if not text.strip():
        return 1
    chunks = [c for c in text.split("\n\n") if c.strip()]
    return max(1, len(chunks))
