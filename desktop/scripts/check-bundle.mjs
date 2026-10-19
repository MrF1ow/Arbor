#!/usr/bin/env node
/* eslint-env node */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = path.join(__dirname, "..", "dist", "assets");
const ENTRY_GZIP_LIMIT = 250 * 1024;

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

if (!fs.existsSync(DIST_ASSETS)) {
  console.error("check-bundle: dist/assets not found — run vite build first");
  process.exit(1);
}

const jsFiles = fs
  .readdirSync(DIST_ASSETS)
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const full = path.join(DIST_ASSETS, name);
    return { name, full, gzip: gzipSize(full), raw: fs.statSync(full).size };
  })
  .sort((a, b) => b.gzip - a.gzip);

const entry =
  jsFiles.find((f) => /^index-/.test(f.name)) ??
  jsFiles.find((f) => f.name.includes("index")) ??
  jsFiles[0];

if (!entry) {
  console.error("check-bundle: no JS chunks found");
  process.exit(1);
}

console.log("Bundle chunks (gzip):");
for (const file of jsFiles) {
  console.log(`  ${file.name}\t${formatKb(file.gzip)} gzip\t${formatKb(file.raw)} raw`);
}

console.log(`\nEntry chunk: ${entry.name} → ${formatKb(entry.gzip)} gzip`);

if (entry.gzip > ENTRY_GZIP_LIMIT) {
  console.error(
    `check-bundle: entry gzip ${formatKb(entry.gzip)} exceeds limit ${formatKb(ENTRY_GZIP_LIMIT)}`,
  );
  process.exit(1);
}

console.log(`check-bundle: OK (entry ≤ ${formatKb(ENTRY_GZIP_LIMIT)} gzip)`);
