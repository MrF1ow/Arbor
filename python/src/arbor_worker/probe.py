from __future__ import annotations

from pathlib import Path

from arbor_worker.errors import ProbeError


def count_pages(source: Path, source_type: str) -> int:
    source = Path(source)
    if source_type == "pdf":
        import fitz  # PyMuPDF

        doc = fitz.open(str(source))
        try:
            return int(doc.page_count)
        finally:
            doc.close()
    if source_type == "pptx":
        from pptx import Presentation

        return len(Presentation(str(source)).slides)
    raise ProbeError(f"Unsupported source type: {source_type}")
