from __future__ import annotations

import os
from pathlib import Path

from arbor_worker.skillpkg.manifest import (
    SkillPackageError,
    SkillPackageManifest,
    entry_module_path,
    load_manifest_file,
)

_MAX_SYMLINK_HOPS = 8


def _root_resolved(root: Path) -> Path:
    return root.resolve()


def _normalize_lexical(path: Path) -> Path:
    return Path(os.path.normpath(str(path)))


def _reject_bad_relative(relative: Path | str) -> Path:
    if isinstance(relative, str):
        if not relative or "\x00" in relative or "\\" in relative:
            raise SkillPackageError("invalid relative path")
        rel = Path(relative)
    else:
        rel = relative
    if rel.is_absolute():
        raise SkillPackageError("absolute paths are not allowed")
    for part in rel.parts:
        if part in ("", ".", ".."):
            raise SkillPackageError("invalid path component")
    return rel


def _inside_root(candidate: Path, root: Path) -> bool:
    normalized = _normalize_lexical(candidate)
    root_norm = _normalize_lexical(root)
    if not normalized.is_absolute():
        normalized = _normalize_lexical(normalized.absolute())
    try:
        return normalized.is_relative_to(root_norm)
    except AttributeError:
        root_parts = root_norm.parts
        resolved_parts = normalized.parts
        if len(resolved_parts) < len(root_parts):
            return False
        return resolved_parts[: len(root_parts)] == root_parts


def _resolve_symlink_chain(link: Path, root: Path) -> Path:
    root_res = _root_resolved(root)
    current_link = link
    seen: set[Path] = set()
    for _hop in range(_MAX_SYMLINK_HOPS):
        if not current_link.is_symlink():
            resolved = current_link.resolve()
            if not _inside_root(resolved, root_res):
                raise SkillPackageError("path escapes package root")
            if resolved.is_dir():
                raise SkillPackageError("directory symlinks are not allowed")
            return resolved
        if current_link in seen:
            raise SkillPackageError("symlink loop")
        seen.add(current_link)
        target = current_link.readlink()
        if target.is_absolute():
            normalized = _normalize_lexical(target)
        else:
            normalized = _normalize_lexical(current_link.parent / target)
        if not _inside_root(normalized, root_res):
            raise SkillPackageError("symlink escapes package root")
        try:
            exists = normalized.exists()
        except OSError as error:
            raise SkillPackageError("dangling symlink") from error
        if not exists:
            raise SkillPackageError("dangling symlink")
        if normalized.is_dir():
            raise SkillPackageError("directory symlinks are not allowed")
        if normalized.is_symlink():
            current_link = normalized
            continue
        return normalized.resolve()
    raise SkillPackageError("symlink loop or too many hops")


def safe_child(root: Path, relative: Path | str) -> Path:
    rel = _reject_bad_relative(relative)
    root_res = _root_resolved(root)
    full = root / rel
    if full.exists() and full.is_symlink():
        _resolve_symlink_chain(full, root)
    candidate = full.resolve()
    if not _inside_root(candidate, root_res):
        raise SkillPackageError("path escapes package root")
    return candidate


def _check_tree_entry(root: Path, path: Path) -> None:
    try:
        relative = path.relative_to(root)
    except ValueError as error:
        raise SkillPackageError("path outside package root") from error
    _reject_bad_relative(relative)
    if path.is_symlink():
        _resolve_symlink_chain(path, root)
        return
    if path.is_dir():
        return
    if path.is_file():
        return
    raise SkillPackageError("unsupported filesystem entry")


def inspect_package_tree(root: Path) -> SkillPackageManifest:
    if not root.exists() or not root.is_dir():
        raise SkillPackageError("package root must be an existing directory")
    if root.is_symlink():
        raise SkillPackageError("package root must not be a symlink")

    manifest = load_manifest_file(root / "arbor-skill.json")
    entry_rel = entry_module_path(manifest.entry)
    entry_path = safe_child(root, entry_rel)
    entry_full = root / entry_rel
    if not entry_full.is_file():
        raise SkillPackageError("entry module must be a regular file")
    if entry_full.is_symlink():
        raise SkillPackageError("entry module must not be a symlink")
    if entry_full.is_dir():
        raise SkillPackageError("entry module must not be a directory")
    if not _inside_root(entry_path, _root_resolved(root)):
        raise SkillPackageError("entry module escapes package root")

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        current_dir = Path(dirpath)
        for name in dirnames:
            _check_tree_entry(root, current_dir / name)
        for name in filenames:
            _check_tree_entry(root, current_dir / name)

    return manifest
