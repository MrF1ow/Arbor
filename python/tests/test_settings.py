import json
from pathlib import Path

from arbor_worker.settings import default_settings, load_models
from arbor_worker.provider.base import Model


def test_defaults_present():
    s = default_settings()
    assert s.cache_dir_name == "_arbor_cache"
    assert s.pptx_min_chars == 200
    assert s.docs_url.startswith("http")
    assert len(s.models) >= 1
    assert all(isinstance(m, Model) for m in s.models)


def test_load_models_defaults_when_absent(tmp_path: Path):
    models = load_models(tmp_path)
    assert models == default_settings().models


def test_load_models_from_file(tmp_path: Path):
    cfg = tmp_path / ".arbor"
    cfg.mkdir()
    (cfg / "models.json").write_text(
        json.dumps({"models": [{"id": "custom-1", "label": "Custom One"}]})
    )
    models = load_models(tmp_path)
    assert models == [Model(id="custom-1", label="Custom One")]
