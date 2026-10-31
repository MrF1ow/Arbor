from pathlib import Path

import pytest

from arbor_worker.errors import ChunkGenerateError
from arbor_worker.provider.base import Model, ProviderError, ProviderRequest
from arbor_worker.provider.claude import ClaudeCliProvider
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.errors import (
    MAX_DETAIL_CHARS,
    cli_process_failure,
    provider_failure_event_fields,
)
from arbor_worker.provider.grok import GrokCliProvider

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "providers" / "codex-issue-116-stderr.txt"
CAUSE = (
    "Codex is rate limited (HTTP 429) and its own retries ran out. "
    "Wait and try again."
)
CACHE_ERROR = (
    "2026-10-21T00:45:39.592653Z ERROR codex_models_manager::manager: "
    "failed to renew cache TTL: missing field `base_instructions` at line 139 column 5"
)
WARN_ONLY = (
    "2026-10-21T00:45:08.663416Z  WARN codex_core_plugins::manifest: "
    "ignoring hooks: expected a string, string array, object, or object array; found object"
)


def test_issue_116_stderr_is_rate_limited_and_drops_warnings():
    stderr = FIXTURE.read_text()
    assert len(stderr) > 1000
    error = cli_process_failure("codex", 1, stderr)

    assert error.kind == "rate_limited"
    assert error.exit_code == 1
    message = str(error)
    assert message.startswith(CAUSE)
    assert error.summary == CAUSE
    assert "WARN" not in message
    assert "ignoring hooks" not in message
    assert "Worker exited" not in message
    assert message.count("exceeded retry limit") == 1
    assert "base_instructions" in message
    assert len(error.detail) <= MAX_DETAIL_CHARS
    assert len(message) <= len(CAUSE) + 1 + MAX_DETAIL_CHARS


def test_cache_ttl_error_alone_stays_unknown_and_keeps_the_line():
    error = cli_process_failure("codex", 1, CACHE_ERROR + "\n")

    assert error.kind == "unknown"
    assert error.exit_code == 1
    assert "base_instructions" in str(error)
    assert "codex exec failed (1)" in str(error)


def test_warning_only_stderr_falls_back_to_the_last_line():
    error = cli_process_failure("codex", 1, WARN_ONLY + "\n")

    assert error.kind == "unknown"
    assert str(error).strip()
    assert "ignoring hooks" in str(error)
    assert "no stderr" not in str(error)


def test_usage_limit_wording_is_quota_not_rate_limited():
    error = cli_process_failure(
        "codex",
        1,
        "You've hit your usage limit. Try again at 5pm.\n",
    )

    assert error.kind == "quota"
    assert str(error).startswith("Codex has reached its usage limit.")
    assert "base_instructions" not in str(error)


def test_cache_error_does_not_override_a_429():
    error = cli_process_failure("codex", 1, CACHE_ERROR + "\nERROR: 429 Too Many Requests\n")

    assert error.kind == "rate_limited"
    assert "base_instructions" in error.detail


def test_event_fields_follow_a_wrapped_provider_error():
    cause = cli_process_failure("codex", 1, FIXTURE.read_text())
    try:
        raise ChunkGenerateError("Chunk generation failed") from cause
    except ChunkGenerateError as error:
        fields = provider_failure_event_fields(error)

    assert fields == {"kind": "rate_limited", "exit_code": 1}


def _completed(returncode: int, stdout: str = "", stderr: str = ""):
    return type("R", (), {"returncode": returncode, "stdout": stdout, "stderr": stderr})()


def test_codex_run_classifies_the_issue_fixture(tmp_path: Path):
    stderr = FIXTURE.read_text()

    def runner(argv, **kwargs):
        return _completed(1, stderr=stderr)

    prov = CodexCliProvider(models=[Model("m", "M")], runner=runner)
    req = ProviderRequest(prompt="p", model_id="m", cwd=tmp_path)
    with pytest.raises(ProviderError) as exc:
        prov.run(req)

    assert exc.value.kind == "rate_limited"
    assert str(exc.value).startswith(CAUSE)
    assert "WARN" not in str(exc.value)


def test_codex_run_ignores_cache_error_when_exit_is_zero(tmp_path: Path):
    def runner(argv, **kwargs):
        out_index = argv.index("-o") + 1
        Path(argv[out_index]).write_text('{"schema_version":1}\n')
        return _completed(0, stderr=CACHE_ERROR + "\n")

    prov = CodexCliProvider(models=[Model("m", "M")], runner=runner)
    res = prov.run(ProviderRequest(prompt="p", model_id="m", cwd=tmp_path))

    assert res.markdown.startswith("{")


def test_claude_and_grok_nonzero_stderr_uses_the_same_classifier(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)
    stderr = "ERROR: exceeded retry limit, last status: 429 Too Many Requests\n"

    def runner(*_args, **_kwargs):
        return _completed(1, stderr=stderr)

    claude = ClaudeCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda _name: "/usr/bin/claude",
    )
    grok = GrokCliProvider(
        models=[Model("m", "M")],
        runner=runner,
        which=lambda _name: "/usr/bin/grok",
    )
    request = ProviderRequest(prompt="p", model_id="m", cwd=tmp_path)
    with pytest.raises(ProviderError) as claude_exc:
        claude.run(request)
    with pytest.raises(ProviderError) as grok_exc:
        grok.run(request)

    assert claude_exc.value.kind == "rate_limited"
    assert str(claude_exc.value).startswith("Claude is rate limited (HTTP 429)")
    assert grok_exc.value.kind == "rate_limited"
    assert str(grok_exc.value).startswith("Grok is rate limited (HTTP 429)")
