from pathlib import Path

import pytest

from arbor_worker.alignment import PageRange
from arbor_worker.course_manifest import DigestRecord
from arbor_worker.digest import DigestError, validate_digest
from arbor_worker.digest_update import DigestAction, apply_digest_action, classify_digest_actions
from arbor_worker.page_markers import parse_page_markers
from arbor_worker.prepare import PrepareResult
from arbor_worker.provider.base import ProviderRequest
from arbor_worker.provider.fake import FakeProvider


def _record(**over) -> DigestRecord:
    base = dict(
        source_path="Biology/mega.pdf",
        source_hash="hash-1",
        page_count=150,
        start_page=1,
        end_page=10,
        digest_file="digests/2026-08-12.md",
        model_id="fake-model",
        processing_path="pdf_images",
        generate_mode="single",
        chunk_count=None,
        digested_at="2026-08-12T00:00:00+00:00",
        page_markers_version=1,
    )
    base.update(over)
    return DigestRecord(**base)


def _block(start: int, end: int, body: str) -> str:
    return f"<!-- arbor-pages:{start}-{end} -->\n{body}\n<!-- /arbor-pages:{start}-{end} -->"


def _complete_body(title: str = "Lecture") -> str:
    return (
        f"# {title}\n"
        "## Overview\nThis overview is definitely long enough to pass.\n"
        "## Key Concepts\n- a\n"
        "## Important Details\n- b\n"
        "## Questions to Review\n- c?\n"
    )


def _marked(start: int, end: int, title: str = "Lecture") -> str:
    return _block(start, end, _complete_body(title).rstrip("\n")) + "\n"


def _coverage_digest() -> str:
    return (
        "# Lecture\n"
        + _block(1, 3, "notes for pages 1-3")
        + "\n\n"
        + _block(4, 5, "old notes for pages 4-5")
        + "\n\n"
        + _block(6, 10, "notes for pages 6-10")
        + "\n"
    )


def _kinds(actions: list[DigestAction]) -> list[tuple[str, str | None, int, int]]:
    return [(a.kind, a.digest_file, a.page_range.start, a.page_range.end) for a in actions]


def _page_images(count: int) -> list[Path]:
    return [Path(f"p{i}.png") for i in range(1, count + 1)]


def _apply_patch_4_5(provider: FakeProvider, original: str) -> str:
    return apply_digest_action(
        DigestAction("patch", PageRange(4, 5), digest_file="digests/2026-08-12.md"),
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=PrepareResult("pdf_images", image_paths=_page_images(10)),
        existing_markdown=original,
        cwd=Path("."),
    )


def test_no_overlap_creates():
    actions = classify_digest_actions(
        PageRange(11, 20),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": _marked(1, 10)},
    )
    assert _kinds(actions) == [("create", None, 11, 20)]


def test_partial_overlap_patches():
    actions = classify_digest_actions(
        PageRange(4, 5),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": _coverage_digest()},
    )
    assert _kinds(actions) == [("patch", "digests/2026-08-12.md", 4, 5)]


def test_full_coverage_change_regenerates():
    actions = classify_digest_actions(
        PageRange(1, 10),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": _marked(1, 10)},
    )
    assert _kinds(actions) == [("regenerate", "digests/2026-08-12.md", 1, 10)]


def test_missing_markers_regenerates():
    actions = classify_digest_actions(
        PageRange(4, 5),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": _complete_body()},
    )
    assert _kinds(actions) == [("regenerate", "digests/2026-08-12.md", 1, 10)]


def test_malformed_markers_regenerate():
    malformed = "<!-- arbor-pages:1-10 -->\nbody without a close\n"
    actions = classify_digest_actions(
        PageRange(4, 5),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": malformed},
    )
    assert _kinds(actions) == [("regenerate", "digests/2026-08-12.md", 1, 10)]


def test_multi_digest_overlap_patches_each_sub_range():
    records = [
        _record(),
        _record(
            start_page=11,
            end_page=20,
            digest_file="digests/2026-08-13.md",
            digested_at="2026-08-13T00:00:00+00:00",
        ),
    ]
    actions = classify_digest_actions(
        PageRange(8, 12),
        records,
        markdown_by_file={
            "digests/2026-08-12.md": _marked(1, 10),
            "digests/2026-08-13.md": _marked(11, 20),
        },
    )
    assert _kinds(actions) == [
        ("patch", "digests/2026-08-12.md", 8, 10),
        ("patch", "digests/2026-08-13.md", 11, 12),
    ]


def test_prefers_marker_ranges_over_record_end_page():
    # Record still has the phase-8 always-page_count end_page; markers declare 1-10.
    record = _record(end_page=150)
    actions = classify_digest_actions(
        PageRange(11, 20),
        [record],
        markdown_by_file={"digests/2026-08-12.md": _marked(1, 10)},
    )
    assert _kinds(actions) == [("create", None, 11, 20)]


def test_confirmed_range_extending_past_digest_patches_and_creates():
    actions = classify_digest_actions(
        PageRange(8, 15),
        [_record()],
        markdown_by_file={"digests/2026-08-12.md": _marked(1, 10)},
    )
    assert _kinds(actions) == [
        ("patch", "digests/2026-08-12.md", 8, 10),
        ("create", None, 11, 15),
    ]


def test_classify_reads_digest_from_course_dir(tmp_path: Path):
    course = tmp_path / "Biology"
    (course / "digests").mkdir(parents=True)
    (course / "digests" / "2026-08-12.md").write_text(_coverage_digest())
    actions = classify_digest_actions(
        PageRange(4, 5),
        [_record()],
        course_dir=course,
    )
    assert _kinds(actions) == [("patch", "digests/2026-08-12.md", 4, 5)]


def test_missing_digest_file_regenerates(tmp_path: Path):
    course = tmp_path / "Biology"
    course.mkdir()
    actions = classify_digest_actions(
        PageRange(4, 5),
        [_record()],
        course_dir=course,
    )
    assert _kinds(actions) == [("regenerate", "digests/2026-08-12.md", 1, 10)]


def test_create_apply_uses_marked_digest_generation():
    provider = FakeProvider(_marked(11, 20, "New coverage"))
    prep = PrepareResult("pdf_images", image_paths=_page_images(20))
    action = DigestAction("create", PageRange(11, 20), digest_file=None)
    markdown = apply_digest_action(
        action,
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=prep,
        cwd=Path("."),
    )
    validate_digest(markdown)
    parsed = parse_page_markers(markdown)
    assert parsed.status == "ok"
    assert [span.page_range.start for span in parsed.spans] == [11]
    assert provider.calls
    prompt = provider.calls[0].prompt
    assert "<!-- arbor-pages:11-20 -->" in prompt
    assert "<!-- /arbor-pages:11-20 -->" in prompt


def test_regenerate_apply_reuses_marked_digest_generation():
    provider = FakeProvider(_marked(1, 10, "Regenerated"))
    prep = PrepareResult("pdf_images", image_paths=_page_images(10))
    action = DigestAction("regenerate", PageRange(1, 10), digest_file="digests/2026-08-12.md")
    markdown = apply_digest_action(
        action,
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=prep,
        existing_markdown=_complete_body("Old unmarked"),
        cwd=Path("."),
    )
    validate_digest(markdown)
    parsed = parse_page_markers(markdown)
    assert parsed.status == "ok"
    assert [(s.page_range.start, s.page_range.end) for s in parsed.spans] == [(1, 10)]
    assert "Regenerated" in markdown
    assert "Old unmarked" not in markdown
    prompt = provider.calls[0].prompt
    assert "<!-- arbor-pages:1-10 -->" in prompt


def test_patch_range_4_5_only_that_block_changes(tmp_path: Path):
    course = tmp_path / "Biology"
    digest_rel = "digests/2026-08-12.md"
    digest_path = course / digest_rel
    digest_path.parent.mkdir(parents=True)
    original = _coverage_digest()
    digest_path.write_text(original)

    provider = FakeProvider("patched notes for pages 4-5")
    prep = PrepareResult("pdf_images", image_paths=_page_images(10))
    action = DigestAction("patch", PageRange(4, 5), digest_file=digest_rel)
    updated = apply_digest_action(
        action,
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=prep,
        existing_markdown=original,
        cwd=course,
    )
    digest_path.write_text(updated)

    text = digest_path.read_text()
    assert _block(1, 3, "notes for pages 1-3") in text
    assert _block(4, 5, "patched notes for pages 4-5") in text
    assert _block(6, 10, "notes for pages 6-10") in text
    assert "old notes for pages 4-5" not in text
    assert text.startswith("# Lecture\n")

    parsed = parse_page_markers(text)
    assert parsed.status == "ok"
    assert [span.body for span in parsed.spans] == [
        "notes for pages 1-3",
        "patched notes for pages 4-5",
        "notes for pages 6-10",
    ]

    assert len(provider.calls) == 1
    req = provider.calls[0]
    assert isinstance(req, ProviderRequest)
    assert "arbor-pages:4-5" in req.prompt
    assert "pages 4-5" in req.prompt.lower() or "4-5" in req.prompt
    for sibling in ("notes for pages 1-3", "notes for pages 6-10"):
        assert sibling not in req.prompt


def test_patch_provider_output_with_markers_replaces_inner_only():
    original = _coverage_digest()
    provider = FakeProvider(_block(4, 5, "model wrapped 4-5"))
    prep = PrepareResult("pdf_images", image_paths=_page_images(10))
    updated = apply_digest_action(
        DigestAction("patch", PageRange(4, 5), digest_file="digests/2026-08-12.md"),
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=prep,
        existing_markdown=original,
        cwd=Path("."),
    )
    assert _block(4, 5, "model wrapped 4-5") in updated
    assert updated.count("<!-- arbor-pages:4-5 -->") == 1
    assert "old notes for pages 4-5" not in updated
    assert _block(1, 3, "notes for pages 1-3") in updated


def test_patch_malformed_provider_output_raises_instead_of_poisoning():
    original = _coverage_digest()
    unclosed = "<!-- arbor-pages:4-5 -->\npatched notes without a close\n"
    mismatched = "<!-- arbor-pages:4-5 -->\npatched notes\n<!-- /arbor-pages:4-6 -->"
    for poison in (unclosed, mismatched):
        with pytest.raises(DigestError):
            _apply_patch_4_5(FakeProvider(poison), original)
        parsed = parse_page_markers(original)
        assert parsed.status == "ok"
        assert [span.body for span in parsed.spans] == [
            "notes for pages 1-3",
            "old notes for pages 4-5",
            "notes for pages 6-10",
        ]


def test_patch_wrong_range_wrappers_raises():
    original = _coverage_digest()
    with pytest.raises(DigestError):
        _apply_patch_4_5(FakeProvider(_block(1, 10, "full lecture dumped into 4-5")), original)


def test_patch_overlap_runs_provider_on_owning_span_images():
    original = _marked(1, 4)
    provider = FakeProvider(_marked(1, 4, "Patched span"))
    updated = apply_digest_action(
        DigestAction("patch", PageRange(2, 3), digest_file="digests/2026-08-12.md"),
        provider=provider,
        model_id="fake-model",
        source_name="mega.pdf",
        prep=PrepareResult("pdf_images", image_paths=_page_images(4)),
        existing_markdown=original,
        cwd=Path("."),
    )
    parsed = parse_page_markers(updated)
    assert parsed.status == "ok"
    assert [(s.page_range.start, s.page_range.end) for s in parsed.spans] == [(1, 4)]
    assert "Patched span" in updated
    assert len(provider.calls) == 1
    req = provider.calls[0]
    assert len(req.image_paths) == 4
    assert "arbor-pages:1-4" in req.prompt
    assert "arbor-pages:2-3" not in req.prompt


def test_digest_action_is_discriminated_union():
    create = DigestAction("create", PageRange(11, 20))
    patch = DigestAction("patch", PageRange(4, 5), digest_file="digests/a.md")
    regen = DigestAction("regenerate", PageRange(1, 10), digest_file="digests/a.md")
    assert create.kind == "create"
    assert patch.kind == "patch"
    assert regen.kind == "regenerate"
    assert create.digest_file is None
    assert isinstance(patch.page_range, PageRange)
