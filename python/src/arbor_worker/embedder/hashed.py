from __future__ import annotations

import hashlib
import math
import re


_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


class HashedNgramEmbedder:
    dimensions = 256

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        tokens = [token.casefold() for token in _TOKEN_RE.findall(text)]
        vector = [0.0] * self.dimensions
        for size in range(1, 4):
            for start in range(len(tokens) - size + 1):
                gram = "\x1f".join(tokens[start : start + size]).encode("utf-8")
                digest = hashlib.sha256(gram).digest()
                index = int.from_bytes(digest[:4], "big") % self.dimensions
                vector[index] += 1.0 if digest[4] & 1 else -1.0
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]
