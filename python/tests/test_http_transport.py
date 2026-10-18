import urllib.request

import pytest

from arbor_worker.provider.base import ProviderError
from arbor_worker.provider.http_transport import (
    _NoRedirectHTTPRedirectHandler,
    urllib_http_request,
)

TEST_KEY = "sk-test-arbor-not-a-real-key"


@pytest.fixture(autouse=True)
def _disallow_remote_api(monkeypatch):
    monkeypatch.delenv("ARBOR_ALLOW_REMOTE_API", raising=False)


def test_blocked_openai_host_never_opens_socket(monkeypatch):
    def fail_urlopen(*args, **kwargs):
        raise AssertionError("urlopen should not be called for blocked host")

    monkeypatch.setattr(urllib.request, "urlopen", fail_urlopen)
    with pytest.raises(ProviderError, match="api.openai.com") as exc:
        urllib_http_request(
            "GET",
            "https://api.openai.com/v1/models",
            {"Authorization": f"Bearer {TEST_KEY}"},
            None,
            3.0,
        )
    assert "blocked" in str(exc.value).lower()
    assert TEST_KEY not in str(exc.value)


def test_blocked_anthropic_host_never_opens_socket(monkeypatch):
    def fail_urlopen(*args, **kwargs):
        raise AssertionError("urlopen should not be called for blocked host")

    monkeypatch.setattr(urllib.request, "urlopen", fail_urlopen)
    with pytest.raises(ProviderError, match="api.anthropic.com") as exc:
        urllib_http_request(
            "POST",
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": TEST_KEY},
            b"{}",
            3.0,
        )
    assert "blocked" in str(exc.value).lower()
    assert TEST_KEY not in str(exc.value)


def test_redirect_handler_does_not_follow():
    handler = _NoRedirectHTTPRedirectHandler()
    req = urllib.request.Request("http://example.com/start")
    assert (
        handler.redirect_request(
            req,
            None,
            302,
            "Found",
            {"Location": "https://api.openai.com/v1/models"},
            "https://api.openai.com/v1/models",
        )
        is None
    )
