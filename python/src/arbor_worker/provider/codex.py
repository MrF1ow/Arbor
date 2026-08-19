from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from arbor_worker.auth import check_codex_auth, resolve_codex_command
from arbor_worker.provider.base import Model, ProviderRequest, ProviderResult


class ProviderError(Exception):
    pass


class CodexCliProvider:
    name = "codex"

    def __init__(self, models: list[Model], runner=subprocess.run, which=shutil.which):
        self._models = models
        self._runner = runner
        self._which = which

    def is_available(self) -> bool:
        return check_codex_auth(runner=self._runner, which=self._which).ok

    def list_models(self) -> list[Model]:
        return list(self._models)

    def build_argv(self, request: ProviderRequest, out_file: Path) -> list[str]:
        argv = [resolve_codex_command(self._which), "exec", "-m", request.model_id]
        for img in request.image_paths:
            argv += ["-i", str(img)]
        argv += [
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color", "never",
            "-o", str(out_file),
            "-C", str(request.cwd),
        ]
        return argv

    def run(self, request: ProviderRequest) -> ProviderResult:
        with tempfile.TemporaryDirectory() as td:
            out_file = Path(td) / "last_message.md"
            argv = self.build_argv(request, out_file)
            proc = self._runner(
                argv,
                input=request.prompt,
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()
                raise ProviderError(f"codex exec failed ({proc.returncode}): {detail}")
            if not out_file.is_file():
                raise ProviderError("codex exec produced no output file")
            markdown = out_file.read_text()
            if not markdown.strip():
                raise ProviderError("codex exec produced empty output")
            return ProviderResult(markdown=markdown)
