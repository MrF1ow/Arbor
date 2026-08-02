from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Model:
    id: str
    label: str
