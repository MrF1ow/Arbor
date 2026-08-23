from __future__ import annotations

import hashlib
import math


class FakeEmbedder:
    dimensions = 8

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values = [
            int.from_bytes(digest[index : index + 4], "big") / (2**32 - 1) * 2 - 1
            for index in range(0, self.dimensions * 4, 4)
        ]
        norm = math.sqrt(sum(value * value for value in values))
        return [value / norm for value in values]
