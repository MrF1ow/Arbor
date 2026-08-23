from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

from arbor_worker.provider.base import Model

DOCS_URL = "https://developers.openai.com/codex/cli"

DEFAULT_MODELS = [
    Model(id="gpt-5.6-sol", label="Sol 5.6"),
    Model(id="gpt-5.6-terra", label="Terra 5.6"),
]


@dataclass(frozen=True)
class AutoGenerate:
    flashcards: bool = False


@dataclass(frozen=True)
class WorkerSettings:
    cache_dir_name: str = "_arbor_cache"
    pptx_min_chars: int = 200
    pdf_render_dpi: int = 150
    pdf_warn_pages: int = 50
    pdf_chunk_threshold_pages: int = 25
    pdf_chunk_size_pages: int = 25
    pdf_chunk_concurrency: int = 2
    delete_sources_after_digest: bool = False
    auto_update: bool = False
    auto_embed: bool = False
    watch_enabled: bool = True
    auto_generate: AutoGenerate = field(default_factory=AutoGenerate)
    digests_dirname: str = "digests"
    course_file_name: str = "course.md"
    docs_url: str = DOCS_URL
    models: list[Model] = field(default_factory=lambda: list(DEFAULT_MODELS))


def default_settings() -> WorkerSettings:
    return WorkerSettings()


def load_models(root: Path) -> list[Model]:
    cfg = Path(root) / ".arbor" / "models.json"
    if not cfg.is_file():
        return list(DEFAULT_MODELS)
    data = json.loads(cfg.read_text())
    return [Model(id=m["id"], label=m["label"]) for m in data["models"]]


def load_settings(root: Path) -> WorkerSettings:
    cfg = Path(root) / ".arbor" / "settings.json"
    base = WorkerSettings()
    if not cfg.is_file():
        return base
    data = json.loads(cfg.read_text())
    auto_generate = data.get("auto_generate", {})
    if not isinstance(auto_generate, dict):
        auto_generate = {}
    return replace(
        base,
        delete_sources_after_digest=bool(data.get("delete_sources_after_digest", False)),
        auto_update=bool(data.get("auto_update", False)),
        auto_embed=bool(data.get("auto_embed", False)),
        watch_enabled=bool(data.get("watch_enabled", True)),
        auto_generate=AutoGenerate(
            flashcards=bool(auto_generate.get("flashcards", False))
        ),
    )
