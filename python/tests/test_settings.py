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


def test_chunking_defaults():
    from arbor_worker.settings import default_settings

    s = default_settings()
    assert s.pdf_chunk_threshold_pages == 25
    assert s.pdf_chunk_size_pages == 25
    assert s.pdf_chunk_concurrency == 2


def test_load_models_from_file(tmp_path: Path):
    cfg = tmp_path / ".arbor"
    cfg.mkdir()
    (cfg / "models.json").write_text(
        json.dumps({"models": [{"id": "custom-1", "label": "Custom One"}]})
    )
    models = load_models(tmp_path)
    assert models == [Model(id="custom-1", label="Custom One")]


def test_course_defaults():
    from arbor_worker.settings import default_settings

    s = default_settings()
    assert s.delete_sources_after_digest is False
    assert s.auto_update is False
    assert s.auto_embed is False
    assert s.watch_enabled is True
    assert s.auto_generate.flashcards is False
    assert s.auto_generate.quiz is False
    assert s.digests_dirname == "digests"
    assert s.course_file_name == "course.md"


def test_load_settings_missing_file_uses_defaults(tmp_path):
    from arbor_worker.settings import load_settings

    s = load_settings(tmp_path)
    assert s.delete_sources_after_digest is False
    assert s.auto_update is False
    assert s.watch_enabled is True


def test_load_settings_partial_json_keeps_watch_enabled(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text('{"auto_update": true}')
    s = load_settings(tmp_path)
    assert s.auto_update is True
    assert s.watch_enabled is True


def test_load_settings_reads_delete_flag(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text('{"delete_sources_after_digest": true}')
    s = load_settings(tmp_path)
    assert s.delete_sources_after_digest is True
    assert s.digests_dirname == "digests"


def test_load_settings_reads_nested_flashcard_auto_generate(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text(
        '{"auto_generate":{"flashcards":true}}'
    )

    s = load_settings(tmp_path)

    assert s.auto_generate.flashcards is True


def test_load_settings_reads_nested_quiz_auto_generate(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text(
        '{"auto_generate":{"quiz":true}}'
    )

    s = load_settings(tmp_path)

    assert s.auto_generate.quiz is True
    assert s.auto_generate.flashcards is False


def test_load_settings_reads_auto_embed(tmp_path):
    from arbor_worker.settings import load_settings

    (tmp_path / ".arbor").mkdir()
    (tmp_path / ".arbor" / "settings.json").write_text('{"auto_embed": true}')

    assert load_settings(tmp_path).auto_embed is True
