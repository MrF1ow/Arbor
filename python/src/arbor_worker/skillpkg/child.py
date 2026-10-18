from __future__ import annotations

import importlib.util
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

from arbor_worker.skillpkg.manifest import SkillPackageError, entry_module_path
from arbor_worker.skillpkg.run import SkillPermissionError


def _reject_relative(relative: str) -> Path:
    if not isinstance(relative, str) or not relative or "\x00" in relative or "\\" in relative:
        raise SkillPermissionError("invalid relative path")
    rel = Path(relative)
    if rel.is_absolute():
        raise SkillPermissionError("absolute paths are not allowed")
    for part in rel.parts:
        if part in ("", ".", ".."):
            raise SkillPermissionError("invalid path component")
    return rel


def _walk_lstat(root: Path, relative: Path) -> Path:
    current = root.resolve()
    for part in relative.parts:
        current = current / part
        try:
            st = os.lstat(current)
        except FileNotFoundError:
            return current
        if stat.S_ISLNK(st.st_mode):
            raise SkillPermissionError("symlinks are not allowed")
    return current


def _write_confined(root: Path, rel: Path, data: bytes) -> None:
    root_res = root.resolve()
    current = root_res
    parts = rel.parts
    for index, part in enumerate(parts):
        current = current / part
        is_last = index == len(parts) - 1
        try:
            st = os.lstat(current)
        except FileNotFoundError:
            if is_last:
                fd = os.open(
                    str(current),
                    os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW,
                    0o644,
                )
                try:
                    os.write(fd, data)
                finally:
                    os.close(fd)
                return
            current.mkdir(mode=0o755)
            continue
        if stat.S_ISLNK(st.st_mode):
            raise SkillPermissionError("symlinks are not allowed")
        if is_last:
            if not stat.S_ISREG(st.st_mode):
                raise SkillPermissionError("export path is not a regular file")
            fd = os.open(
                str(current),
                os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW,
                0o644,
            )
            try:
                os.write(fd, data)
            finally:
                os.close(fd)
            return
        if not stat.S_ISDIR(st.st_mode):
            raise SkillPermissionError("invalid path component")


def make_skill_run_context(
    *,
    knowledge_root: Path,
    course: str,
    export_dir: Path,
    grants: set[str],
) -> Any:
    course_dir = (knowledge_root / course).resolve()
    export_dir_res = export_dir.resolve()

    def read_course_file(relative: str) -> bytes:
        if "read_course" not in grants:
            raise SkillPermissionError("read_course permission required")
        rel = _reject_relative(relative)
        target = _walk_lstat(course_dir, rel)
        if not target.is_file():
            raise SkillPermissionError("course file not found")
        if target.is_symlink():
            raise SkillPermissionError("symlinks are not allowed")
        try:
            return target.read_bytes()
        except OSError as error:
            raise SkillPermissionError("unable to read course file") from error

    def write_export(relative: str, data: bytes) -> None:
        if "write_export_dir" not in grants:
            raise SkillPermissionError("write_export_dir permission required")
        if not isinstance(data, bytes):
            raise SkillPermissionError("export data must be bytes")
        rel = _reject_relative(relative)
        _write_confined(export_dir_res, rel, data)

    def write_study_file(relative: str, data: bytes) -> None:
        if "write_course_study" not in grants:
            raise SkillPermissionError("write_course_study permission required")
        if not isinstance(data, bytes):
            raise SkillPermissionError("study data must be bytes")
        study_dir = course_dir / "study"
        if not study_dir.exists():
            parent_st = os.lstat(course_dir)
            if stat.S_ISLNK(parent_st.st_mode):
                raise SkillPermissionError("symlinks are not allowed")
            study_dir.mkdir(mode=0o755)
        else:
            st = os.lstat(study_dir)
            if stat.S_ISLNK(st.st_mode):
                raise SkillPermissionError("symlinks are not allowed")
            if not stat.S_ISDIR(st.st_mode):
                raise SkillPermissionError("study path is not a directory")
        rel = _reject_relative(relative)
        _write_confined(study_dir.resolve(), rel, data)

    class SkillRunContext:
        __slots__ = ("read_course_file", "write_export", "write_study_file")

    ctx = SkillRunContext()
    ctx.read_course_file = read_course_file
    ctx.write_export = write_export
    ctx.write_study_file = write_study_file
    return ctx


def _load_request(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SkillPackageError("missing run request")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SkillPackageError("invalid run request") from error
    if not isinstance(data, dict):
        raise SkillPackageError("invalid run request")
    return data


def _run_from_request(request: dict[str, Any]) -> None:
    package_dir = Path(request["package_dir"])
    knowledge_root = Path(request["knowledge_root"])
    course = request["course"]
    export_dir = Path(request["export_dir"])
    grants = set(request["grants"])
    entry = request["entry"]

    module_rel = entry_module_path(entry)
    module_path = package_dir / module_rel
    try:
        entry_st = os.lstat(module_path)
    except OSError as error:
        raise SkillPackageError("entry module missing") from error
    if stat.S_ISLNK(entry_st.st_mode):
        raise SkillPackageError("entry module must not be a symlink")
    if not stat.S_ISREG(entry_st.st_mode):
        raise SkillPackageError("entry module missing")

    module_name, function_name = entry.split(":", 1)
    spec = importlib.util.spec_from_file_location("arbor_installed_skill", module_path)
    if spec is None or spec.loader is None:
        raise SkillPackageError("unable to load skill module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    func = getattr(module, function_name, None)
    if not callable(func):
        raise SkillPackageError("entry function missing")

    context = make_skill_run_context(
        knowledge_root=knowledge_root,
        course=course,
        export_dir=export_dir,
        grants=grants,
    )
    func(context)


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: arbor_worker.skillpkg.child REQUEST.json", file=sys.stderr)
        return 2
    try:
        request_path = Path(args[0])
        request = _load_request(request_path)
        scratch = request_path.parent
        request_path.unlink()
        work_dir = scratch / "work"
        work_dir.mkdir(mode=0o700)
        os.chdir(work_dir)
        _run_from_request(request)
    except SkillPermissionError as error:
        print(str(error), file=sys.stderr)
        return 1
    except SkillPackageError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
