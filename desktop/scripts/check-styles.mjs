#!/usr/bin/env node
/* eslint-env node */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(DESKTOP_ROOT, "src");

const ALLOW_SUFFIX = /\/\/\s*style-allow:\s*.+$/;

const RULES = [
  {
    id: "hex-color",
    test: (line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*import\s/.test(line),
    snippet: (line) => line.match(/#[0-9a-fA-F]{3,8}\b/)?.[0] ?? "hex",
  },
  {
    id: "rgb-hsl",
    test: (line) => /\b(?:rgb|rgba|hsl)\(/i.test(line),
    snippet: () => "color function",
  },
  {
    id: "tailwind-arbitrary",
    test: (line) => /-\[[0-9.]+(?:px|rem|em)\]/.test(line) || /-\[#/.test(line),
    snippet: (line) => line.match(/-\[[^\]]+\]/)?.[0] ?? "arbitrary",
  },
  {
    id: "inline-style",
    test: (line) =>
      /style=\{\{/.test(line) &&
      /\b(color|background|margin|padding|gap|fontSize|width|height)\b/.test(line),
    snippet: () => "style={{ … }}",
  },
];

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

export function checkLine(line, { filePath = "file.tsx" } = {}) {
  if (ALLOW_SUFFIX.test(line)) {
    return [];
  }

  const violations = [];
  for (const rule of RULES) {
    if (rule.test(line)) {
      violations.push({
        file: filePath,
        line: 0,
        rule: rule.id,
        snippet: rule.snippet(line),
      });
    }
  }

  if (/\.tsx$/.test(filePath) && hasDisallowedUnicode(line)) {
    violations.push({
      file: filePath,
      line: 0,
      rule: "unicode-glyph",
      snippet: "disallowed unicode",
    });
  }

  return violations;
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
