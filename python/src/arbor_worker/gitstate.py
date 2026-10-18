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


def _env_author_email_set() -> bool:
    return bool((os.environ.get("GIT_AUTHOR_EMAIL") or "").strip())


def _env_committer_email_set() -> bool:
    return bool((os.environ.get("GIT_COMMITTER_EMAIL") or "").strip())


def _effective_user_email(root: Path, runner: _Runner) -> str | None:
    proc = _git(root, ["config", "--get", "user.email"], runner)
    if proc.returncode != 0:
        return None
    email = (proc.stdout or "").strip()
    return email if email else None


def git_identity_args(root: Path, runner: _Runner = subprocess.run) -> list[str]:
    config_email = _effective_user_email(root, runner)
    author_covered = bool(config_email) or _env_author_email_set()
    committer_covered = bool(config_email) or _env_committer_email_set()
    if author_covered and committer_covered:
        return []
    return ["-c", "user.name=Arbor", "-c", "user.email=arbor@localhost"]


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
    identity = git_identity_args(root, runner)
    if identity:
        notice = FALLBACK_IDENTITY_NOTICE
    path_args = [str(p) for p in rel_paths]
    commit = runner(
        [
            "git",
            "-C",
            str(root),
            *identity,
            "commit",
            "-m",
            message,
            "--",
            *path_args,
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


def path_has_pending_changes(
    root: Path,
    rel_path: Path,
    runner: _Runner = subprocess.run,
) -> bool:
    proc = _git(root, ["status", "--porcelain", "--", str(rel_path)], runner)
    if proc.returncode != 0:
        raise GitStateError(f"git status failed: {(proc.stderr or '').strip()}")
    return bool((proc.stdout or "").strip())
