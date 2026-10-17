from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from arbor_worker.auth import check_cli_auth, gui_path, resolve_cli_command
from arbor_worker.provider.base import (
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    ProviderStatus,
    image_media_type,
)

GROK_DOCS_URL = "https://x.ai/grok"

DEFAULT_GROK_MODELS = [
    Model(id="grok-4.7", label="Grok 4.7"),
    Model(id="grok-4.7-build-fast", label="Grok 4.7 Build Fast"),
]

GROK_DISALLOWED_TOOLS = (
    "run_terminal_cmd,write,search_replace,task,web_search,web_fetch,"
    "read_file,grep,list_dir"
)


class GrokCliProvider:
    name = "grok"

    def __init__(self, models: list[Model], runner=subprocess.run, which=shutil.which):
        self._models = models
        self._runner = runner
        self._which = which

    def status(self) -> ProviderStatus:
        cmd = resolve_cli_command("grok", self._which)
        if cmd is None:
            return ProviderStatus(False, "Grok CLI not found on PATH")
        res = check_cli_auth(
            [cmd, "models"],
            runner=self._runner,
            timeout_reason="Grok CLI models timeout",
            failure_reason="Grok CLI is not authenticated",
            ok=lambda proc: proc.returncode == 0 and "logged in" in (proc.stdout or "").lower(),
        )
        return ProviderStatus(res.ok, res.reason)

    def is_available(self) -> bool:
        return self.status().available

    def list_models(self) -> list[Model]:
        return list(self._models)

    def build_argv(self, request: ProviderRequest, prompt_file: Path | None) -> list[str]:
        cmd = resolve_cli_command("grok", self._which)
        argv = [cmd]
        if prompt_file is not None:
            argv.extend(["--prompt-file", str(prompt_file)])
        argv.extend(
            [
                "-m",
                request.model_id,
                "--output-format",
                "json",
                "--disable-web-search",
                "--no-subagents",
                "--no-plan",
                "--max-turns",
                "1",
                "--permission-mode",
                "dontAsk",
                "--cwd",
                str(request.cwd),
                "--verbatim",
                "--disallowed-tools",
                GROK_DISALLOWED_TOOLS,
            ]
        )
        if request.image_paths:
            blocks: list[dict] = [{"type": "text", "text": request.prompt}]
            for path in request.image_paths:
                data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
                blocks.append(
                    {
                        "type": "image",
                        "mimeType": image_media_type(path),
                        "data": data,
                    }
                )
            argv.extend(["--prompt-json", json.dumps(blocks)])
        return argv

    def _parse_stdout(self, stdout: str) -> ProviderResult:
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"grok returned invalid JSON: {exc}") from exc
        if payload.get("type") == "error":
            raise ProviderError(str(payload.get("message") or "grok error"))
        if payload.get("is_error"):
            raise ProviderError(str(payload.get("message") or "grok error"))
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("grok returned empty text")
        return ProviderResult(markdown=text)

    def run(self, request: ProviderRequest) -> ProviderResult:
        if resolve_cli_command("grok", self._which) is None:
            raise ProviderError("Grok CLI not found on PATH")
        env = os.environ.copy()
        env["PATH"] = gui_path()
        if request.image_paths:
            argv = self.build_argv(request, prompt_file=None)
            proc = self._runner(
                argv,
                capture_output=True,
                text=True,
                env=env,
            )
        else:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                delete=False,
                suffix=".txt",
            ) as tmp:
                tmp.write(request.prompt)
                prompt_path = Path(tmp.name)
            try:
                argv = self.build_argv(request, prompt_file=prompt_path)
                proc = self._runner(
                    argv,
                    capture_output=True,
                    text=True,
                    env=env,
                )
            finally:
                prompt_path.unlink(missing_ok=True)
        if proc.returncode != 0:
            stdout = proc.stdout or ""
            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict) and (
                payload.get("type") == "error" or payload.get("is_error")
            ):
                raise ProviderError(str(payload.get("message") or "grok error"))
            detail = (proc.stderr or proc.stdout or "").strip() or "grok failed"
            raise ProviderError(f"grok failed ({proc.returncode}): {detail}")
        return self._parse_stdout(proc.stdout or "")
