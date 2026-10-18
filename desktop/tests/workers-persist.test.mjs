import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("persist includes workers in saved settings", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const persistStart = source.indexOf("async function persist()");
  assert.ok(persistStart >= 0, "persist must exist");
  const persistEnd = source.indexOf("\nasync function loadModels", persistStart);
  const persistBody = source.slice(persistStart, persistEnd === -1 ? undefined : persistEnd);
  assert.match(persistBody, /workers/);
  assert.match(persistBody, /workers,/);
});
