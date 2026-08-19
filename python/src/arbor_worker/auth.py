from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    reason: str


def resolve_codex_command(which, home: Path | None = None) -> str | None:
    found = which("codex")
    if found:
        return found
    root = Path.home() if home is None else home
    candidate = root / ".local/bin/codex"
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate)
    return None


def check_codex_auth(runner=subprocess.run, which=shutil.which, home: Path | None = None) -> AuthResult:
    cmd = resolve_codex_command(which, home)
    if cmd is None:
        return AuthResult(False, "Codex CLI not found on PATH")
    try:
        proc = runner(
            [cmd, "login", "status"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return AuthResult(False, "Codex CLI login status timeout")
    if proc.returncode == 0:
        return AuthResult(True, "")
    detail = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    return AuthResult(False, detail or "Codex CLI is not authenticated")
