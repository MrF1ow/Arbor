import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("library chrome exposes add class, add files, and theme controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  for (const id of ["add-course", "add-course-form", "add-course-name", "add-files", "theme-toggle"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /\.content-panel\.active\[data-panel="notes"\]/);
  assert.match(css, /\.reading-pane \{[\s\S]*min-height: 0;/);
  assert.match(css, /\.notes-layout \{[\s\S]*min-height: 0;/);
  assert.match(css, /\.main-wrap \{[\s\S]*min-height: 0;/);
  assert.match(css, /\.main \{[\s\S]*min-height: 0;/);
});
