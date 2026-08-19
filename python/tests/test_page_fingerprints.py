from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import fitz

from arbor_worker.page_fingerprints import fingerprint_source
from arbor_worker.prepare.pdf import render_pdf_to_images
from arbor_worker.settings import default_settings


def _settings(**overrides):
    settings = default_settings()
    for key, value in overrides.items():
        object.__setattr__(settings, key, value)
    return settings


def _pdf_with_texts(path: Path, texts: list[str]) -> Path:
    doc = fitz.open()
    for text in texts:
        page = doc.new_page()
        page.insert_text((72, 72), text)
    doc.save(str(path))
    doc.close()
    return path


def test_pdf_uses_image_kind_and_one_hash_per_page(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "deck.pdf", pages=3)
    result = fingerprint_source(src, _settings(pdf_render_dpi=72))
    assert result.kind == "pdf_image"
    assert len(result.fingerprints) == 3
    assert all(len(h) == 64 for h in result.fingerprints)
    assert len(set(result.fingerprints)) == 3


def test_pdf_fingerprints_hash_same_render_path_bytes(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "deck.pdf", pages=2)
    settings = _settings(pdf_render_dpi=72)
    out = tmp_path / "render"
    out.mkdir()
    images = render_pdf_to_images(src, out, dpi=72)
    expected = [hashlib.sha256(p.read_bytes()).hexdigest() for p in images]
    result = fingerprint_source(src, settings)
    assert result.kind == "pdf_image"
    assert result.fingerprints == expected


def test_pdf_fingerprint_twice_is_identical(make_pdf, tmp_path: Path):
    src = make_pdf(tmp_path / "deck.pdf", pages=3)
    settings = _settings(pdf_render_dpi=72)
    first = fingerprint_source(src, settings)
    second = fingerprint_source(src, settings)
    assert first.fingerprints == second.fingerprints
    assert first.kind == second.kind == "pdf_image"


def test_pdf_changing_one_page_changes_only_that_index(tmp_path: Path):
    src = tmp_path / "deck.pdf"
    settings = _settings(pdf_render_dpi=72)
    _pdf_with_texts(src, ["Alpha page", "Bravo page", "Charlie page"])
    first = fingerprint_source(src, settings)
    _pdf_with_texts(src, ["Alpha page", "Bravo CHANGED", "Charlie page"])
    second = fingerprint_source(src, settings)
    assert first.fingerprints[0] == second.fingerprints[0]
    assert first.fingerprints[1] != second.fingerprints[1]
    assert first.fingerprints[2] == second.fingerprints[2]


def test_text_rich_pptx_uses_text_kind(make_pptx, tmp_path: Path):
    slide_a = "The nervous system coordinates body activities. " * 8
    slide_b = "Mitochondria produce ATP for eukaryotic cells. " * 8
    src = make_pptx(tmp_path / "rich.pptx", [slide_a, slide_b])
    result = fingerprint_source(src)
    assert result.kind == "pptx_text"
    assert len(result.fingerprints) == 2
    assert result.fingerprints[0] != result.fingerprints[1]


def test_pptx_text_hashes_normalized_slide_text(make_pptx, tmp_path: Path):
    slide_a = "The nervous system coordinates body activities. " * 8
    slide_b = "Mitochondria produce ATP for eukaryotic cells. " * 8
    src = make_pptx(tmp_path / "rich.pptx", [slide_a, slide_b])
    result = fingerprint_source(src)

    def digest(text: str) -> str:
        return hashlib.sha256(" ".join(text.split()).encode()).hexdigest()

    assert result.fingerprints == [digest(slide_a), digest(slide_b)]


def test_pptx_text_change_only_that_index(make_pptx, tmp_path: Path):
    prefix = "Lecture notes on cell biology and metabolism. " * 8
    src = make_pptx(tmp_path / "deck.pptx", [prefix + "A", prefix + "B", prefix + "C"])
    first = fingerprint_source(src)
    make_pptx(src, [prefix + "A", prefix + "B-changed", prefix + "C"])
    second = fingerprint_source(src)
    assert first.kind == second.kind == "pptx_text"
    assert first.fingerprints[0] == second.fingerprints[0]
    assert first.fingerprints[1] != second.fingerprints[1]
    assert first.fingerprints[2] == second.fingerprints[2]


def test_thin_pptx_falls_back_to_image_kind(make_pptx, make_pdf, tmp_path: Path):
    src = make_pptx(tmp_path / "thin.pptx", ["hi", "yo"])
    settings = _settings(pptx_min_chars=200, pdf_render_dpi=72)

    def fake_which(name: str) -> str | None:
        return "/usr/bin/soffice" if name in ("soffice", "libreoffice") else None

    def fake_runner(cmd, capture_output=True, text=True):
        out_dir = Path(cmd[cmd.index("--outdir") + 1])
        source = Path(cmd[-1])
        make_pdf(out_dir / f"{source.stem}.pdf", pages=2, text="Thin")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    result = fingerprint_source(src, settings, runner=fake_runner, which=fake_which)
    assert result.kind == "pptx_image"
    assert len(result.fingerprints) == 2
    assert result.fingerprints[0] != result.fingerprints[1]
    assert all(len(h) == 64 for h in result.fingerprints)
