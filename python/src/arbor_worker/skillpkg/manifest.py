from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

PERMISSIONS: frozenset[str] = frozenset(
    {
        "read_course",
        "write_course_study",
        "write_export_dir",
        "provider",
        "network",
    }
)

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$")
_IO_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_MODULE_RE = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$"
)
_FUNCTION_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SkillPackageError(ValueError):
    """Raised for invalid manifests and unsafe package trees."""


class SkillPackageManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    kind: Literal["skill"]
    entry: str
    inputs: list[str]
    outputs: list[str]
    permissions: list[str]

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _ID_RE.fullmatch(value):
            raise ValueError("invalid skill package id")
        return value

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if not _VERSION_RE.fullmatch(value):
            raise ValueError("invalid skill package version")
        return value

    @field_validator("entry")
    @classmethod
    def validate_entry(cls, value: str) -> str:
        if not value:
            raise ValueError("invalid entry")
        if "/" in value or "\\" in value or ".." in value:
            raise ValueError("invalid entry")
        if value.count(":") != 1:
            raise ValueError("invalid entry")
        module, function = value.split(":", 1)
        if not module or not function:
            raise ValueError("invalid entry")
        if ".py" in module:
            raise ValueError("invalid entry")
        if not _MODULE_RE.fullmatch(module):
            raise ValueError("invalid entry")
        if not _FUNCTION_RE.fullmatch(function):
            raise ValueError("invalid entry")
        return value

    @field_validator("inputs", "outputs")
    @classmethod
    def validate_io_names(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("duplicate io name")
        for name in value:
            if not _IO_NAME_RE.fullmatch(name):
                raise ValueError("invalid io name")
        return value

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("duplicate permission")
        for name in value:
            if name not in PERMISSIONS:
                raise ValueError(f"unknown permission: {name}")
        return value


def parse_manifest_obj(data: object) -> SkillPackageManifest:
    if not isinstance(data, dict):
        raise SkillPackageError("manifest must be a JSON object")
    try:
        return SkillPackageManifest.model_validate(data)
    except ValidationError as error:
        raise SkillPackageError(str(error)) from error


def load_manifest_file(path: Path) -> SkillPackageManifest:
    if not path.is_file():
        raise SkillPackageError(f"manifest not found: {path}")
    if path.is_symlink():
        raise SkillPackageError("manifest must not be a symlink")
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise SkillPackageError(str(error)) from error
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SkillPackageError(f"invalid manifest JSON: {error}") from error
    return parse_manifest_obj(data)


def entry_module_path(entry: str) -> Path:
    module, _function = entry.split(":", 1)
    parts = module.split(".")
    return Path(*parts).with_suffix(".py")
