from pathlib import Path

from arbor_worker.page_markers import PageRange, parse_page_markers, replace_page_marker


def _block(start: int, end: int, body: str) -> str:
    return f"<!-- arbor-pages:{start}-{end} -->\n{body}\n<!-- /arbor-pages:{start}-{end} -->"


def test_parse_finds_single_block():
    md = _block(40, 55, "section body")
    result = parse_page_markers(md)
    assert result.status == "ok"
    assert len(result.spans) == 1
    assert result.spans[0].page_range == PageRange(40, 55)
    assert result.spans[0].body == "section body"


def test_replace_inner_content_keeps_markers():
    md = _block(40, 55, "old notes")
    result = replace_page_marker(md, PageRange(40, 55), "new notes")
    assert result.status == "ok"
    assert result.markdown == _block(40, 55, "new notes")
    assert "<!-- arbor-pages:40-55 -->" in result.markdown
    assert "<!-- /arbor-pages:40-55 -->" in result.markdown
    assert "old notes" not in result.markdown


def test_replace_missing_markers():
    result = replace_page_marker("# notes\nno markers here\n", PageRange(1, 2), "x")
    assert result.status == "missing"
    assert result.markdown is None


def test_replace_missing_range_in_otherwise_valid_file():
    md = _block(1, 10, "first")
    result = replace_page_marker(md, PageRange(40, 55), "x")
    assert result.status == "missing"


def test_malformed_unclosed_open_marker():
    md = "<!-- arbor-pages:1-2 -->\nbody without a close\n"
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"
    result = replace_page_marker(md, PageRange(1, 2), "x")
    assert result.status == "malformed"


def test_malformed_extra_close_marker():
    md = "intro\n<!-- /arbor-pages:1-2 -->\n"
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"
    result = replace_page_marker(md, PageRange(1, 2), "x")
    assert result.status == "malformed"


def test_malformed_mismatched_open_and_close_range():
    md = "<!-- arbor-pages:40-55 -->\nbody\n<!-- /arbor-pages:40-56 -->"
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"
    result = replace_page_marker(md, PageRange(40, 55), "x")
    assert result.status == "malformed"


def test_malformed_nested_markers():
    md = (
        "<!-- arbor-pages:1-10 -->\n"
        "outer\n"
        "<!-- arbor-pages:4-5 -->\n"
        "inner\n"
        "<!-- /arbor-pages:4-5 -->\n"
        "<!-- /arbor-pages:1-10 -->\n"
    )
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"
    result = replace_page_marker(md, PageRange(4, 5), "x")
    assert result.status == "malformed"


def test_malformed_overlapping_page_ranges():
    md = _block(1, 10, "first") + "\n" + _block(8, 15, "second")
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"
    result = replace_page_marker(md, PageRange(1, 10), "x")
    assert result.status == "malformed"


def test_malformed_duplicate_ranges():
    md = _block(1, 10, "a") + "\n" + _block(1, 10, "b")
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"


def test_malformed_invalid_range_in_marker():
    md = "<!-- arbor-pages:10-5 -->\nbody\n<!-- /arbor-pages:10-5 -->"
    parsed = parse_page_markers(md)
    assert parsed.status == "malformed"


def test_parse_multi_block_file():
    md = (
        "# Title\n"
        + _block(1, 10, "first")
        + "\n\n"
        + _block(11, 20, "second")
        + "\n"
    )
    result = parse_page_markers(md)
    assert result.status == "ok"
    assert [span.page_range for span in result.spans] == [
        PageRange(1, 10),
        PageRange(11, 20),
    ]
    assert result.spans[0].body == "first"
    assert result.spans[1].body == "second"


def test_replace_one_block_leaves_siblings_unchanged(tmp_path: Path):
    original = (
        "# Lecture\n"
        + _block(1, 10, "keep this")
        + "\n\n"
        + _block(11, 20, "replace me")
        + "\n\n"
        + _block(21, 30, "also keep")
        + "\n"
    )
    fixture = tmp_path / "digest.md"
    fixture.write_text(original)

    result = replace_page_marker(fixture.read_text(), PageRange(11, 20), "patched body")
    assert result.status == "ok"
    assert result.markdown is not None

    rewritten = tmp_path / "out.md"
    rewritten.write_text(result.markdown)
    text = rewritten.read_text()

    assert _block(1, 10, "keep this") in text
    assert _block(11, 20, "patched body") in text
    assert _block(21, 30, "also keep") in text
    assert "replace me" not in text
    assert text.startswith("# Lecture\n")
    parsed = parse_page_markers(text)
    assert parsed.status == "ok"
    assert [span.body for span in parsed.spans] == [
        "keep this",
        "patched body",
        "also keep",
    ]
