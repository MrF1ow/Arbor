import assert from "node:assert/strict";
import test from "node:test";

import { checkLine, lintFile } from "../scripts/check-styles.mjs";

test("hex color rule fires", () => {
  const hits = checkLine('const x = "#ff00aa";', { filePath: "x.tsx" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "hex-color");
});

test("style-allow with reason skips a line", () => {
  const hits = checkLine('const x = "#ff00aa"; // style-allow: fixture', { filePath: "x.tsx" });
  assert.equal(hits.length, 0);
});

test("style-allow without reason does not skip", () => {
  const hits = checkLine('const x = "#ff00aa"; // style-allow:', { filePath: "x.tsx" });
  assert.equal(hits.length, 1);
});

test("block style-allow skips a line", () => {
  const hits = checkLine('const x = "#ff00aa"; /* style-allow: fixture */', { filePath: "x.tsx" });
  assert.equal(hits.length, 0);
});

test("hex in URL fragment is not flagged", () => {
  const hits = checkLine('const u = "https://example.com/path#frag";', { filePath: "x.tsx" });
  assert.equal(hits.filter((h) => h.rule === "hex-color").length, 0);
});

test("url(#id) is not flagged as hex", () => {
  const hits = checkLine("mask: url(#clip);", { filePath: "x.css" });
  assert.equal(hits.filter((h) => h.rule === "hex-color").length, 0);
});

test("hex in static import specifier is not flagged", () => {
  const hits = checkLine('import x from "./assets/#hash-icon.svg";', { filePath: "x.tsx" });
  assert.equal(hits.filter((h) => h.rule === "hex-color").length, 0);
});

test("hex in dynamic import specifier is not flagged", () => {
  const hits = checkLine('const m = import("./pkg#fragment/module");', { filePath: "x.tsx" });
  assert.equal(hits.filter((h) => h.rule === "hex-color").length, 0);
});

test("rgb, hsl, and hsla are flagged", () => {
  assert.ok(checkLine("background: rgb(0 0 0);", { filePath: "x.css" }).some((h) => h.rule === "rgb-hsl"));
  assert.ok(checkLine("color: hsl(120 50% 50%);", { filePath: "x.css" }).some((h) => h.rule === "rgb-hsl"));
  assert.ok(checkLine("color: hsla(120 50% 50% / 0.5);", { filePath: "x.css" }).some((h) => h.rule === "rgb-hsl"));
});

test("tailwind arbitrary values with units and colors are flagged", () => {
  assert.ok(
    checkLine('<div className="mt-[7px]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
  assert.ok(
    checkLine('<div className="h-[100vh]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
  assert.ok(
    checkLine('<div className="duration-[200ms]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
  assert.ok(
    checkLine('<div className="w-[10PX]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
  assert.ok(
    checkLine('<div className="text-[#abc]" />', { filePath: "x.tsx" }).some((h) => h.rule === "tailwind-arbitrary"),
  );
});

test("inline style objects with prefixed layout keys are flagged", () => {
  assert.ok(
    checkLine('return <div style={{ backgroundColor: "red" }} />;', { filePath: "x.tsx" }).some(
      (h) => h.rule === "inline-style",
    ),
  );
  assert.ok(
    checkLine("return <div style={{ marginTop: 10 }} />;", { filePath: "x.tsx" }).some((h) => h.rule === "inline-style"),
  );
  assert.ok(
    checkLine("return <div style={{ minWidth: 10 }} />;", { filePath: "x.tsx" }).some((h) => h.rule === "inline-style"),
  );
});

test("multiline style objects are flagged", () => {
  const source = `export function X() {
  return (
    <div
      style={{
        paddingInline: 4,
      }}
    />
  );
}
`;
  const violations = lintFile("sample.tsx", source);
  assert.ok(violations.some((h) => h.rule === "inline-style"));
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
