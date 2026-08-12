import pytest

from arbor_worker.alignment import PageRange, align_fingerprints


def test_identical_sequences():
    stored = ["a", "b", "c"]
    result = align_fingerprints(stored, list(stored))
    assert result.status == "identical"
    assert result.suggested_ranges == []
    assert result.matched_fraction == 1.0


def test_clean_append():
    stored = ["a", "b", "c"]
    current = ["a", "b", "c", "d", "e"]
    result = align_fingerprints(stored, current)
    assert result.status == "clean_append"
    assert result.suggested_ranges == [PageRange(4, 5)]
    assert result.matched_fraction == 1.0


def test_mid_insert():
    stored = ["a", "b", "c"]
    current = ["a", "x", "b", "c"]
    result = align_fingerprints(stored, current)
    assert result.status == "changed"
    assert result.suggested_ranges == [PageRange(2, 2)]


def test_mid_edit():
    stored = [f"p{i}" for i in range(1, 11)]
    current = list(stored)
    current[4] = "p5-edited"
    result = align_fingerprints(stored, current)
    assert result.status == "changed"
    assert result.suggested_ranges == [PageRange(5, 5)]


def test_ambiguous_low_match_fraction():
    stored = ["a", "b", "c", "d", "e"]
    current = ["x", "y", "z", "w", "v"]
    result = align_fingerprints(stored, current)
    assert result.status == "ambiguous"
    assert result.suggested_ranges == []
    assert result.matched_fraction < 0.8


def test_ambiguous_duplicate_heavy():
    stored = ["dup", "a", "dup", "b"]
    current = ["dup", "dup", "a", "b"]
    result = align_fingerprints(stored, current)
    assert result.status == "ambiguous"
    assert result.suggested_ranges == []


def test_page_range_validation():
    with pytest.raises(ValueError):
        PageRange(0, 1)
    with pytest.raises(ValueError):
        PageRange(5, 3)
