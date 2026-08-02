from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    reason: str


def check_codex_auth(runner=subprocess.run, which=shutil.which) -> AuthResult:
    if which("codex") is None:
        return AuthResult(False, "Codex CLI not found on PATH")
    proc = runner(
        ["codex", "login", "status"],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return AuthResult(True, "")
    detail = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    return AuthResult(False, detail or "Codex CLI is not authenticated")
