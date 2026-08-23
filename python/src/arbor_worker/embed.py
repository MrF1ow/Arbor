from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field, replace
from pathlib import Path

from arbor_worker.cache import ensure_gitignored
from arbor_worker.embedder.base import Embedder
from arbor_worker.settings import WorkerSettings, default_settings


VECTOR_DB_NAME = "vectors.sqlite"


@dataclass(frozen=True)
class Chunk:
    course: str
    path: str
    heading: str
    text: str
    digest_sha256: str
    vector: list[float] = field(default_factory=list)


@dataclass(frozen=True)
class EmbedCounts:
    digests: int
    embedded: int
    skipped: int
    chunks: int


_HEADING_RE = re.compile(r"^##[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_TITLE_RE = re.compile(r"^#[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_PARAGRAPH_RE = re.compile(r"\n[ \t]*\n")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_CHUNK_TOKENS = 500


def _split_words(text: str) -> list[str]:
    words = text.split()
    return [
        " ".join(words[start : start + _CHUNK_TOKENS])
        for start in range(0, len(words), _CHUNK_TOKENS)
    ]


def _split_block(text: str) -> list[str]:
    pieces = []
    for paragraph in _PARAGRAPH_RE.split(text.strip()):
        if len(paragraph.split()) <= _CHUNK_TOKENS:
            pieces.append(paragraph.strip())
            continue
        for sentence in _SENTENCE_RE.split(paragraph):
            if len(sentence.split()) <= _CHUNK_TOKENS:
                pieces.append(sentence.strip())
            else:
                pieces.extend(_split_words(sentence))

    chunks = []
    current = []
    current_tokens = 0
    for piece in (piece for piece in pieces if piece):
        piece_tokens = len(piece.split())
        if current and current_tokens + piece_tokens > _CHUNK_TOKENS:
            chunks.append("\n\n".join(current))
            current = []
            current_tokens = 0
        current.append(piece)
        current_tokens += piece_tokens
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def chunk_digest(
    *,
    course: str,
    path: str,
    digest_sha256: str,
    markdown: str,
) -> list[Chunk]:
    matches = list(_HEADING_RE.finditer(markdown))
    if not matches:
        title = _TITLE_RE.search(markdown)
        heading = title.group(1).strip() if title else path.rsplit("/", 1)[-1]
        text = markdown.strip()
        return [
            Chunk(course, path, heading, part, digest_sha256)
            for part in _split_block(text)
        ]

    chunks = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        text = markdown[start:end].strip()
        for part in _split_block(text):
            chunks.append(
                Chunk(
                    course=course,
                    path=path,
                    heading=match.group(1).strip(),
                    text=part,
                    digest_sha256=digest_sha256,
                )
            )
    return chunks


def vector_db_path(root: Path) -> Path:
    return Path(root) / ".arbor" / VECTOR_DB_NAME


def _open_vector_db(root: Path) -> sqlite3.Connection:
    path = vector_db_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            course TEXT NOT NULL,
            path TEXT NOT NULL,
            heading TEXT NOT NULL,
            text TEXT NOT NULL,
            digest_sha256 TEXT NOT NULL,
            vector TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path)"
    )
    return connection


def _digest_paths(root: Path, settings: WorkerSettings) -> list[Path]:
    return sorted(
        digest
        for course in root.iterdir()
        if course.is_dir()
        and not course.name.startswith(".")
        and course.name != settings.cache_dir_name
        for digest in (course / settings.digests_dirname).glob("*.md")
    )


def embed_root(
    root: Path,
    embedder: Embedder,
    *,
    force: bool = False,
    settings: WorkerSettings | None = None,
) -> EmbedCounts:
    root = Path(root)
    settings = settings or default_settings()
    ensure_gitignored(
        root,
        settings.cache_dir_name,
        [".arbor/progress/", ".arbor/vectors.sqlite"],
    )
    connection = _open_vector_db(root)
    digest_paths = _digest_paths(root, settings)
    stored = {
        path: digest_sha256
        for path, digest_sha256 in connection.execute(
            "SELECT path, digest_sha256 FROM chunks "
            "GROUP BY path HAVING COUNT(DISTINCT digest_sha256) = 1"
        )
    }
    replacements: dict[str, list[Chunk]] = {}
    skipped = 0

    for digest_path in digest_paths:
        path = digest_path.relative_to(root).as_posix()
        source = digest_path.read_bytes()
        digest_sha256 = hashlib.sha256(source).hexdigest()
        if not force and stored.get(path) == digest_sha256:
            skipped += 1
            continue
        markdown = source.decode("utf-8")
        chunks = chunk_digest(
            course=digest_path.relative_to(root).parts[0],
            path=path,
            digest_sha256=digest_sha256,
            markdown=markdown,
        )
        vectors = embedder.embed(
            [f"{chunk.heading}\n\n{chunk.text}" for chunk in chunks]
        )
        if len(vectors) != len(chunks):
            raise ValueError("embedder returned the wrong number of vectors")
        replacements[path] = [
            replace(chunk, vector=vector)
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]

    with connection:
        for path, chunks in replacements.items():
            connection.execute("DELETE FROM chunks WHERE path = ?", (path,))
            connection.executemany(
                """
                INSERT INTO chunks (
                    course, path, heading, text, digest_sha256, vector
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        chunk.course,
                        chunk.path,
                        chunk.heading,
                        chunk.text,
                        chunk.digest_sha256,
                        json.dumps(chunk.vector),
                    )
                    for chunk in chunks
                ],
            )
    connection.close()
    return EmbedCounts(
        digests=len(digest_paths),
        embedded=len(replacements),
        skipped=skipped,
        chunks=sum(len(chunks) for chunks in replacements.values()),
    )


def search_chunks(
    root: Path,
    query: str,
    limit: int,
    embedder: Embedder,
) -> list[dict[str, object]]:
    if not query.strip() or limit <= 0:
        return []
    path = vector_db_path(root)
    if not path.is_file():
        return []
    query_vectors = embedder.embed([query])
    if len(query_vectors) != 1:
        raise ValueError("embedder returned the wrong number of vectors")
    query_vector = query_vectors[0]

    with sqlite3.connect(path) as connection:
        rows = connection.execute(
            "SELECT course, path, heading, text, vector FROM chunks"
        ).fetchall()

    scored = []
    for course, digest_path, heading, text, vector_json in rows:
        vector = json.loads(vector_json)
        if len(vector) != len(query_vector):
            continue
        score = sum(
            left * right
            for left, right in zip(query_vector, vector, strict=True)
        )
        snippet = " ".join(text.split())[:180]
        scored.append(
            (
                score,
                {
                    "course": course,
                    "path": digest_path,
                    "kind": "digest",
                    "title": heading or Path(digest_path).stem,
                    "snippet": snippet,
                    "page_range": None,
                    "source_path": None,
                },
            )
        )
    scored.sort(key=lambda item: item[0], reverse=True)
    return [hit for _, hit in scored[:limit]]
