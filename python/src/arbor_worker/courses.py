from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arbor_worker.sources import classify

IGNORED_DIR_NAMES = {".git", ".arbor"}


@dataclass(frozen=True)
class CourseSource:
    path: Path        # relative to the Knowledge root
    course_dir: Path  # relative to the Knowledge root; an immediate child of it
    source_type: str


def discover_sources(
    root: Path,
    *,
    cache_dir_name: str,
    digests_dirname: str,
) -> list[CourseSource]:
    root = Path(root)
    skip = IGNORED_DIR_NAMES | {cache_dir_name, digests_dirname}
    found: list[CourseSource] = []
    for course in sorted(p for p in root.iterdir() if p.is_dir()):
        if course.name in skip:
            continue
        for path in sorted(course.rglob("*")):
            if not path.is_file():
                continue
            inner_dirs = path.relative_to(course).parts[:-1]
            if any(part in skip for part in inner_dirs):
                continue
            source_type = classify(path)
            if source_type is None:
                continue
            found.append(
                CourseSource(
                    path=path.relative_to(root),
                    course_dir=Path(course.name),
                    source_type=source_type,
                )
            )
    return found
