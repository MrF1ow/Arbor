import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return await import("../src/markdown.ts");
}

test("renders bold, italic, and inline code", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown(
    "Use **ATP** and *cytoplasm* plus `EC50` in the notes.\n",
  );

  assert.match(html, /<strong>ATP<\/strong>/);
  assert.match(html, /<em>cytoplasm<\/em>/);
  assert.match(html, /<code>EC50<\/code>/);
  assert.doesNotMatch(html, /\*\*ATP\*\*/);
});

test("renders numbered lists instead of a paragraph", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("1. First idea\n2. Second idea\n");

  assert.match(html, /<ol>/);
  assert.match(html, /<li>First idea<\/li>/);
  assert.match(html, /<li>Second idea<\/li>/);
  assert.doesNotMatch(html, /<p>1\. First idea/);
});

test("renders asterisk bullets", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("* mitochondria\n* nucleus\n");

  assert.match(html, /<ul>/);
  assert.match(html, /<li>mitochondria<\/li>/);
  assert.match(html, /<li>nucleus<\/li>/);
});

test("renders nested bullets from indented dashes", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("- outer\n  - inner\n");

  assert.match(html, /<ul>.*<li>outer<ul>.*<li>inner<\/li>.*<\/ul><\/li>.*<\/ul>/s);
});

test("keeps bold inside a list item", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("- **Key enzyme** in glycolysis\n");

  assert.match(html, /<li><strong>Key enzyme<\/strong> in glycolysis<\/li>/);
});

test("headingId slugs and renderMarkdown stamps h2 ids", async () => {
  const { headingId, renderMarkdown } = await subject();

  assert.equal(headingId("Cells"), "cells");
  assert.equal(headingId("Net yield (ATP)"), "net-yield-atp");
  assert.equal(headingId("Nested heading!"), "nested-heading");

  const { html } = renderMarkdown("## Cells\ntext\n### Nested heading!\n");
  assert.match(html, /<h2 id="cells">Cells<\/h2>/);
  assert.match(html, /<h3 id="nested-heading">Nested heading!<\/h3>/);
  assert.doesNotMatch(html, /<h1 id=/);
});

test("extractDigestTitle reads the H1 and skips page markers", async () => {
  const { extractDigestTitle } = await subject();

  assert.equal(
    extractDigestTitle(
      "<!-- arbor-pages:1-12 -->\n# Glycolysis net yield\n## Overview\nNotes.\n",
    ),
    "Glycolysis net yield",
  );
  assert.equal(extractDigestTitle("## Overview\nNo title here.\n"), null);
});

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

test("arborDigestTarget returns a digest path or null", async () => {
  const { arborDigestTarget } = await subject();

  assert.equal(arborDigestTarget("digests/2026-08-22.md"), "digests/2026-08-22.md");
  assert.equal(arborDigestTarget("./digests/2026-08-22.md"), "digests/2026-08-22.md");
  assert.equal(arborDigestTarget("digests/2026-08-22.md#cells"), "digests/2026-08-22.md");
  assert.equal(arborDigestTarget("https://example.com"), null);
  assert.equal(arborDigestTarget("#overview"), null);
  assert.equal(arborDigestTarget("javascript:alert(1)"), null);
  assert.equal(arborDigestTarget("data:text/html,hi"), null);
  assert.equal(arborDigestTarget("../secret.md"), null);
  assert.equal(arborDigestTarget("notes/other.md"), null);
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

test("applies data-arbor-page inside wrapped arbor-pages sections", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown(
    "<!-- arbor-pages:1-4 -->\n# Title\nBody line.\n<!-- /arbor-pages:1-4 -->\n",
  );
  assert.match(html, /data-arbor-page="1-4"/);
  assert.match(html, /<p data-arbor-page="1-4">Body line\.<\/p>/);
  assert.doesNotMatch(html, /1-4 -->/);
});

test("escapes raw script tags in paragraph source", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("<script>alert(1)</script>\n");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

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

test("recognizes inline arbor-pages markers on a prose line", async () => {
  const { renderMarkdown } = await subject();
  const source =
    "Preface.<!-- arbor-pages:1-1 -->\n# Title\nBody.\n<!-- /arbor-pages:1-1 -->\n";
  const { html } = renderMarkdown(source);
  assert.doesNotMatch(html, /arbor-pages/);
  assert.doesNotMatch(html, /<!--/);
  assert.match(html, /Preface\./);
  assert.match(html, /data-arbor-page="1-1"/);
});

test("inline marker mid-line splits page range for following text", async () => {
  const { renderMarkdown } = await subject();
  const { html } = renderMarkdown("before<!-- arbor-pages:2-3 -->after\n");
  assert.match(html, /before/);
  assert.match(html, /after/);
  assert.doesNotMatch(html, /<!--/);
  assert.doesNotMatch(html, /arbor-pages/);
  assert.match(html, /data-arbor-page="2-3">after/);
});
