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


from arbor_worker.cache import CacheDir
from arbor_worker.settings import WorkerSettings


def _nonspace_len(text: str) -> int:
    return len("".join(text.split()))


def prepare_source(
    source: Path,
    source_type: str,
    source_hash: str,
    cache: CacheDir,
    settings: WorkerSettings,
    *,
    on_warning=None,
    runner=None,
    which=None,
    force_images: bool = False,
) -> "PrepareResult":
    import shutil as _shutil
    import subprocess as _subprocess

    from arbor_worker.prepare.docx import extract_docx_text
    from arbor_worker.prepare.pdf import render_pdf_to_images
    from arbor_worker.prepare.pptx import (
        convert_pptx_to_pdf,
        extract_pptx_text,
    )

    runner = runner or _subprocess.run
    which = which or _shutil.which

    out_dir = cache.for_hash(source_hash)
    marker = cache.read_marker(source_hash)

    # Resume from cache if artifacts still exist.
    if marker is not None:
        path = marker.get("processing_path")
        if path == "pptx_text" and not force_images:
            text = (out_dir / "extract.txt")
            if text.is_file():
                return PrepareResult("pptx_text", text=text.read_text(), detail=marker)
        elif path == "docx_text":
            text = (out_dir / "extract.txt")
            if text.is_file():
                return PrepareResult("docx_text", text=text.read_text(), detail=marker)
        elif path != "pptx_text":
            images = sorted(out_dir.glob("page-*.png"))
            if images:
                return PrepareResult(path, image_paths=images, detail=marker)

    if source_type == "pdf":
        images = render_pdf_to_images(source, out_dir, dpi=settings.pdf_render_dpi)
        if on_warning and len(images) > settings.pdf_warn_pages:
            on_warning(f"{source.name}: {len(images)} pages; this may use significant quota")
        cache.write_marker(source_hash, {"processing_path": "pdf_images", "page_count": len(images)})
        return PrepareResult("pdf_images", image_paths=images, detail={"page_count": len(images)})

    if source_type == "pptx":
        if not force_images:
            text = extract_pptx_text(source)
            if _nonspace_len(text) >= settings.pptx_min_chars:
                (out_dir / "extract.txt").write_text(text)
                cache.write_marker(source_hash, {"processing_path": "pptx_text", "char_count": _nonspace_len(text)})
                return PrepareResult("pptx_text", text=text, detail={"char_count": _nonspace_len(text)})
        # Fallback: convert to PDF then render.
        pdf = convert_pptx_to_pdf(source, out_dir, runner=runner, which=which)
        images = render_pdf_to_images(pdf, out_dir, dpi=settings.pdf_render_dpi)
        if on_warning and len(images) > settings.pdf_warn_pages:
            on_warning(f"{source.name}: {len(images)} pages; this may use significant quota")
        cache.write_marker(source_hash, {"processing_path": "pptx_images_fallback", "page_count": len(images)})
        return PrepareResult("pptx_images_fallback", image_paths=images, detail={"page_count": len(images)})

    if source_type == "docx":
        text = extract_docx_text(source)
        if not text.strip():
            raise PrepareError(f"Word document has no extractable text: {source.name}")
        (out_dir / "extract.txt").write_text(text)
        cache.write_marker(source_hash, {"processing_path": "docx_text", "char_count": _nonspace_len(text)})
        return PrepareResult("docx_text", text=text, detail={"char_count": _nonspace_len(text)})

    raise PrepareError(f"Unsupported source type: {source_type}")
