from pathlib import Path

import pytest

from arbor_worker.provider.base import Model, ProviderRequest
from arbor_worker.provider.codex import CodexCliProvider, ProviderError


def test_build_argv_includes_flags_and_images(tmp_path: Path):
    prov = CodexCliProvider(models=[Model("m", "M")])
    req = ProviderRequest(
        prompt="p",
        model_id="gpt-x",
        image_paths=[tmp_path / "a.png", tmp_path / "b.png"],
        cwd=tmp_path,
    )
    out = tmp_path / "out.md"
    argv = prov.build_argv(req, out)
    assert argv[:3] == ["codex", "exec", "-m"]
    assert "gpt-x" in argv
    assert argv.count("-i") == 2
    assert "--sandbox" in argv and "read-only" in argv
    assert "--skip-git-repo-check" in argv
    assert "--ephemeral" in argv
    assert "-o" in argv and str(out) in argv
    assert "-C" in argv and str(tmp_path) in argv


def test_run_reads_output_file(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        # emulate codex writing the digest to the -o file
        out_index = argv.index("-o") + 1
        Path(argv[out_index]).write_text("# Title\n## Overview\nbody")
        class R: returncode = 0; stdout = ""; stderr = ""
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    res = prov.run(req)
    assert res.markdown.startswith("# Title")


def test_run_raises_on_nonzero(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        class R: returncode = 2; stdout = ""; stderr = "boom"
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    with pytest.raises(ProviderError):
        prov.run(req)


def test_run_raises_on_empty_output(tmp_path: Path):
    def fake_runner(argv, **kwargs):
        out_index = argv.index("-o") + 1
        Path(argv[out_index]).write_text("   ")
        class R: returncode = 0; stdout = ""; stderr = ""
        return R()

    prov = CodexCliProvider(models=[Model("m", "M")], runner=fake_runner)
    req = ProviderRequest(prompt="p", model_id="m", image_paths=[], cwd=tmp_path)
    with pytest.raises(ProviderError):
        prov.run(req)
