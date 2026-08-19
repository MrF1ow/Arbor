from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import fitz  # PyMuPDF

from arbor_worker.prepare import PrepareError


def _page_text(page: fitz.Page) -> str:
    return page.get_text().strip()


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
            if len(_page_text(page)) < 20:
                ocr_path = _ocr_image_if_available(out)
                if ocr_path is not None:
                    out.unlink(missing_ok=True)
                    ocr_path.rename(out)
    finally:
        doc.close()
    if not images:
        raise PrepareError(f"PDF produced no images: {source.name}")
    return sorted(images)


def _ocr_image_if_available(image: Path) -> Path | None:
    tesseract = shutil.which("tesseract")
    if not tesseract:
        return None
    out_base = image.with_suffix("")
    txt_path = out_base.with_suffix(".txt")
    try:
        subprocess.run(
            [tesseract, str(image), str(out_base), "-l", "eng"],
            check=True,
            capture_output=True,
        )
        if not txt_path.is_file():
            return None
        text = txt_path.read_text(encoding="utf-8", errors="replace").strip()
        txt_path.unlink(missing_ok=True)
        if not text:
            return None
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), text[:4000])
        ocr_pdf = image.with_name(image.stem + "-ocr.pdf")
        doc.save(str(ocr_pdf))
        doc.close()
        ocr_doc = fitz.open(str(ocr_pdf))
        page = ocr_doc.load_page(0)
        pix = page.get_pixmap()
        ocr_png = image.with_name(image.stem + "-ocr.png")
        pix.save(str(ocr_png))
        ocr_doc.close()
        ocr_pdf.unlink(missing_ok=True)
        return ocr_png
    except (OSError, subprocess.CalledProcessError):
        txt_path.unlink(missing_ok=True)
        return None
