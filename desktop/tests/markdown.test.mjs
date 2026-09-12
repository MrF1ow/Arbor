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

test("strips opening and closing arbor-pages markers", async () => {
  const { renderMarkdown } = await subject();
  const { html, pageChip } = renderMarkdown(
    "<!-- arbor-pages:1-4 -->\n# Title\n## Overview\nNotes.\n<!-- /arbor-pages:1-4 -->\n",
  );
  assert.equal(pageChip, "1–4");
  assert.doesNotMatch(html, /arbor-pages/);
  assert.doesNotMatch(html, /&lt;!--/);
});
