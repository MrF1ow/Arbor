import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const capability = JSON.parse(
  await readFile(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
);

test("default capability grants desktop plugin permissions", () => {
  assert.ok(capability.permissions.includes("notification:default"));
  assert.ok(capability.permissions.includes("dialog:allow-open"));
});
