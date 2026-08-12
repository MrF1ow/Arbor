from __future__ import annotations

import subprocess
from pathlib import Path


class GitStateError(Exception):
    pass


def _git(root: Path, args: list[str], runner) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


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
