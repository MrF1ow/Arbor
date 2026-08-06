from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF

from arbor_worker.prepare import PrepareError


def render_pdf_to_images(source: Path, out_dir: Path, dpi: int = 150) -> list[Path]:
    doc = fitz.open(str(source))
    try:
        if doc.page_count == 0:
            raise PrepareError(f"PDF has no pages: {source.name}")
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        images: list[Path] = []
        for index in range(doc.page_count):
            page = doc.load_page(index)
            pix = page.get_pixmap(matrix=matrix)
            out = out_dir / f"page-{index + 1:05d}.png"
            pix.save(str(out))
            images.append(out)
    finally:
        doc.close()
    if not images:
        raise PrepareError(f"PDF produced no images: {source.name}")
    return sorted(images)
