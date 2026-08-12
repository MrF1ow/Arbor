from arbor_worker.alignment import PageRange
from arbor_worker.page_markers import (
    close_marker,
    open_marker,
    parse_markers,
    replace_block,
    wrap_range_body,
)


def test_wrap_and_parse_round_trip():
    body = "# Section\n\nNotes here."
    markdown = wrap_range_body(PageRange(2, 3), body) + wrap_range_body(PageRange(5, 5), "tail")
    parsed = parse_markers(markdown)
    assert parsed.status == "ok"
    assert len(parsed.blocks) == 2
    assert parsed.blocks[0].page_range == PageRange(2, 3)
    assert "# Section" in parsed.blocks[0].body
    assert parsed.blocks[1].page_range == PageRange(5, 5)


def test_replace_block_leaves_siblings():
    original = (
        wrap_range_body(PageRange(1, 2), "first")
        + wrap_range_body(PageRange(3, 4), "middle")
        + wrap_range_body(PageRange(5, 6), "last")
    )
    result = replace_block(original, PageRange(3, 4), "patched")
    assert result.status == "ok"
    assert result.markdown is not None
    assert "first" in result.markdown
    assert "patched" in result.markdown
    assert "last" in result.markdown
    assert "middle" not in result.markdown


def test_missing_markers():
    parsed = parse_markers("# no markers\n")
    assert parsed.status == "missing"


def test_malformed_unclosed():
    parsed = parse_markers(f"{open_marker(PageRange(1, 2))}\nbody\n")
    assert parsed.status == "malformed"


def test_malformed_mismatched_close():
    md = f"{open_marker(PageRange(1, 2))}\nbody\n{close_marker(PageRange(3, 4))}\n"
    parsed = parse_markers(md)
    assert parsed.status == "malformed"


def test_replace_missing_block():
    md = wrap_range_body(PageRange(1, 2), "only")
    result = replace_block(md, PageRange(9, 9), "nope")
    assert result.status == "missing"
