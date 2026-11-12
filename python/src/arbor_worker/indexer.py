from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from arbor_worker.course_manifest import CourseManifest
from arbor_worker.schemas.study.concepts import ConceptGraph
from arbor_worker.schemas.study.flashcards import FlashcardDeck
from arbor_worker.schemas.study.quiz import QuizPack
from arbor_worker.settings import WorkerSettings, default_settings

DB_NAME = "arbor.db"
TITLE_RE = re.compile(r"^#\s+(.+)", re.MULTILINE)
PAGE_MARKER_RE = re.compile(r"<!--\s*arbor-pages:(\d+)-(\d+)\s*-->")

DIGEST_KINDS = ("digest", "course_md")
STUDY_KINDS = ("card", "question", "concept")


def db_path(root: Path) -> Path:
    return Path(root) / ".arbor" / DB_NAME


def open_db(root: Path) -> sqlite3.Connection:
    path = db_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
            course,
            path,
            kind,
            title,
            body,
            page_range,
            source_path,
            tokenize='porter unicode61'
        )
        """
    )
    return conn


def _title_and_body(text: str) -> tuple[str, str]:
    title_match = TITLE_RE.search(text)
    title = title_match.group(1).strip() if title_match else Path("untitled").stem
    body = PAGE_MARKER_RE.sub("", text).strip()
    return title, body


def _page_range(text: str) -> str | None:
    markers = PAGE_MARKER_RE.findall(text)
    if not markers:
        return None
    start = min(int(a) for a, _ in markers)
    end = max(int(b) for _, b in markers)
    return f"{start}-{end}" if start != end else str(start)


def _delete_path(conn: sqlite3.Connection, rel_path: str) -> None:
    conn.execute("DELETE FROM search_index WHERE path = ?", (rel_path,))


def _delete_course_study_rows(conn: sqlite3.Connection, course: str) -> None:
    placeholders = ",".join("?" for _ in STUDY_KINDS)
    conn.execute(
        f"DELETE FROM search_index WHERE course = ? AND kind IN ({placeholders})",
        (course, *STUDY_KINDS),
    )


def _insert_document(
    conn: sqlite3.Connection,
    *,
    course: str,
    path: str,
    kind: str,
    title: str,
    body: str,
    page_range: str | None,
    source_path: str | None,
    replace: bool = True,
) -> None:
    # Study rows skip the per-row delete: index_course already removed the
    # class's study rows in bulk, and a DELETE on an FTS column scans the table.
    if replace:
        _delete_path(conn, path)
    conn.execute(
        """
        INSERT INTO search_index (course, path, kind, title, body, page_range, source_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (course, path, kind, title, body, page_range, source_path),
    )


class _SourceLookup:
    """Digest -> (page_range, source_path), best effort; never raises."""

    def __init__(self, course_dir: Path) -> None:
        self._course_dir = course_dir
        self._sources: dict[str, str | None] = {}
        try:
            for rec in CourseManifest.load(course_dir).records():
                digest_file = rec.get("digest_file")
                if isinstance(digest_file, str):
                    source = rec.get("source_path")
                    self._sources.setdefault(
                        digest_file, source if isinstance(source, str) else None
                    )
        except Exception:
            self._sources = {}

    def __call__(self, digest_file: str) -> tuple[str | None, str | None]:
        page_range = None
        try:
            digest_path = self._course_dir / digest_file
            if digest_path.is_file():
                text = digest_path.read_text(encoding="utf-8", errors="replace")
                page_range = _page_range(text)
        except Exception:
            page_range = None
        return page_range, self._sources.get(digest_file)


def index_markdown_file(
    conn: sqlite3.Connection,
    root: Path,
    rel_path: Path,
    *,
    kind: str,
    source_path: str | None = None,
) -> None:
    abs_path = root / rel_path
    if not abs_path.is_file():
        return
    text = abs_path.read_text(encoding="utf-8", errors="replace")
    title, body = _title_and_body(text)
    page_range = _page_range(text)
    course = rel_path.parts[0] if rel_path.parts else ""
    _insert_document(
        conn,
        course=course,
        path=rel_path.as_posix(),
        kind=kind,
        title=title,
        body=body,
        page_range=page_range,
        source_path=source_path,
    )


def _index_flashcards(
    conn: sqlite3.Connection,
    course_name: str,
    course_dir: Path,
    lookup: _SourceLookup,
) -> int:
    path = course_dir / "study" / "flashcards.json"
    if not path.is_file():
        return 0
    try:
        deck = FlashcardDeck.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    count = 0
    for card in deck.cards:
        if not card.id:
            continue
        page_range, source_path = lookup(card.source.digest)
        tags = " ".join(card.tags)
        body_parts = [card.front, card.back]
        if tags:
            body_parts.append(tags)
        rel_path = f"{course_name}/study/flashcards.json#{card.id}"
        _insert_document(
            conn,
            replace=False,
            course=course_name,
            path=rel_path,
            kind="card",
            title=card.front,
            body="\n".join(body_parts),
            page_range=page_range,
            source_path=source_path,
        )
        count += 1
    return count


def _index_quiz(
    conn: sqlite3.Connection,
    course_name: str,
    course_dir: Path,
    lookup: _SourceLookup,
) -> int:
    path = course_dir / "study" / "quiz.json"
    if not path.is_file():
        return 0
    try:
        pack = QuizPack.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    count = 0
    for question in pack.questions:
        if not question.id:
            continue
        page_range, source_path = lookup(question.source.digest)
        body = "\n".join(
            [question.prompt, *question.choices, question.explanation]
        )
        rel_path = f"{course_name}/study/quiz.json#{question.id}"
        _insert_document(
            conn,
            replace=False,
            course=course_name,
            path=rel_path,
            kind="question",
            title=question.prompt,
            body=body,
            page_range=page_range,
            source_path=source_path,
        )
        count += 1
    return count


def _index_concepts(
    conn: sqlite3.Connection,
    course_name: str,
    course_dir: Path,
    lookup: _SourceLookup,
) -> int:
    path = course_dir / "study" / "concepts.json"
    if not path.is_file():
        return 0
    try:
        graph = ConceptGraph.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    count = 0
    for node in graph.nodes:
        if node.kind != "concept" or not node.id:
            continue
        digest_file = node.sources[0].digest if node.sources else None
        page_range: str | None = None
        source_path: str | None = None
        if digest_file:
            page_range, source_path = lookup(digest_file)
        rel_path = f"{course_name}/study/concepts.json#{node.id}"
        _insert_document(
            conn,
            replace=False,
            course=course_name,
            path=rel_path,
            kind="concept",
            title=node.name,
            body=f"{node.name}\n{node.summary}",
            page_range=page_range,
            source_path=source_path,
        )
        count += 1
    return count


def index_course(root: Path, course_name: str, conn: sqlite3.Connection | None = None) -> int:
    root = Path(root)
    own_conn = conn is None
    conn = conn or open_db(root)
    course_dir = root / course_name
    if not course_dir.is_dir():
        return 0
    count = 0
    digests = course_dir / "digests"
    if digests.is_dir():
        for digest in sorted(digests.glob("*.md")):
            rel = digest.relative_to(root)
            index_markdown_file(conn, root, rel, kind="digest")
            count += 1
    course_md = course_dir / "course.md"
    if course_md.is_file():
        rel = course_md.relative_to(root)
        index_markdown_file(conn, root, rel, kind="course_md")
        count += 1
    _delete_course_study_rows(conn, course_name)
    lookup = _SourceLookup(course_dir)
    count += _index_flashcards(conn, course_name, course_dir, lookup)
    count += _index_quiz(conn, course_name, course_dir, lookup)
    count += _index_concepts(conn, course_name, course_dir, lookup)
    if own_conn:
        conn.commit()
        conn.close()
    return count


def reindex_root(root: Path, settings: WorkerSettings | None = None) -> dict[str, int]:
    root = Path(root)
    settings = settings or default_settings()
    conn = open_db(root)
    conn.execute("DELETE FROM search_index")
    totals: dict[str, int] = {}
    for course in sorted(p for p in root.iterdir() if p.is_dir()):
        if course.name in {".git", ".arbor", settings.cache_dir_name}:
            continue
        totals[course.name] = index_course(root, course.name, conn=conn)
    conn.commit()
    conn.close()
    return totals


def index_courses(root: Path, course_names: list[str]) -> int:
    root = Path(root)
    conn = open_db(root)
    indexed = 0
    for name in course_names:
        indexed += index_course(root, name, conn=conn)
    conn.commit()
    conn.close()
    return indexed
