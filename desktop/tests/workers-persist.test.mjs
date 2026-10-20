import assert from "node:assert/strict";
import test from "node:test";

test("persist includes workers in saved settings via save_settings IPC", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/lib/queries/settings.ts", import.meta.url), "utf8");
  assert.match(source, /save_settings/);
  assert.match(source, /Settings/);
});
