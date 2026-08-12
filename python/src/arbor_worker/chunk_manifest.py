from __future__ import annotations

import json
from pathlib import Path

from arbor_worker.chunking import ChunkPlan


class ChunkManifest:
    FILENAME = "chunks.json"

    def __init__(self, cache_dir: Path, data: dict):
        self.cache_dir = Path(cache_dir)
        self.data = data

    @property
    def path(self) -> Path:
        return self.cache_dir / self.FILENAME

    @classmethod
    def load_or_create(
        cls,
        cache_dir: Path,
        *,
        plans: list[ChunkPlan],
        chunk_size: int,
        page_count: int,
        model_id: str,
    ) -> "ChunkManifest":
        cache_dir = Path(cache_dir)
        path = cache_dir / cls.FILENAME
        fresh = {
            "chunk_size": chunk_size,
            "page_count": page_count,
            "model_id": model_id,
            "chunks": [
                {
                    "id": p.chunk_id,
                    "index": p.index,
                    "page_start": p.page_start,
                    "page_end": p.page_end,
                    "status": "pending",
                    "digest_path": None,
                    "error": None,
                }
                for p in plans
            ],
            "synthesis": {"status": "pending", "error": None},
        }
        if path.is_file():
            try:
                existing = json.loads(path.read_text())
            except json.JSONDecodeError:
                existing = None
            if existing and (
                existing.get("chunk_size") == chunk_size
                and existing.get("page_count") == page_count
                and existing.get("model_id") == model_id
            ):
                by_id = {c["id"]: c for c in existing.get("chunks", [])}
                for chunk in fresh["chunks"]:
                    prev = by_id.get(chunk["id"])
                    if prev and prev.get("status") == "ok":
                        digest = cache_dir / f"chunk-{chunk['id']}.md"
                        if digest.is_file() and digest.read_text().strip():
                            chunk["status"] = "ok"
                            chunk["digest_path"] = digest.name
        manifest = cls(cache_dir, fresh)
        manifest.save()
        return manifest

    def save(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def _sorted_chunks(self) -> list[dict]:
        return sorted(self.data["chunks"], key=lambda c: c["index"])

    def pending_chunks(self) -> list[dict]:
        return [c for c in self._sorted_chunks() if c["status"] != "ok"]

    def all_ok(self) -> bool:
        return all(c["status"] == "ok" for c in self.data["chunks"])

    def mark_ok(self, chunk_id: str, digest_name: str) -> None:
        for c in self.data["chunks"]:
            if c["id"] == chunk_id:
                c["status"] = "ok"
                c["digest_path"] = digest_name
                c["error"] = None
        self.save()

    def mark_failed(self, chunk_id: str, error: str) -> None:
        for c in self.data["chunks"]:
            if c["id"] == chunk_id:
                c["status"] = "failed"
                c["digest_path"] = None
                c["error"] = error
        self.save()

    def set_synthesis(self, status: str, error: str | None = None) -> None:
        self.data["synthesis"] = {"status": status, "error": error}
        self.save()

    def ordered_digests(self) -> list[str]:
        return [
            (self.cache_dir / f"chunk-{c['id']}.md").read_text()
            for c in self._sorted_chunks()
        ]

    def page_ranges(self) -> list[str]:
        return [f"{c['page_start']}-{c['page_end']}" for c in self._sorted_chunks()]
