"""P12: provider token counts, the usage-logging wrapper, and the call log."""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from pathlib import Path

import pytest

from arbor_worker import cli
from arbor_worker.provider.anthropic_api import AnthropicApiProvider
from arbor_worker.provider.base import (
    Model,
    ProviderError,
    ProviderRequest,
    ProviderResult,
    supports_stream,
)
from arbor_worker.provider.claude import ClaudeCliProvider
from arbor_worker.provider.codex import CodexCliProvider
from arbor_worker.provider.fake import FakeProvider
from arbor_worker.provider.lmstudio import LmStudioProvider
from arbor_worker.provider.ollama import OllamaProvider
from arbor_worker.provider.grok import GrokCliProvider
from arbor_worker.provider.openai_api import DEFAULT_OPENAI_BASE, OpenAiApiProvider
from arbor_worker.provider.registry import PROVIDERS, make_provider
from tests.ui_overhaul_fixtures import (
    build_ui_overhaul_root,
    provider_calls_path,
    read_provider_calls,
)

TEST_KEY = "sk-test-arbor-not-a-real-key"
MODELS = [Model("m", "M")]


def _request(tmp_path: Path) -> ProviderRequest:
    return ProviderRequest(prompt="hi", model_id="m", cwd=tmp_path)


@pytest.fixture(autouse=True)
def _no_claudecode(monkeypatch):
    monkeypatch.delenv("CLAUDECODE", raising=False)


# --- recorded fixtures (shapes copied from the providers' documented responses) ---

OPENAI_RUN = json.dumps(
    {
        "id": "chatcmpl-1",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello"}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18},
    }
).encode()

OPENAI_RUN_NO_USAGE = json.dumps(
    {"choices": [{"index": 0, "message": {"role": "assistant", "content": "hello"}}]}
).encode()


def _sse(*payloads: dict) -> list[bytes]:
    rows = [f"data: {json.dumps(p)}\n".encode() for p in payloads]
    rows.append(b"data: [DONE]\n")
    return rows


OPENAI_STREAM = _sse(
    {"choices": [{"delta": {"content": "hel"}}]},
    {"choices": [{"delta": {"content": "lo"}}]},
    {"choices": [], "usage": {"prompt_tokens": 13, "completion_tokens": 5}},
)

ANTHROPIC_RUN = json.dumps(
    {
        "content": [{"type": "text", "text": "hello"}],
        "usage": {"input_tokens": 21, "output_tokens": 9},
    }
).encode()

ANTHROPIC_STREAM = [
    b"event: message_start\n",
    b"data: "
    + json.dumps(
        {"type": "message_start", "message": {"usage": {"input_tokens": 25, "output_tokens": 1}}}
    ).encode()
    + b"\n",
    b"event: content_block_delta\n",
    b"data: "
    + json.dumps(
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hel"}}
    ).encode()
    + b"\n",
    b"event: content_block_delta\n",
    b"data: "
    + json.dumps(
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "lo"}}
    ).encode()
    + b"\n",
    b"event: message_delta\n",
    b"data: "
    + json.dumps({"type": "message_delta", "usage": {"output_tokens": 12}}).encode()
    + b"\n",
    b"event: message_stop\n",
    b'data: {"type": "message_stop"}\n',
]

OLLAMA_RUN = json.dumps(
    {
        "message": {"role": "assistant", "content": "hello"},
        "done": True,
        "prompt_eval_count": 31,
        "eval_count": 4,
    }
).encode()

CLAUDE_RUN = json.dumps(
    {
        "type": "result",
        "is_error": False,
        "result": "hello",
        "usage": {"input_tokens": 41, "output_tokens": 6, "cache_read_input_tokens": 100},
    }
)

CLAUDE_STREAM_LINES = [
    json.dumps(
        {
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "hel"},
            },
        }
    )
    + "\n",
    json.dumps(
        {
            "type": "result",
            "is_error": False,
            "result": "hello",
            "usage": {"input_tokens": 51, "output_tokens": 8},
        }
    )
    + "\n",
]

STREAM_JSON_NO_USAGE = [
    json.dumps({"type": "result", "is_error": False, "result": "hello"}) + "\n",
]


class _Pipe:
    def write(self, _data):
        return None

    def close(self):
        return None

    def read(self):
        return ""


class _Lines(_Pipe):
    def __init__(self, lines):
        self._lines = list(lines)

    def __iter__(self):
        yield from self._lines


def _popen_factory(lines):
    class FakePopen:
        def __init__(self, argv, **_kwargs):
            self.stdin = _Pipe()
            self.stdout = _Lines(lines)
            self.stderr = _Pipe()
            self.returncode = 0

        def poll(self):
            return 0

        def wait(self):
            return 0

        def kill(self):
            return None

    return FakePopen


def _stream(provider, tmp_path: Path) -> tuple[ProviderResult, list[str]]:
    deltas: list[str] = []
    result = provider.stream(_request(tmp_path), deltas.append)
    return result, deltas


# --- tokens ---


def test_openai_api_run_reports_tokens(tmp_path: Path):
    prov = OpenAiApiProvider(
        MODELS,
        transport=lambda *a: (200, OPENAI_RUN),
        base_url="http://fake-openai",
        api_key=TEST_KEY,
    )
    result = prov.run(_request(tmp_path))
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 11, 7)


def test_openai_api_run_without_usage_gives_none(tmp_path: Path):
    prov = OpenAiApiProvider(
        MODELS,
        transport=lambda *a: (200, OPENAI_RUN_NO_USAGE),
        base_url="http://fake-openai",
        api_key=TEST_KEY,
    )
    result = prov.run(_request(tmp_path))
    assert (result.input_tokens, result.output_tokens) == (None, None)


def test_openai_api_stream_reports_tokens_and_requests_usage(tmp_path: Path):
    bodies: list[bytes] = []

    def stream_transport(method, url, headers, body, timeout):
        bodies.append(body)
        return 200, iter(OPENAI_STREAM)

    prov = OpenAiApiProvider(
        MODELS,
        stream_transport=stream_transport,
        base_url=DEFAULT_OPENAI_BASE,
        api_key=TEST_KEY,
    )
    result, deltas = _stream(prov, tmp_path)
    assert deltas == ["hel", "lo"]
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 13, 5)
    assert json.loads(bodies[0])["stream_options"] == {"include_usage": True}


def test_openai_api_custom_base_gets_no_stream_options(tmp_path: Path):
    # An OpenAI-compatible server behind ARBOR_OPENAI_BASE_URL may reject
    # unknown body fields; usage is still read if it sends it anyway.
    bodies: list[bytes] = []

    def stream_transport(method, url, headers, body, timeout):
        bodies.append(body)
        return 200, iter(OPENAI_STREAM)

    prov = OpenAiApiProvider(
        MODELS,
        stream_transport=stream_transport,
        base_url="https://proxy.example/v1",
        api_key=TEST_KEY,
    )
    result, _ = _stream(prov, tmp_path)
    assert "stream_options" not in json.loads(bodies[0])
    assert (result.input_tokens, result.output_tokens) == (13, 5)


def test_grok_run_reports_tokens_from_recorded_result(tmp_path: Path):
    stdout = (Path(__file__).parent / "fixtures" / "providers" / "grok-result.json").read_text()
    expected = json.loads(stdout)["usage"]

    class Proc:
        returncode = 0
        stderr = ""

    Proc.stdout = stdout
    prov = GrokCliProvider(MODELS, runner=lambda *a, **k: Proc(), which=lambda _n: "/bin/grok")
    result = prov.run(_request(tmp_path))
    assert (result.input_tokens, result.output_tokens) == (
        expected["input_tokens"],
        expected["output_tokens"],
    )


def test_lmstudio_stream_reads_usage_but_does_not_send_stream_options(tmp_path: Path):
    bodies: list[bytes] = []

    def stream_transport(method, url, headers, body, timeout):
        bodies.append(body)
        return 200, iter(OPENAI_STREAM)

    prov = LmStudioProvider(MODELS, stream_transport=stream_transport, base_url="http://lm/v1")
    result, _ = _stream(prov, tmp_path)
    assert (result.input_tokens, result.output_tokens) == (13, 5)
    assert "stream_options" not in json.loads(bodies[0])


def test_lmstudio_run_reports_tokens(tmp_path: Path):
    prov = LmStudioProvider(
        MODELS, transport=lambda *a: (200, OPENAI_RUN), base_url="http://lm/v1"
    )
    result = prov.run(_request(tmp_path))
    assert (result.input_tokens, result.output_tokens) == (11, 7)


def test_anthropic_run_reports_tokens(tmp_path: Path):
    prov = AnthropicApiProvider(
        MODELS,
        transport=lambda *a: (200, ANTHROPIC_RUN),
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    result = prov.run(_request(tmp_path))
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 21, 9)


def test_anthropic_stream_reports_tokens(tmp_path: Path):
    prov = AnthropicApiProvider(
        MODELS,
        stream_transport=lambda *a: (200, iter(ANTHROPIC_STREAM)),
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    result, deltas = _stream(prov, tmp_path)
    assert deltas == ["hel", "lo"]
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 25, 12)


def test_anthropic_stream_without_usage_events_gives_none(tmp_path: Path):
    rows = [row for row in ANTHROPIC_STREAM if b"message_start" not in row and b"message_delta" not in row]
    prov = AnthropicApiProvider(
        MODELS,
        stream_transport=lambda *a: (200, iter(rows)),
        base_url="http://fake-anthropic",
        api_key=TEST_KEY,
    )
    result, _ = _stream(prov, tmp_path)
    assert (result.input_tokens, result.output_tokens) == (None, None)


def test_ollama_run_reports_tokens(tmp_path: Path):
    prov = OllamaProvider(
        MODELS, transport=lambda *a: (200, OLLAMA_RUN), base_url="http://ollama"
    )
    result = prov.run(_request(tmp_path))
    assert (result.input_tokens, result.output_tokens) == (31, 4)


def test_claude_run_reports_tokens(tmp_path: Path):
    class Proc:
        returncode = 0
        stdout = CLAUDE_RUN
        stderr = ""

    prov = ClaudeCliProvider(MODELS, runner=lambda *a, **k: Proc(), which=lambda _n: "/bin/claude")
    result = prov.run(_request(tmp_path))
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 41, 6)


def test_claude_stream_json_result_line_reports_tokens(tmp_path: Path):
    prov = ClaudeCliProvider(
        MODELS, which=lambda _n: "/bin/claude", popen=_popen_factory(CLAUDE_STREAM_LINES)
    )
    result, _ = _stream(prov, tmp_path)
    assert (result.markdown, result.input_tokens, result.output_tokens) == ("hello", 51, 8)


def test_stream_json_without_usage_gives_none(tmp_path: Path):
    prov = ClaudeCliProvider(
        MODELS, which=lambda _n: "/bin/claude", popen=_popen_factory(STREAM_JSON_NO_USAGE)
    )
    result, _ = _stream(prov, tmp_path)
    assert (result.input_tokens, result.output_tokens) == (None, None)


def test_codex_and_fake_give_none(tmp_path: Path):
    assert FakeProvider("x").run(_request(tmp_path)).input_tokens is None
    assert FakeProvider("x").run(_request(tmp_path)).output_tokens is None

    def runner(argv, **_kwargs):
        Path(argv[argv.index("-o") + 1]).write_text("# T\nbody")

        class Proc:
            returncode = 0
            stdout = ""
            stderr = ""

        return Proc()

    result = CodexCliProvider(MODELS, runner=runner, which=lambda _n: "/bin/codex").run(
        _request(tmp_path)
    )
    assert (result.input_tokens, result.output_tokens) == (None, None)


# --- wrapper: supports_stream parity ---


@pytest.mark.parametrize("name", sorted(PROVIDERS))
def test_supports_stream_unchanged_by_wrapper(name: str, tmp_path: Path):
    wrapped = make_provider(name, tmp_path, source="chat")
    inner_streams = callable(getattr(PROVIDERS[name].cls, "stream", None))
    assert supports_stream(wrapped) == inner_streams
    # Everything the callers read still reaches the inner provider.
    assert wrapped.name == name
    assert callable(wrapped.list_models)
    assert callable(wrapped.is_available)


def test_wrapper_follows_a_per_instance_stream(tmp_path: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    streaming = FakeProvider("x", stream_script=["a", "b"])
    plain = FakeProvider("x")
    assert supports_stream(with_usage_log(streaming, tmp_path, "chat")) is True
    assert supports_stream(with_usage_log(plain, tmp_path, "chat")) is False


# --- wrapper: the call log ---


class _Tokens:
    """Inner provider that reports tokens, can stream, and can fail."""

    name = "tokens"

    def __init__(self, fail: bool = False):
        self.fail = fail

    def status(self):
        return None

    def is_available(self):
        return True

    def list_models(self):
        return []

    def run(self, request):
        if self.fail:
            raise ProviderError("boom")
        return ProviderResult(markdown="ok", input_tokens=3, output_tokens=4)

    def stream(self, request, on_delta):
        if self.fail:
            raise ProviderError("boom")
        on_delta("ok")
        return ProviderResult(markdown="ok", input_tokens=5, output_tokens=6)


def test_run_appends_one_line_with_tokens(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    wrapped = with_usage_log(_Tokens(), git_repo, "job")
    wrapped.run(_request(git_repo))
    assert [
        {k: v for k, v in row.items() if k != "ts"} for row in read_provider_calls(git_repo)
    ] == [
        {
            "provider": "tokens",
            "model": "m",
            "input_tokens": 3,
            "output_tokens": 4,
            "source": "job",
        }
    ]
    ts = read_provider_calls(git_repo)[0]["ts"]
    assert ts.endswith("Z") and "T" in ts


def test_stream_appends_exactly_one_line_with_tokens(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    wrapped = with_usage_log(_Tokens(), git_repo, "chat")
    deltas: list[str] = []
    result = wrapped.stream(_request(git_repo), deltas.append)
    assert deltas == ["ok"] and result.markdown == "ok"
    rows = read_provider_calls(git_repo)
    assert len(rows) == 1
    assert (rows[0]["input_tokens"], rows[0]["output_tokens"], rows[0]["source"]) == (
        5,
        6,
        "chat",
    )


def test_failed_calls_are_logged_with_null_tokens_and_still_raise(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    wrapped = with_usage_log(_Tokens(fail=True), git_repo, "job")
    with pytest.raises(ProviderError):
        wrapped.run(_request(git_repo))
    with pytest.raises(ProviderError):
        wrapped.stream(_request(git_repo), lambda _t: None)
    rows = read_provider_calls(git_repo)
    assert len(rows) == 2
    assert all(r["input_tokens"] is None and r["output_tokens"] is None for r in rows)


def test_first_log_write_excludes_local_state_from_git(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log
    from arbor_worker.sync import LOCAL_STATE_GIT_EXCLUDE
    from tests.ui_overhaul_fixtures import read_git_info_exclude_lines
    import subprocess

    with_usage_log(_Tokens(), git_repo, "job").run(_request(git_repo))
    assert provider_calls_path(git_repo).is_file()
    assert LOCAL_STATE_GIT_EXCLUDE in read_git_info_exclude_lines(git_repo)
    porcelain = subprocess.run(
        ["git", "-C", str(git_repo), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert porcelain == ""


def test_read_only_log_file_does_not_fail_the_call(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    path = provider_calls_path(git_repo)
    path.parent.mkdir(parents=True)
    path.write_text("", encoding="utf-8")
    path.chmod(0o444)
    if os.access(path, os.W_OK):
        pytest.skip("running with privileges that ignore file modes")
    wrapped = with_usage_log(_Tokens(), git_repo, "job")
    assert wrapped.run(_request(git_repo)).markdown == "ok"
    assert wrapped.stream(_request(git_repo), lambda _t: None).markdown == "ok"
    assert path.read_text(encoding="utf-8") == ""


def test_unwritable_local_dir_does_not_fail_the_call(git_repo: Path):
    from arbor_worker.provider.usage_log import with_usage_log

    # `.arbor` is a file, so the log directory can never be created.
    (git_repo / ".arbor").write_text("not a directory", encoding="utf-8")
    assert with_usage_log(_Tokens(), git_repo, "job").run(_request(git_repo)).markdown == "ok"


# --- sources through the commands ---


def _run_cli(argv: list[str], stdin: str = "") -> tuple[int, str]:
    out = io.StringIO()
    old_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin)
    try:
        with contextlib.redirect_stdout(out):
            code = cli.main(argv)
    finally:
        sys.stdin = old_stdin
    return code, out.getvalue()


def test_generate_logs_one_job_line_per_provider_call(tmp_path: Path, monkeypatch):
    from tests.ui_overhaul_fixtures import FAKE_FLASHCARDS_INTRO_JSON

    fixture = build_ui_overhaul_root(tmp_path)
    text_path = tmp_path / "chat-answer.txt"
    text_path.write_text("Mitochondria are the powerhouse of the cell.", encoding="utf-8")
    monkeypatch.setenv("ARBOR_FAKE_MD", FAKE_FLASHCARDS_INTRO_JSON)
    code, _ = _run_cli(
        [
            "generate",
            "--root", str(fixture.root),
            "--course", "Bio",
            "--skill", "flashcards",
            "--provider", "fake",
            "--from-text-file", str(text_path),
            "--digests", "Bio/digests/intro.md",
        ]
    )
    assert code == 0
    rows = read_provider_calls(fixture.root)
    assert len(rows) == 1
    assert (rows[0]["source"], rows[0]["provider"], rows[0]["model"]) == (
        "job",
        "fake",
        "fake-model",
    )


def test_update_logs_job_lines(tmp_path: Path, make_pdf, monkeypatch):
    from tests.ui_overhaul_fixtures import (
        build_ui_overhaul_update_root,
        update_fake_digest_markdown,
    )

    fixture = build_ui_overhaul_update_root(tmp_path, make_pdf)
    monkeypatch.setenv("ARBOR_FAKE_MD", update_fake_digest_markdown(1, 1))
    code, _ = _run_cli(
        ["update", "--root", str(fixture.root), "--model", "m", "--provider", "fake"]
    )
    assert code == 0
    rows = read_provider_calls(fixture.root)
    # Two source digests plus the course synthesis: every provider call is one line.
    assert len(rows) >= 2
    assert {r["source"] for r in rows} == {"job"}


def test_study_plan_logs_one_study_plan_line(git_repo: Path, monkeypatch):
    (git_repo / "Biology" / "digests").mkdir(parents=True)
    (git_repo / "Biology" / "digests" / "a.md").write_text("# A\n", encoding="utf-8")
    monkeypatch.setenv("ARBOR_FAKE_MD", "# Study plan\n\n## Exam\n\nTBD\n")
    code, _ = _run_cli(
        ["study-plan", "--root", str(git_repo), "--course", "Biology", "--provider", "fake"]
    )
    assert code == 0
    rows = read_provider_calls(git_repo)
    assert [r["source"] for r in rows] == ["study_plan"]


def test_study_plan_through_serve_is_logged_too(git_repo: Path, monkeypatch):
    from arbor_worker.serve import _handle_request

    (git_repo / "Biology" / "digests").mkdir(parents=True)
    (git_repo / "Biology" / "digests" / "a.md").write_text("# A\n", encoding="utf-8")
    code, _out, _err = _handle_request(
        ["study-plan", "--root", str(git_repo), "--course", "Biology", "--provider", "fake"],
        {"ARBOR_FAKE_MD": "# Study plan\n\n## Exam\n\nTBD\n"},
    )
    assert code == 0
    assert [r["source"] for r in read_provider_calls(git_repo)] == ["study_plan"]


def test_chat_logs_one_chat_line(tmp_path: Path):
    from arbor_worker.embedder.hashed import HashedNgramEmbedder
    from arbor_worker.embed import embed_root
    from arbor_worker.indexer import index_course

    fixture = build_ui_overhaul_root(tmp_path)
    root = fixture.root
    (root / "Bio" / "course.md").write_text("# Bio\n\nCourse overview.\n")
    embed_root(root, HashedNgramEmbedder())
    index_course(root, "Bio")
    payload = {
        "root": str(root),
        "course": "Bio",
        "question": "Welcome biology",
        "mode": "ask",
        "provider": "fake",
        "model": "fake-model",
        "history": [],
    }
    os.environ["ARBOR_FAKE_MD"] = "An answer [1].\n\nsupported: true"
    try:
        code, _ = _run_cli(["chat"], stdin=json.dumps(payload))
    finally:
        os.environ.pop("ARBOR_FAKE_MD", None)
    assert code == 0
    rows = read_provider_calls(root)
    assert [r["source"] for r in rows] == ["chat"]
