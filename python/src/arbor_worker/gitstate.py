from __future__ import annotations

import subprocess
from pathlib import Path

from arbor_worker.sources import LectureSource, classify


class GitStateError(Exception):
    pass


def _git(root: Path, args: list[str], runner) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


def dirty_sources(root: Path, runner=subprocess.run) -> list[LectureSource]:
    proc = _git(root, ["status", "--porcelain", "-z", "-uall"], runner)
    if proc.returncode != 0:
        raise GitStateError(f"Not a git repository or git failed: {(proc.stderr or '').strip()}")
    entries = [e for e in proc.stdout.split("\0") if e]
    results: list[LectureSource] = []
    seen: set[str] = set()
    for entry in entries:
        # Porcelain v1 format: 'XY <path>'; deletions have status 'D'.
        status = entry[:2]
        rel = entry[3:]
        if "D" in status:
            continue
        rel_path = Path(rel)
        stype = classify(rel_path)
        if stype is None:
            continue
        if rel in seen:
            continue
        seen.add(rel)
        results.append(LectureSource(path=rel_path, lecture_dir=rel_path.parent, source_type=stype))
    return results


def validate_single_source_per_lecture(sources: list[LectureSource]) -> None:
    by_dir: dict[Path, list[LectureSource]] = {}
    for s in sources:
        by_dir.setdefault(s.lecture_dir, []).append(s)
    bad = {str(d): [str(s.path) for s in items] for d, items in by_dir.items() if len(items) > 1}
    if bad:
        raise GitStateError(f"Multiple sources in one lecture folder: {bad}")


def commit_batch(root: Path, rel_paths: list[Path], message: str, runner=subprocess.run) -> str:
    if not rel_paths:
        raise GitStateError("Nothing to commit")
    add = _git(root, ["add", "--", *[str(p) for p in rel_paths]], runner)
    if add.returncode != 0:
        raise GitStateError(f"git add failed: {(add.stderr or '').strip()}")
    commit = _git(root, ["commit", "-m", message], runner)
    if commit.returncode != 0:
        raise GitStateError(f"git commit failed: {(commit.stderr or '').strip()}")
    rev = _git(root, ["rev-parse", "--short", "HEAD"], runner)
    return rev.stdout.strip()
