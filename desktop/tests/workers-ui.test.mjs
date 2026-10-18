import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings Workers panel markup and heading", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="worker-list"/);
  assert.match(html, /id="worker-label"/);
  assert.match(html, /id="worker-host"/);
  assert.match(html, /id="worker-port"/);
  assert.match(html, /id="worker-user"/);
  assert.match(html, /id="worker-identity"/);
  assert.match(html, /id="worker-cmd"/);
  assert.match(html, /id="worker-remote-root"/);
  assert.match(html, /id="worker-save"/);
  assert.match(html, /id="worker-test"/);
  assert.match(html, /id="worker-status"/);
  assert.match(html, /id="worker-roots"/);
  assert.match(html, /<h3>Workers<\/h3>/);
  assert.match(html, />Add worker</);
  assert.match(html, />Test connection</);
});

test("workers UI wiring in main.ts", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(source, /"test_worker_connection"/);

  const removeStart = source.indexOf("async function removeWorker");
  assert.ok(removeStart >= 0, "removeWorker must exist");
  const removeEnd = source.indexOf("\nasync function testWorkerConnectionFromForm", removeStart);
  const removeBody = source.slice(removeStart, removeEnd === -1 ? undefined : removeEnd);
  assert.match(removeBody, /entry\.worker_id === id/);
  assert.match(removeBody, /entry\.worker_id = null/);
  assert.match(removeBody, /await persist\(\)/);

  const rootStart = source.indexOf("async function setRootWorker");
  assert.ok(rootStart >= 0, "setRootWorker must exist");
  const rootEnd = source.indexOf("\nasync function saveWorkerFromForm", rootStart);
  const rootBody = source.slice(rootStart, rootEnd === -1 ? undefined : rootEnd);
  assert.match(rootBody, /entry\.worker_id = next/);
  assert.match(rootBody, /await persist\(\)/);

  const persistStart = source.indexOf("async function persist()");
  assert.ok(persistStart >= 0, "persist must exist");
  const persistEnd = source.indexOf("\nasync function loadModels", persistStart);
  const persistBody = source.slice(persistStart, persistEnd === -1 ? undefined : persistEnd);
  assert.match(persistBody, /workers,/);
});
