# Wave 4: Word and OCR

**Status:** planned (parallel after Wave 1)

## Goal

`.docx` and scanned PDFs ingest through the existing prepare → generate pipeline.

## PRs

| PR | Work | Verify |
|----|------|--------|
| 4.1 | Word prepare path | `.docx` digest + manifest |
| 4.2 | OCR fallback for low-text PDFs | Scanned PDF digest |
| 4.3 | Review UI labels for new types | `.docx` in review table |

## Files

- `python/src/arbor_worker/prepare/docx.py`
- `python/src/arbor_worker/prepare/pdf.py` (OCR branch)
- `python/src/arbor_worker/sources.py`
