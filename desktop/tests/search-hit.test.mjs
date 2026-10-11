import assert from "node:assert/strict";
import test from "node:test";

class El {
  constructor() {
    this.className = "";
    this.textContent = "";
    this.childNodes = [];
  }

  append(...nodes) {
    this.childNodes.push(...nodes);
  }
}

test("search hit text is assigned as text, not HTML", async () => {
  globalThis.document = { createElement: () => new El() };
  const { renderSearchHit } = await import("../src/search-hit.ts");
  const btn = renderSearchHit({
    title: `<img src=x onerror=alert(1)>`,
    course: `a<b`,
    path: `c/d"`,
    page_range: `1<script>`,
    snippet: `&amp;`,
  });

  assert.equal(btn.className, "search-hit");
  assert.equal(btn.childNodes[0].className, "title");
  assert.equal(btn.childNodes[0].textContent, `<img src=x onerror=alert(1)>`);
  assert.equal(btn.childNodes[1].className, "sub");
  assert.equal(btn.childNodes[1].textContent, `a<b · c/d" · p.1<script>`);
  assert.equal(btn.childNodes[2].className, "snippet");
  assert.equal(btn.childNodes[2].textContent, `&amp;`);
});

test("search hit omits the page suffix when page_range is null", async () => {
  globalThis.document = { createElement: () => new El() };
  const { renderSearchHit } = await import("../src/search-hit.ts");
  const btn = renderSearchHit({
    title: "Title",
    course: "Biology",
    path: "Biology/digests/note.md",
    page_range: null,
    snippet: "snippet",
  });

  assert.equal(btn.childNodes[1].textContent, "Biology · Biology/digests/note.md");
});
