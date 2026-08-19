from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from arbor_worker.settings import WorkerSettings, default_settings

DB_NAME = "arbor.db"
TITLE_RE = re.compile(r"^#\s+(.+)", re.MULTILINE)
PAGE_MARKER_RE = re.compile(r"<!--\s*arbor-pages:(\d+)-(\d+)\s*-->")


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
) -> None:
    _delete_path(conn, path)
    conn.execute(
        """
        INSERT INTO search_index (course, path, kind, title, body, page_range, source_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (course, path, kind, title, body, page_range, source_path),
    )


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
