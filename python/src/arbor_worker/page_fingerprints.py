from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from arbor_worker.course_manifest import FingerprintKind
from arbor_worker.errors import ProbeError
from arbor_worker.hashing import hash_bytes
from arbor_worker.prepare.pdf import render_pdf_to_images
from arbor_worker.prepare.pptx import convert_pptx_to_pdf, extract_pptx_slide_texts
from arbor_worker.settings import WorkerSettings, default_settings
from arbor_worker.sources import classify


@dataclass(frozen=True)
class PageFingerprintResult:
    kind: FingerprintKind
    fingerprints: list[str]


def _normalize_text(text: str) -> str:
    return " ".join(text.split()).lower()


def _nonspace_len(text: str) -> int:
    return len("".join(text.split()))


def _hash_image_file(path: Path) -> str:
    return hash_bytes(path.read_bytes())


def fingerprint_pdf(source: Path, *, dpi: int = 150) -> PageFingerprintResult:
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        images = render_pdf_to_images(source, out_dir, dpi=dpi)
        return PageFingerprintResult(
            kind="pdf_image",
            fingerprints=[_hash_image_file(p) for p in images],
        )


def fingerprint_pptx(
    source: Path,
    settings: WorkerSettings | None = None,
    *,
    runner=subprocess.run,
    which=shutil.which,
) -> PageFingerprintResult:
    settings = settings or default_settings()
    slide_texts = extract_pptx_slide_texts(source)
    total_chars = sum(_nonspace_len(t) for t in slide_texts)
    if total_chars >= settings.pptx_min_chars:
        return PageFingerprintResult(
            kind="pptx_text",
            fingerprints=[
                hash_bytes(_normalize_text(text).encode("utf-8")) for text in slide_texts
            ],
        )

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        pdf = convert_pptx_to_pdf(source, out_dir, runner=runner, which=which)
        images = render_pdf_to_images(pdf, out_dir, dpi=settings.pdf_render_dpi)
        return PageFingerprintResult(
            kind="pptx_image",
            fingerprints=[_hash_image_file(p) for p in images],
        )


def fingerprint_source(
    source: Path,
    source_type: str | None = None,
    settings: WorkerSettings | None = None,
    *,
    runner=subprocess.run,
    which=shutil.which,
) -> PageFingerprintResult:
    source = Path(source)
    kind = source_type or classify(source)
    if kind is None:
        raise ProbeError(f"Unsupported source type for fingerprinting: {source.name}")
    settings = settings or default_settings()
    if kind == "pdf":
        return fingerprint_pdf(source, dpi=settings.pdf_render_dpi)
    if kind == "pptx":
        return fingerprint_pptx(source, settings, runner=runner, which=which)
    raise ProbeError(f"Unsupported source type: {kind}")
