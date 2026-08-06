from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from arbor_worker.provider.base import Model

DOCS_URL = "https://developers.openai.com/codex/cli"

DEFAULT_MODELS = [
    Model(id="gpt-5.6-sol", label="Sol 5.6"),
    Model(id="gpt-5.6-terra", label="Terra 5.6"),
]


@dataclass(frozen=True)
class WorkerSettings:
    cache_dir_name: str = "_arbor_cache"
    pptx_min_chars: int = 200
    pdf_render_dpi: int = 150
    pdf_warn_pages: int = 50
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
