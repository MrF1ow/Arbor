from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class DigestRecord:
    source_path: str
    source_hash: str
    page_count: int
    start_page: int
    end_page: int
    digest_file: str
    model_id: str
    processing_path: str
    generate_mode: str
    chunk_count: int | None
    digested_at: str


class CourseManifest:
    FILENAME = "arbor-course.json"

    def __init__(self, course_dir: Path, data: dict):
        self.course_dir = Path(course_dir)
        self.data = data

    @property
    def path(self) -> Path:
        return self.course_dir / self.FILENAME

    @classmethod
    def load(cls, course_dir: Path) -> "CourseManifest":
        course_dir = Path(course_dir)
        path = course_dir / cls.FILENAME
        if path.is_file():
            return cls(course_dir, json.loads(path.read_text()))
        return cls(course_dir, {"version": 1, "records": []})

    def save(self) -> None:
        self.course_dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def records(self) -> list[dict]:
        return list(self.data.get("records", []))

    def record(self, rec: DigestRecord) -> None:
        self.data.setdefault("version", 1)
        self.data.setdefault("records", []).append(asdict(rec))

    def latest_for(self, source_path: str) -> dict | None:
        matches = [r for r in self.records() if r.get("source_path") == source_path]
        if not matches:
            return None
        return matches[-1]

    def is_current(self, source_path: str, source_hash: str) -> bool:
        latest = self.latest_for(source_path)
        return latest is not None and latest.get("source_hash") == source_hash

    def digest_files(self) -> list[str]:
        seen: list[str] = []
        for rec in sorted(self.records(), key=lambda r: (r.get("digested_at", ""), r.get("digest_file", ""))):
            name = rec.get("digest_file")
            if name and name not in seen:
                seen.append(name)
        return seen

    def read_digests(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for rel in self.digest_files():
            path = self.course_dir / rel
            if path.is_file():
                out.append((Path(rel).name, path.read_text()))
        return out
