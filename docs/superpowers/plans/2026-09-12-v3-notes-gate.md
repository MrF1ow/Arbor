# Version 3 Notes gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Version 3 storefront leftovers (Notes links/tables/markers, reserved course names, digest patch validation) and prove them locally so one MacBook batch can close Version 3.

**Architecture:** Keep the existing `desktop/src/markdown.ts` renderer; extend it instead of adding `marked`. Relative `digests/*.md` links call the existing `loadDigestPreview` path. Reserved Knowledge-root names stay a duplicated constant in Rust and Python with matching tests. Patch validation reuses `validate_digest` on each provider splice in `_apply_patch`.

**Tech Stack:** TypeScript Notes UI (Tauri v2), Rust `commands.rs` / `watch.rs`, Python worker `digest_update.py` / `courses.py`, pytest / cargo test / node:test.

## Global Constraints

- Do not implement Version 4 chat (issue #20). That era is blocked until the Version 3 Mac batch is recorded.
- Do not tag `v3.0.0` from this plan. This plan only clears **local** gates. The Mac batch in `mac-e2e.md` is a human/MacBook step after merge.
- Do not publish package `3.1.0` or `3.2.0`. Land on current package `2.2.0` Unreleased (or `2.3.0` only if `v2.2.0` is already tagged).
- Do not execute digest HTML. Link hrefs must reject `javascript:` and `data:`.
- Markdown remains the source of truth. Do not change digest filenames.
- After each task, update the matching rows in `docs/implementation-checklist.md` Implemented / Local/VM columns.

---

### Task 1: Render markdown links and strip closing page markers

**Files:**
- Modify: `desktop/src/markdown.ts`
- Test: `desktop/tests/markdown.test.mjs`

**Interfaces:**
- Consumes: existing `renderMarkdown(source: string): { html: string; pageChip: string | null }`
- Produces: the same function; `html` may contain `<a href="..." data-arbor-digest="...">` for safe relative digest links; opening and closing `arbor-pages` comments never appear in `html`

- [ ] **Step 1: Write the failing tests**

Add to `desktop/tests/markdown.test.mjs`:

```javascript
test("renders a markdown link and keeps the label", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("See [2026-08-22.md](digests/2026-08-22.md).\n");
  assert.match(html, /<a [^>]*href="digests\/2026-08-22\.md"/);
  assert.match(html, />2026-08-22\.md<\/a>/);
  assert.doesNotMatch(html, /\[2026-08-22\.md\]/);
});

test("rejects javascript hrefs", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("[x](javascript:alert(1))\n");
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /x/);
});

test("strips opening and closing arbor-pages markers", async () => {
  const { renderMarkdown } = await subject();
  const { html, pageChip } = renderMarkdown(
    "<!-- arbor-pages:1-4 -->\n# Title\n## Overview\nNotes.\n<!-- /arbor-pages:1-4 -->\n",
  );
  assert.equal(pageChip, "1–4");
  assert.doesNotMatch(html, /arbor-pages/);
  assert.doesNotMatch(html, /&lt;!--/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: FAIL on the new tests (`[2026-08-22.md]` still in html; closing marker still present).

- [ ] **Step 3: Extend `inlineFormat` and marker stripping**

In `desktop/src/markdown.ts`, strip both marker forms before parsing:

```typescript
source = source.replace(/<!--\s*\/?arbor-pages:[^>]+-->\s*/g, "");
```

Keep the existing opening-marker match for `pageChip`.

After `escapeHtml`, turn safe links into anchors. Digest-relative paths get `data-arbor-digest`:

```typescript
function safeHref(raw: string): { href: string; digest: string | null } | null {
  const href = raw.trim();
  if (/^(javascript|data|vbscript):/i.test(href)) return null;
  if (href.includes("..")) return null;
  const digestMatch = href.match(/^(?:\.\/)?(digests\/[^/#\s]+\.md)(?:#(.+))?$/i);
  if (digestMatch) {
    return { href: digestMatch[1], digest: digestMatch[1] };
  }
  if (/^https?:\/\//i.test(href) || href.startsWith("#")) {
    return { href, digest: null };
  }
  return null;
}
```

Replace `\[label\](url)` in the escaped string with `<a href="..." data-arbor-digest="...">label</a>` when `safeHref` returns a value; otherwise keep the escaped label only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: PASS including existing bold/list/heading tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/markdown.ts desktop/tests/markdown.test.mjs
git commit -m "feat(notes): render markdown links and hide page-marker comments"
```

---

### Task 2: Open relative digest links inside Notes

**Files:**
- Modify: `desktop/src/main.ts` (`loadDigestPreview`)
- Test: `desktop/tests/markdown.test.mjs` already covers `data-arbor-digest`; add a small handler test if one exists for Notes, otherwise a focused test module is not required if the click path is a 10-line listener. Prefer asserting the listener wiring with a node:test that imports a new `parseArborDigestHref` helper from `markdown.ts` if you extract it.

**Interfaces:**
- Consumes: `renderMarkdown` `data-arbor-digest` attribute; `loadDigestPreview(course, relativePath, heading?)`
- Produces: click on a digest link calls `loadDigestPreview(currentCourse, \`${currentCourse}/${digestPath}\`)` and does not navigate the webview

- [ ] **Step 1: Write a failing helper test**

Export `arborDigestTarget(href: string): string | null` from `markdown.ts` (the `digests/….md` path or null). Test it in `markdown.test.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: FAIL until the helper exists.

- [ ] **Step 3: Attach a click listener on `readingArticleEl`**

Inside `loadDigestPreview`, after setting `innerHTML`:

```typescript
readingArticleEl.querySelectorAll("a[data-arbor-digest]").forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    const digest = (anchor as HTMLElement).dataset.arborDigest;
    if (!digest || !currentCourse) return;
    void loadDigestPreview(currentCourse, `${currentCourse}/${digest}`);
  });
});
```

External `https:` links may keep default behavior (Tauri opener) — do not `preventDefault` unless `data-arbor-digest` is set.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd desktop && npm test && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/markdown.ts desktop/src/main.ts desktop/tests/markdown.test.mjs
git commit -m "feat(notes): open relative digest links in the reading pane"
```

---

### Task 3: Render GFM tables

**Files:**
- Modify: `desktop/src/markdown.ts` (`renderMarkdown` line loop)
- Test: `desktop/tests/markdown.test.mjs`

**Interfaces:**
- Consumes: GFM pipe rows (`| a | b |` plus a separator `| --- | --- |`)
- Produces: `<table><thead>…</thead><tbody>…</tbody></table>` with cell text passed through `inlineFormat`

- [ ] **Step 1: Write the failing test**

```javascript
test("renders a GFM table", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown(
    "| Drug | Use |\n| --- | --- |\n| Atenolol | Beta blocker |\n",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>Drug<\/th>/);
  assert.match(html, /<td>Atenolol<\/td>/);
  assert.doesNotMatch(html, /<p>\| Drug/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: FAIL (`<p>| Drug` or similar).

- [ ] **Step 3: Parse table blocks in `renderMarkdown`**

When the current line matches `/^\s*\|.+\|\s*$/` and the next line is a separator (`/^\s*\|[\s:|-]+\|\s*$/`), consume the header, separator, and following pipe rows into one table. Split cells on `|`, trim, run `inlineFormat` on each cell. Do not treat separator cells as body rows.

- [ ] **Step 4: Run tests**

Run: `cd desktop && npm test -- tests/markdown.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/markdown.ts desktop/tests/markdown.test.mjs
git commit -m "feat(notes): render GitHub-flavored markdown tables"
```

---

### Task 4: Shared reserved Knowledge-root names

**Files:**
- Modify: `desktop/src-tauri/src/commands.rs` (`is_course_dir_name`, `create_course` tests)
- Modify: `desktop/src-tauri/src/watch.rs` (`should_watch` — still ignore reserved root dirs)
- Modify: `python/src/arbor_worker/courses.py` (`IGNORED_DIR_NAMES`)
- Test: `python/tests/test_courses.py`, Rust tests in `commands.rs`

**Interfaces:**
- Consumes: Knowledge-root directory names
- Produces: the same reserved set in both languages: `_arbor_cache`, `.arbor`, `.git`, `study`, `digests` (case-insensitive for `_arbor_cache`)

- [ ] **Step 1: Write failing tests**

Rust: in `list_courses_skips_cache_and_dot_dirs`, also create `study` and `digests` at the root and assert they are not listed. `create_course(..., "study")` and `create_course(..., "digests")` return `Err`.

Python: in `test_ignores_root_files_cache_digests_and_dotdirs`, put a PDF under `tmp_path / "study"` and assert `discover_sources` does not treat `study` as a course.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop/src-tauri && cargo test list_courses_skips` and `cd python && uv run pytest tests/test_courses.py -q`

Expected: FAIL until `study` / `digests` are reserved.

- [ ] **Step 3: Implement the shared set**

Rust:

```rust
fn is_reserved_course_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "_arbor_cache"
        || lower == "study"
        || lower == "digests"
        || name.starts_with('.')
}
```

Use it from `is_course_dir_name`. Python: `IGNORED_DIR_NAMES = {".git", ".arbor", "study", "digests"}` (cache name is still passed in as `cache_dir_name`).

- [ ] **Step 4: Run tests**

Run: `cd desktop/src-tauri && cargo test` and `cd python && uv run pytest tests/test_courses.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/commands.rs desktop/src-tauri/src/watch.rs python/src/arbor_worker/courses.py python/tests/test_courses.py
git commit -m "fix(library): hide study and digests as Knowledge-root classes"
```

---

### Task 5: Validate digest patches the same way as create

**Files:**
- Modify: `python/src/arbor_worker/digest_update.py` (`_apply_patch`)
- Test: `python/tests/test_digest_update.py`

**Interfaces:**
- Consumes: `validate_digest(markdown, page_range=...)`
- Produces: `_apply_patch` raises `DigestError` when provider output for a span contains `_FORBIDDEN_LATEX` or fails structure/marker checks, leaving the caller without a spliced poison block

- [ ] **Step 1: Write the failing test**

```python
def test_patch_rejects_latex_in_provider_output():
    original = _coverage_digest()
    provider = FakeProvider(
        "<!-- arbor-pages:4-5 -->\n"
        + _complete_body("Patched")
        + "\n$$\\\\frac{1}{2}$$\n"
        + "<!-- /arbor-pages:4-5 -->\n"
    )
    with pytest.raises(DigestError, match="LaTeX"):
        _apply_patch_4_5(provider, original)
```

Use the same `_FORBIDDEN_LATEX` tokens the validator already checks (`\(`, `\[`, `\frac`) so the match is reliable:

```python
def test_patch_rejects_frac_in_provider_output():
    original = _coverage_digest()
    bad = (
        "<!-- arbor-pages:4-5 -->\n"
        "# Lecture\n## Overview\nThis overview is definitely long enough to pass.\n"
        "## Key Concepts\n- a\n## Important Details\n- \\frac{1}{2}\n"
        "## Questions to Review\n- c?\n"
        "<!-- /arbor-pages:4-5 -->\n"
    )
    with pytest.raises(DigestError, match="LaTeX"):
        _apply_patch_4_5(FakeProvider(bad), original)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd python && uv run pytest tests/test_digest_update.py::test_patch_rejects_frac_in_provider_output -q`

Expected: FAIL (patch currently splices without `validate_digest`).

- [ ] **Step 3: Call `validate_digest` on each generated span before `_extract_inner`**

In `_apply_patch`, after `generated = _run_provider(...).markdown`:

```python
validate_digest(generated, page_range=_to_marker_range(block))
inner = _extract_inner(generated, block)
```

- [ ] **Step 4: Run digest_update tests**

Run: `cd python && uv run pytest tests/test_digest_update.py -q`

Expected: PASS (existing patch tests still replace only the overlapping block).

- [ ] **Step 5: Commit**

```bash
git add python/src/arbor_worker/digest_update.py python/tests/test_digest_update.py
git commit -m "fix(digest): reject non-portable LaTeX on in-place patch"
```

---

### Task 6: Mark local gates on the checklist and stop

**Files:**
- Modify: `docs/implementation-checklist.md` (Version 3 remaining rows → Implemented [x], Local/VM [x])
- Modify: `CHANGELOG.md` Unreleased with the user-visible Notes/patch/reserved-dir lines

**Interfaces:**
- Consumes: Tasks 1–5 on `main` of this branch
- Produces: checklist Local/VM green for those rows; Mac batch rows still `[ ]`

- [ ] **Step 1: Run the full local suite**

```bash
cd python && uv run pytest -q
cd desktop/src-tauri && cargo test
cd desktop && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 2: Tick Implemented and Local/VM** for links, tables, markers, reserved dirs, and patch validation. Leave every Mac batch box unchecked.

- [ ] **Step 3: Commit**

```bash
git add docs/implementation-checklist.md CHANGELOG.md
git commit -m "docs: mark Version 3 Notes leftovers locally tested"
```

Do **not** start issue #20. Do **not** tag `v3.0.0`. Hand the Mac batch in `mac-e2e.md` to a MacBook when this branch is on `main`.
