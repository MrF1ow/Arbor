from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    reason: str


DEFAULT_EXTRA_BIN_DIRS = (
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
)


def extra_bin_dirs(
    home: Path,
    extra_dirs: Iterable[Path] | None = None,
) -> list[Path]:
    dirs = [Path(home) / ".local/bin"]
    dirs.extend(DEFAULT_EXTRA_BIN_DIRS if extra_dirs is None else extra_dirs)
    seen: set[Path] = set()
    unique: list[Path] = []
    for directory in dirs:
        path = Path(directory)
        if path in seen:
            continue
        seen.add(path)
        unique.append(path)
    return unique


def gui_path(
    home: Path | None = None,
    current: str | None = None,
    extra_dirs: Iterable[Path] | None = None,
) -> str:
    root = Path.home() if home is None else Path(home)
    parts: list[str] = []
    seen: set[str] = set()
    for directory in extra_bin_dirs(root, extra_dirs):
        item = str(directory)
        if item in seen:
            continue
        seen.add(item)
        parts.append(item)
    env_path = os.environ.get("PATH", "") if current is None else current
    for item in env_path.split(os.pathsep):
        if not item or item in seen:
            continue
        seen.add(item)
        parts.append(item)
    return os.pathsep.join(parts)


def resolve_codex_command(
    which,
    home: Path | None = None,
    extra_dirs: Iterable[Path] | None = None,
) -> str | None:
    found = which("codex")
    if found:
        return found
    root = Path.home() if home is None else Path(home)
    for directory in extra_bin_dirs(root, extra_dirs):
        candidate = directory / "codex"
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def check_codex_auth(
    runner=subprocess.run,
    which=shutil.which,
    home: Path | None = None,
    extra_dirs: Iterable[Path] | None = None,
) -> AuthResult:
    cmd = resolve_codex_command(which, home, extra_dirs)
    if cmd is None:
        return AuthResult(False, "Codex CLI not found on PATH")
    env = os.environ.copy()
    env["PATH"] = gui_path(home, extra_dirs=extra_dirs)
    try:
        proc = runner(
            [cmd, "login", "status"],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return AuthResult(False, "Codex CLI login status timeout")
    except Exception as exc:
        return AuthResult(False, str(exc) or "Codex CLI is not authenticated")
    if proc.returncode == 0:
        return AuthResult(True, "")
    detail = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    return AuthResult(False, detail or "Codex CLI is not authenticated")
