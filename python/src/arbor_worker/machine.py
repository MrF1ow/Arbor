from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from arbor_worker.gitstate import git_user_dirname
from arbor_worker.sync import ensure_local_state_excluded

if TYPE_CHECKING:
    from typing import Protocol

    class _Runner(Protocol):
        def __call__(
            self,
            args: list[str],
            *,
            capture_output: bool,
            text: bool,
        ) -> subprocess.CompletedProcess: ...


PROGRESS_BAK_GIT_EXCLUDE = "progress.json.bak"
_MACHINE_SCHEMA = "machine_id"


def _git(root: Path, args: list[str], runner) -> subprocess.CompletedProcess:
    return runner(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
    )


def ensure_git_exclude_pattern(
    root: Path,
    pattern: str,
    runner=subprocess.run,
) -> None:
    """Append a pattern to .git/info/exclude when missing (idempotent, best-effort)."""
    if not pattern.strip():
        return
    try:
        proc = _git(root, ["rev-parse", "--git-path", "info/exclude"], runner=runner)
        if proc.returncode != 0:
            return
        rel = (proc.stdout or "").strip()
        if not rel:
            return
        exclude_path = Path(rel)
        if not exclude_path.is_absolute():
            exclude_path = root / exclude_path
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        existing: list[str] = []
        if exclude_path.is_file():
            existing = exclude_path.read_text(encoding="utf-8").splitlines()
        if pattern in existing:
            return
        with open(exclude_path, "a", encoding="utf-8") as fh:
            if existing and existing[-1].strip():
                fh.write("\n")
            fh.write(pattern + "\n")
    except OSError:
        pass


def _machine_json_path(root: Path, runner=subprocess.run) -> Path:
    user_dir = git_user_dirname(root, runner)
    return root / ".arbor" / "users" / user_dir / "local" / "machine.json"


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(
        f".{path.name}.tmp-{os.getpid()}-{threading.get_ident()}-{uuid.uuid4().hex[:8]}"
    )
    try:
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def _is_canonical_uuid(value: str) -> bool:
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    return str(parsed) == value


def _parse_machine_id_payload(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get(_MACHINE_SCHEMA)
    if not isinstance(value, str) or not value:
        return None
    if not _is_canonical_uuid(value):
        return None
    return value


def _read_machine_id(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        raise
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        return None
    return _parse_machine_id_payload(raw)


def existing_machine_id(
    root: Path,
    runner: _Runner | None = None,
) -> str | None:
    """Return machine id when machine.json exists and is readable; never creates one."""
    if runner is None:
        runner = subprocess.run
    return _read_machine_id(_machine_json_path(root, runner))


def _create_machine_id_locked(
    path: Path,
    root: Path,
    runner: subprocess.run,
) -> str:
    existing = _read_machine_id(path)
    if existing is not None:
        return existing
    # Remove corrupt payloads so create-if-absent can proceed.
    if path.is_file():
        path.unlink()
    ensure_local_state_excluded(root, runner=runner)
    ensure_git_exclude_pattern(root, PROGRESS_BAK_GIT_EXCLUDE, runner=runner)
    new_id = str(uuid.uuid4())
    payload = json.dumps({_MACHINE_SCHEMA: new_id}, ensure_ascii=False) + "\n"
    tmp = path.with_name(
        f".machine.json.tmp-{os.getpid()}-{threading.get_ident()}-{uuid.uuid4().hex[:8]}"
    )
    try:
        tmp.write_text(payload, encoding="utf-8")
        try:
            os.link(tmp, path)
        except FileExistsError:
            winner = _read_machine_id(path)
            if winner is None:
                path.unlink(missing_ok=True)
                os.link(tmp, path)
                return new_id
            return winner
    finally:
        tmp.unlink(missing_ok=True)
    return new_id


def machine_id(root: Path, runner=subprocess.run) -> str:
    path = _machine_json_path(root, runner)
    lock_path = path.parent / ".machine.json.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.touch(exist_ok=True)
    try:
        import fcntl
    except ImportError:  # Windows: no flock; os.link create-if-absent still converges
        return _create_machine_id_locked(path, root, runner)
    with open(lock_path, "a", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        try:
            return _create_machine_id_locked(path, root, runner)
        finally:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
