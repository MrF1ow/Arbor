from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from arbor_worker.skillpkg import (
    PERMISSIONS,
    SkillPackageError,
    inspect_package_tree,
    load_manifest_file,
    parse_manifest_obj,
    safe_child,
)


def _valid_manifest(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "id": "anki-export",
        "version": "1.0.0",
        "kind": "skill",
        "entry": "anki_export:export_deck",
        "inputs": ["course"],
        "outputs": ["deck"],
        "permissions": [],
    }
    data.update(overrides)
    return data


def _write_package(root: Path, manifest: dict[str, object], *, entry_body: str) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "arbor-skill.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / "anki_export.py").write_text(entry_body, encoding="utf-8")


def test_parse_valid_manifest_object() -> None:
    manifest = parse_manifest_obj(_valid_manifest())
    assert manifest.id == "anki-export"
    assert manifest.entry == "anki_export:export_deck"
    assert manifest.permissions == []


def test_inspect_valid_package_does_not_execute_code(tmp_path: Path) -> None:
    marker = tmp_path / "pkg" / "_import_ran"
    pkg = tmp_path / "pkg"
    body = (
        "MARKER = __import__('pathlib').Path("
        f"{marker.as_posix()!r})\n"
        "open(MARKER, 'w').close()\n"
    )
    _write_package(pkg, _valid_manifest(), entry_body=body)
    assert not marker.exists()
    result = inspect_package_tree(pkg)
    assert result.id == "anki-export"
    assert not marker.exists()


def test_unknown_json_key_rejected() -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(_valid_manifest(extra="nope"))


def test_unknown_permission_rejected() -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(_valid_manifest(permissions=["read_course", "sudo"]))


def test_duplicate_permission_rejected() -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(
            _valid_manifest(permissions=["read_course", "read_course"])
        )


@pytest.mark.parametrize(
    "bad_id",
    ["", "..", "../x", "Foo", "a/b", "-bad"],
)
def test_bad_ids_rejected(bad_id: str) -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(_valid_manifest(id=bad_id))


def test_kind_other_than_skill_rejected() -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(_valid_manifest(kind="plugin"))


@pytest.mark.parametrize(
    "bad_entry",
    ["../x:run", "/tmp/x:run", "mod.py:run", "mod:run:extra", "mod:", ":run"],
)
def test_bad_entries_rejected(bad_entry: str) -> None:
    with pytest.raises(SkillPackageError):
        parse_manifest_obj(_valid_manifest(entry=bad_entry))


def test_safe_child_rejects_traversal_and_absolute(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    with pytest.raises(SkillPackageError):
        safe_child(root, "../outside")
    with pytest.raises(SkillPackageError):
        safe_child(root, tmp_path / "abs")


def test_file_symlink_outside_root_rejected(tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    (pkg / "anki_export.py").write_text("def export_deck(): pass\n", encoding="utf-8")
    os.symlink(outside, pkg / "leak.txt")
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)


def test_file_symlink_absolute_target_with_dotdot_escape_rejected(
    tmp_path: Path,
) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("secret", encoding="utf-8")
    pkg = tmp_path / "pkg"
    subdir = pkg / "subdir"
    subdir.mkdir(parents=True)
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    (pkg / "anki_export.py").write_text("def export_deck(): pass\n", encoding="utf-8")
    abs_escape = Path(f"{subdir.resolve()}/../../secret.txt")
    os.symlink(abs_escape, pkg / "leak")
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)


def test_file_symlink_relative_dotdot_outside_rejected(tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("secret", encoding="utf-8")
    pkg = tmp_path / "pkg"
    inner = pkg / "inner"
    inner.mkdir(parents=True)
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    (pkg / "anki_export.py").write_text("def export_deck(): pass\n", encoding="utf-8")
    os.symlink("../../outside.txt", inner / "leak.txt")
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)


def test_file_symlink_inside_accepted_entry_must_be_regular(tmp_path: Path) -> None:
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    real = pkg / "real.py"
    real.write_text("def export_deck(): pass\n", encoding="utf-8")
    os.symlink(real, pkg / "anki_export.py")
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)

    (pkg / "anki_export.py").unlink()
    (pkg / "anki_export.py").write_text("def export_deck(): pass\n", encoding="utf-8")
    os.symlink(real, pkg / "helper.py")
    inspect_package_tree(pkg)


def test_directory_symlink_rejected(tmp_path: Path) -> None:
    pkg = tmp_path / "pkg"
    inner = tmp_path / "inner"
    inner.mkdir()
    pkg.mkdir()
    os.symlink(inner, pkg / "linked_dir")
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    (pkg / "anki_export.py").write_text("def export_deck(): pass\n", encoding="utf-8")
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)


def test_entry_resolving_outside_package_rejected(tmp_path: Path) -> None:
    outside = tmp_path / "outside.py"
    outside.write_text("def export_deck(): pass\n", encoding="utf-8")
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    os.symlink(outside, pkg / "anki_export.py")
    (pkg / "arbor-skill.json").write_text(
        json.dumps(_valid_manifest()), encoding="utf-8"
    )
    with pytest.raises(SkillPackageError):
        inspect_package_tree(pkg)


def test_permissions_frozen_set() -> None:
    assert PERMISSIONS == frozenset(
        {
            "read_course",
            "write_course_study",
            "write_export_dir",
            "provider",
            "network",
        }
    )


def test_load_manifest_file_rejects_symlink(tmp_path: Path) -> None:
    target = tmp_path / "arbor-skill.json"
    target.write_text("{}", encoding="utf-8")
    os.symlink(target, tmp_path / "linked.json")
    with pytest.raises(SkillPackageError):
        load_manifest_file(tmp_path / "linked.json")
