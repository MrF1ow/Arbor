from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ManifestArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    content_sha256: str
    generated_at: datetime


class StudyManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    artifacts: dict[str, ManifestArtifact] = Field(default_factory=dict)


def load_manifest(path: Path) -> StudyManifest:
    if not path.is_file():
        return StudyManifest()
    return StudyManifest.model_validate_json(path.read_text())


def write_manifest(path: Path, manifest: StudyManifest) -> None:
    path.write_text(
        json.dumps(manifest.model_dump(mode="json"), indent=2) + "\n"
    )
