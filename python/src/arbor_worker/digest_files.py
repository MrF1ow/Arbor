from __future__ import annotations

from datetime import datetime
from pathlib import Path


def next_digest_path(course_dir: Path, digests_dirname: str, now: datetime) -> Path:
    out_dir = Path(course_dir) / digests_dirname
    out_dir.mkdir(parents=True, exist_ok=True)

    dated = out_dir / f"{now.strftime('%Y-%m-%d')}.md"
    if not dated.exists():
        return dated

    stamped = out_dir / f"{now.strftime('%Y-%m-%dT%H%M')}.md"
    if not stamped.exists():
        return stamped

    suffix = 2
    while True:
        candidate = out_dir / f"{now.strftime('%Y-%m-%dT%H%M')}-{suffix}.md"
        if not candidate.exists():
            return candidate
        suffix += 1
