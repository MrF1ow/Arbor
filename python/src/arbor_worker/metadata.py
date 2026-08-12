from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class Metadata:
    source_filename: str
    source_type: str
    source_hash: str
    processed_at: str
    provider: str
    model_id: str
    processing_path: str
    status: str
    generate_mode: str = "single"
    chunk_count: int | None = None
    chunk_size: int | None = None
    page_ranges: list[str] | None = None


def build_metadata(
    source: Path,
    source_type: str,
    source_hash: str,
    model_id: str,
    processing_path: str,
    *,
    generate_mode: str = "single",
    chunk_count: int | None = None,
    chunk_size: int | None = None,
    page_ranges: list[str] | None = None,
) -> Metadata:
    return Metadata(
        source_filename=source.name,
        source_type=source_type,
        source_hash=source_hash,
        processed_at=datetime.now(timezone.utc).isoformat(),
        provider="codex_cli",
        model_id=model_id,
        processing_path=processing_path,
        status="ok",
        generate_mode=generate_mode,
        chunk_count=chunk_count,
        chunk_size=chunk_size,
        page_ranges=page_ranges,
    )


def to_dict(meta: Metadata) -> dict:
    return asdict(meta)


def write_metadata(meta: Metadata, dest: Path) -> None:
    dest.write_text(json.dumps(to_dict(meta), indent=2) + "\n")
