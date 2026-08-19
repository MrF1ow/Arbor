from pathlib import Path

from arbor_worker.indexer import index_course, open_db, reindex_root
from tests.docx_helpers import make_docx


def test_reindex_finds_digest_text(tmp_path: Path):
    course = tmp_path / "Biology"
    digests = course / "digests"
    digests.mkdir(parents=True)
    digest = digests / "2026-08-19.md"
    digest.write_text("# Mitochondria\n\nPowerhouse of the cell.\n")
    totals = reindex_root(tmp_path)
    assert totals["Biology"] == 1
    conn = open_db(tmp_path)
    row = conn.execute(
        "SELECT title FROM search_index WHERE search_index MATCH 'mitochondria'"
    ).fetchone()
    conn.close()
    assert row is not None
    assert row[0] == "Mitochondria"


def test_index_course_after_write(tmp_path: Path):
    course = tmp_path / "Chem"
    digests = course / "digests"
    digests.mkdir(parents=True)
    (digests / "2026-08-20.md").write_text("# Bonds\n\nIonic and covalent.\n")
    count = index_course(tmp_path, "Chem")
    assert count == 1
