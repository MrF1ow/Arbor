from arbor_worker.alignment import PageRange, align_fingerprints


def test_identical_sequences_have_no_dirty_ranges():
    stored = ["a", "b", "c"]
    result = align_fingerprints(stored, ["a", "b", "c"])
    assert result.status == "identical"
    assert result.suggested_ranges == []
    assert result.matched_fraction == 1.0


def test_clean_append_suggests_new_tail_range():
    stored = ["a", "b", "c"]
    current = ["a", "b", "c", "d", "e"]
    result = align_fingerprints(stored, current)
    assert result.status == "clean_append"
    assert result.suggested_ranges == [PageRange(4, 5)]
    assert result.matched_fraction == 1.0


def test_mid_insert_marks_inserted_pages_dirty():
    stored = ["a", "b", "c", "d"]
    current = ["a", "b", "x", "y", "c", "d"]
    result = align_fingerprints(stored, current)
    assert result.status == "changed"
    assert result.suggested_ranges == [PageRange(3, 4)]
    assert result.matched_fraction == 1.0


def test_mid_edit_marks_changed_page_dirty():
    stored = ["a", "b", "c", "d", "e"]
    current = ["a", "b", "x", "d", "e"]
    result = align_fingerprints(stored, current)
    assert result.status == "changed"
    assert result.suggested_ranges == [PageRange(3, 3)]
    assert result.matched_fraction == 0.8


def test_duplicate_heavy_alignment_is_ambiguous():
    stored = ["a", "b", "a"]
    current = ["a", "a", "b", "a"]
    result = align_fingerprints(stored, current)
    assert result.status == "ambiguous"
    assert result.suggested_ranges == []
    assert result.matched_fraction == 1.0


def test_low_match_fraction_is_ambiguous():
    stored = ["a", "b", "c", "d", "e"]
    current = ["v", "w", "x", "y", "z"]
    result = align_fingerprints(stored, current)
    assert result.status == "ambiguous"
    assert result.suggested_ranges == []
    assert result.matched_fraction == 0.0
