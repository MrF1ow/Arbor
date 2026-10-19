import assert from "node:assert/strict";
import test from "node:test";

import { checkLine, lintFile } from "../scripts/check-styles.mjs";

test("hex color rule fires", () => {
  const hits = checkLine('const x = "#ff00aa";', { filePath: "x.tsx" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "hex-color");
});

test("style-allow skips a line", () => {
  const hits = checkLine('const x = "#ff00aa"; // style-allow: fixture', { filePath: "x.tsx" });
  assert.equal(hits.length, 0);
});

test("rgb and hsl are flagged", () => {
  assert.ok(checkLine("background: rgb(0 0 0);", { filePath: "x.css" }).some((h) => h.rule === "rgb-hsl"));
  assert.ok(checkLine("color: hsl(120 50% 50%);", { filePath: "x.css" }).some((h) => h.rule === "rgb-hsl"));
});

test("tailwind arbitrary values are flagged", () => {
  assert.ok(
    checkLine('<div className="mt-[7px]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
  assert.ok(
    checkLine('<div className="text-[#abc]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
});

test("inline style objects with layout keys are flagged", () => {
  const hits = checkLine('return <div style={{ width: 10 }} />;', { filePath: "x.tsx" });
  assert.ok(hits.some((h) => h.rule === "inline-style"));
});

test("unicode glyphs are flagged in tsx except allowed punctuation", () => {
  assert.ok(checkLine("<p>Left ← arrow</p>", { filePath: "x.tsx" }).some((h) => h.rule === "unicode-glyph"));
  assert.equal(checkLine("<p>A · B → C</p>", { filePath: "x.tsx" }).length, 0);
});

test("lintFile reports line numbers", () => {
  const violations = lintFile("sample.tsx", 'const ok = "fine";\nconst bad = "#abc";\n');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
});
