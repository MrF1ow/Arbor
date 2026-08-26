import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return await import("../src/tauri.ts");
}

test("detects a missing Tauri IPC bridge", async () => {
  const { hasTauriInvoke } = await subject();

  assert.equal(hasTauriInvoke({}), false);
  assert.equal(hasTauriInvoke({ __TAURI_INTERNALS__: {} }), false);
  assert.equal(hasTauriInvoke({ __TAURI_INTERNALS__: { invoke: 1 } }), false);
  assert.equal(hasTauriInvoke({ __TAURI_INTERNALS__: null }), false);
});

test("detects a live Tauri invoke function", async () => {
  const { hasTauriInvoke } = await subject();

  assert.equal(
    hasTauriInvoke({ __TAURI_INTERNALS__: { invoke: async () => null } }),
    true,
  );
});

test("names the desktop window when IPC is missing", async () => {
  const { TAURI_UNAVAILABLE } = await subject();

  assert.match(TAURI_UNAVAILABLE, /desktop window/);
  assert.match(TAURI_UNAVAILABLE, /browser tab/);
});
