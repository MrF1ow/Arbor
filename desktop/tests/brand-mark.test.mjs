import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("brand mark assets and dark theme swap in shell chrome", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  const sidebar = html.slice(
    html.indexOf('<aside class="sidebar">'),
    html.indexOf('<div class="main-wrap">'),
  );
  assert.match(
    sidebar,
    /<img class="brand-mark" src="\/src\/assets\/arbor-mark\.png" alt="" \/>/,
  );
  assert.doesNotMatch(sidebar, /brand-mark">A/);

  assert.match(html, /<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/);

  const welcomePanel = html.slice(
    html.indexOf('id="panel-welcome"'),
    html.indexOf('id="panel-notes"'),
  );
  const h2Idx = welcomePanel.indexOf("<h2>Welcome to Arbor</h2>");
  const markIdx = welcomePanel.indexOf('class="welcome-mark"');
  assert.ok(markIdx >= 0 && markIdx < h2Idx, "welcome-mark must appear before Welcome h2");

  const brandRule = css.match(/\.brand-mark\s*\{[^}]+\}/);
  assert.ok(brandRule, "missing .brand-mark rule");
  assert.match(brandRule[0], /object-fit:\s*contain/);
  assert.match(brandRule[0], /width:\s*28px/);
  assert.doesNotMatch(brandRule[0], /background:/);

  assert.match(css, /content:\s*url\("\/src\/assets\/arbor-mark-dark\.png"\)/);
});
