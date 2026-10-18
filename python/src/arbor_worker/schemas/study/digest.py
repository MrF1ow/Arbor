from __future__ import annotations

from pathlib import Path


def is_bare_digest_filename(digest: str) -> bool:
    if "/" in digest or "\\" in digest:
        return False
    if digest in (".", ".."):
        return False
    return not Path(digest).is_absolute()


def normalize_study_digest(digest: str) -> str:
    if "digests/" in digest.replace("\\", "/"):
        return digest
    if is_bare_digest_filename(digest):
        return f"digests/{digest}"
    return digest
