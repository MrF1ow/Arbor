#!/usr/bin/env node
/* eslint-env node */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(DESKTOP_ROOT, "src");

const LINE_ALLOW = /(?:\/\/|\/\*)\s*style-allow:\s*\S/;

const STYLE_KEY =
  /\b(color|background[A-Za-z]*|margin[A-Za-z]*|padding[A-Za-z]*|gap|fontSize|width|height|minWidth|maxWidth|minHeight|maxHeight)\s*:/;

const LAYOUT_STYLE_KEY = /\b(flexGrow|flex|transform)\s*:/;

const ARBITRARY_UNIT =
  /-\[(?:[^\]]*(?:[0-9.]+(?:px|rem|em|vh|vw|ms|s|%)|#[0-9a-fA-F]{3,8})[^\]]*)\]/i;

const ALLOWED_PUNCT = new Set(["·", "…", "—", "–", "→"]);

function hasDisallowedUnicode(line) {
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (ALLOWED_PUNCT.has(char)) continue;
    if (code >= 0x2190 && code <= 0x2bff) return true;
    if (code >= 0x1f300 && code <= 0x1faff) return true;
  }
  return false;
}

function isAllowLine(line) {
  return LINE_ALLOW.test(line);
}

function stripHexFalsePositives(line) {
  let s = line;
  if (/^\s*import\s/.test(line) || /^\s*export\s+[^;]*\sfrom\s+['"]/.test(line)) {
    return "";
  }
  s = s.replace(/import\s*\(\s*(["'`])(?:\\.|(?!\1)[^\\])*\1\s*\)/g, 'import("")');
  s = s.replace(/https?:\/\/[^\s'"`)]+/gi, "");
  s = s.replace(/url\s*\(\s*#[^)]+\)/gi, "");
  return s;
}

function hexViolations(line) {
  const stripped = stripHexFalsePositives(line);
  if (!stripped) return [];
  const hits = [];
  const re = /#[0-9a-fA-F]{3,8}\b/g;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    hits.push(match[0]);
  }
  return hits;
}

function rgbHslViolations(line) {
  if (/\b(?:rgb|rgba|hsl|hsla)\(/i.test(line)) {
    return ["color function"];
  }
  return [];
}

function tailwindArbitraryViolations(line) {
  const hits = [];
  const re = /-\[[^\]]+\]/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    const inner = match[0].slice(2, -1);
    if (/[0-9.]+(?:px|rem|em|vh|vw|ms|s|%)|\#[0-9a-fA-F]{3,8}/i.test(inner)) {
      hits.push(match[0]);
    }
  }
  return hits;
}

function findMultilineStyleViolations(relativePath, source) {
  if (!/\.(tsx|jsx)$/.test(relativePath)) return [];

  const violations = [];
  const re = /style=\{\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const start = match.index;
    let depth = 2;
    let i = start + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    const block = source.slice(start, i);
    const line = source.slice(0, start).split("\n").length;
    const contextLine = source.split("\n")[line - 1] ?? "";
    if (isAllowLine(contextLine) || isAllowLine(block)) {
      continue;
    }
    if (STYLE_KEY.test(block) || LAYOUT_STYLE_KEY.test(block)) {
      violations.push({
        file: relativePath,
        line,
        rule: "inline-style",
        snippet: "style={{ … }}",
      });
    }
  }
  return violations;
}

export function checkLine(line, { filePath = "file.tsx" } = {}) {
  if (isAllowLine(line)) {
    return [];
  }

  const violations = [];

  for (const snippet of hexViolations(line)) {
    violations.push({ file: filePath, line: 0, rule: "hex-color", snippet });
  }

  for (const snippet of rgbHslViolations(line)) {
    violations.push({ file: filePath, line: 0, rule: "rgb-hsl", snippet });
  }

  for (const snippet of tailwindArbitraryViolations(line)) {
    violations.push({ file: filePath, line: 0, rule: "tailwind-arbitrary", snippet });
  }

  if (
    /style=\{\{/.test(line) &&
    (STYLE_KEY.test(line) || LAYOUT_STYLE_KEY.test(line))
  ) {
    violations.push({ file: filePath, line: 0, rule: "inline-style", snippet: "style={{ … }}" });
  }

  if (/\.tsx$/.test(filePath) && hasDisallowedUnicode(line)) {
    violations.push({
      file: filePath,
      line: 0,
      rule: "unicode-glyph",
      snippet: "disallowed unicode",
    });
  }

  if (/\bz-\d+\b/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "z-numeric", snippet: "z-<number>" });
  }

  if (/\b(bg|text|border|ring|from|to|via|fill|stroke|outline)-[a-z-]+\/\d+\b/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "color-opacity", snippet: "token/NN" });
  }

  if (/\bdark:(bg|text|border|ring)-/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "dark-color", snippet: "dark: color override" });
  }

  if (/\bshadow-(sm|md|lg|xl)\b/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "shadow-stock", snippet: "shadow-sm|md|lg|xl" });
  }

  if (/\bduration-\d+\b/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "duration-numeric", snippet: "duration-<number>" });
  }

  if (/\bease-linear\b/.test(line)) {
    violations.push({ file: filePath, line: 0, rule: "ease-linear", snippet: "ease-linear" });
  }

  return violations;
}

function shouldSkipFile(relativePath) {
  if (relativePath.startsWith("legacy/")) return true;
  if (relativePath === "index.css") return true;
  if (relativePath === "routeTree.gen.ts") return true;
  if (/\.test\.(ts|tsx)$/.test(relativePath)) return true;
  return false;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

export function lintFile(relativePath, source) {
  const lines = source.split("\n");
  const violations = [];
  for (let index = 0; index < lines.length; index++) {
    const lineViolations = checkLine(lines[index], { filePath: relativePath });
    for (const item of lineViolations) {
      violations.push({ ...item, line: index + 1 });
    }
  }
  violations.push(...findMultilineStyleViolations(relativePath, source));
  return violations;
}

export function lintProject(rootDir = SRC_ROOT) {
  const files = walk(rootDir);
  const violations = [];
  for (const absolute of files) {
    const relative = path.relative(rootDir, absolute).replaceAll("\\", "/");
    if (shouldSkipFile(relative)) continue;
    const source = fs.readFileSync(absolute, "utf8");
    violations.push(...lintFile(relative, source));
  }
  return violations;
}

function main() {
  const violations = lintProject();
  if (violations.length === 0) {
    return;
  }
  for (const item of violations) {
    console.error(`${item.file}:${item.line}: ${item.rule}: ${item.snippet}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
