from __future__ import annotations

import json
from pathlib import Path


class CacheDir:
    def __init__(self, root: Path, cache_dir_name: str):
        self.root = Path(root)
        self.cache_dir_name = cache_dir_name

    @property
    def base(self) -> Path:
        return self.root / self.cache_dir_name

    def for_hash(self, source_hash: str) -> Path:
        d = self.base / source_hash
        d.mkdir(parents=True, exist_ok=True)
        return d

    def marker_path(self, source_hash: str) -> Path:
        return self.for_hash(source_hash) / "prepare.json"

    def read_marker(self, source_hash: str) -> dict | None:
        p = self.base / source_hash / "prepare.json"
        if not p.is_file():
            return None
        return json.loads(p.read_text())

    def write_marker(self, source_hash: str, data: dict) -> None:
        self.marker_path(source_hash).write_text(json.dumps(data))


def ensure_gitignored(root: Path, cache_dir_name: str) -> None:
    gi = Path(root) / ".gitignore"
    entry = f"{cache_dir_name}/"
    existing = gi.read_text().splitlines() if gi.is_file() else []
    if entry in existing:
        return
    with open(gi, "a") as fh:
        if existing and existing[-1].strip() != "":
            fh.write("\n")
        fh.write(entry + "\n")
