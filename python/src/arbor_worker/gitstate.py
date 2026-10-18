from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from arbor_worker.events import EventEmitter

FALLBACK_IDENTITY_NOTICE = (
    "No git user.email is configured. Committed as Arbor <arbor@localhost>."
)

class GitStateError(Exception):
    pass


@dataclass(frozen=True)
class CommitResult:
    rev: str
    notice: str | None


class _Runner(Protocol):
    def __call__(
        self,
        args: list[str],
        *,
        capture_output: bool,
        text: bool,
    ) -> subprocess.CompletedProcess: ...


def _git(root: Path, args: list[str], runner: _Runner) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


def _env_git_email_set() -> bool:
    for key in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
        if (os.environ.get(key) or "").strip():
            return True
    return False


def _effective_user_email(root: Path, runner: _Runner) -> str | None:
    proc = _git(root, ["config", "--get", "user.email"], runner)
    if proc.returncode != 0:
        return None
    email = (proc.stdout or "").strip()
    return email if email else None


def commit_batch(
    root: Path,
    rel_paths: list[Path],
    message: str,
    runner=subprocess.run,
) -> CommitResult:
    if not rel_paths:
        raise GitStateError("Nothing to commit")
    add = _git(root, ["add", "--", *[str(p) for p in rel_paths]], runner)
    if add.returncode != 0:
        raise GitStateError(f"git add failed: {(add.stderr or '').strip()}")
    notice: str | None = None
    if _effective_user_email(root, runner) or _env_git_email_set():
        commit = _git(root, ["commit", "-m", message], runner)
    else:
        notice = FALLBACK_IDENTITY_NOTICE
        commit = runner(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "user.name=Arbor",
                "-c",
                "user.email=arbor@localhost",
                "commit",
                "-m",
                message,
            ],
            capture_output=True,
            text=True,
        )
    if commit.returncode != 0:
        raise GitStateError(f"git commit failed: {(commit.stderr or '').strip()}")
    rev = _git(root, ["rev-parse", "--short", "HEAD"], runner)
    return CommitResult(rev=rev.stdout.strip(), notice=notice)


def commit_and_note(
    root: Path,
    rel_paths: list[Path],
    message: str,
    emitter: EventEmitter,
    runner=subprocess.run,
) -> str:
    result = commit_batch(root, rel_paths, message, runner=runner)
    if result.notice is not None:
        emitter.warning(message=result.notice)
    return result.rev
