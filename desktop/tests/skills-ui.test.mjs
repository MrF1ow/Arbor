import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings Skills panel markup and button labels", async () => {
  const html = await readFile(new URL("../legacy.html", import.meta.url), "utf8");
  assert.match(html, /id="skill-index-source"/);
  assert.match(html, /id="skill-index-ref"/);
  assert.match(html, /id="skill-index-save"/);
  assert.match(html, /id="skill-browse"/);
  assert.match(html, /id="skill-status"/);
  assert.match(html, /id="skill-packages"/);
  assert.match(html, /<h3>Skills<\/h3>/);
  assert.match(html, />Save index</);
  assert.match(html, />Browse index</);

  const mainSource = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  assert.match(mainSource, /textContent = "Install"/);
  assert.match(mainSource, /textContent = "Confirm permissions"/);
  assert.match(mainSource, /textContent = "Run"/);
  assert.match(mainSource, /textContent = "Uninstall"/);
  assert.match(mainSource, /Provider packages are not installed/);
});

test("persist stores skill grants and run respects permission confirmation", async () => {
  const source = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  const persistStart = source.indexOf("async function persist()");
  assert.ok(persistStart >= 0, "persist must exist");
  const persistEnd = source.indexOf("\nasync function loadModels", persistStart);
  const persistBody = source.slice(persistStart, persistEnd === -1 ? undefined : persistEnd);
  assert.match(persistBody, /skill_grants:\s*skillGrants/);

  const runStart = source.indexOf("async function runSkillPackage");
  assert.ok(runStart >= 0, "runSkillPackage must exist");
  const runEnd = source.indexOf("\nasync function uninstallSkillPackage", runStart);
  const runBody = source.slice(runStart, runEnd === -1 ? undefined : runEnd);
  assert.match(runBody, /Run blocked until permissions are confirmed/);
  const blockedIdx = runBody.indexOf("Run blocked until permissions are confirmed");
  const invokeIdx = runBody.indexOf('invoke("skill_run"');
  assert.ok(blockedIdx >= 0 && invokeIdx >= 0, "run handler must contain blocked path and skill_run invoke");
  assert.ok(blockedIdx < invokeIdx, "blocked status must appear before skill_run invoke");

  const uninstallStart = source.indexOf("async function uninstallSkillPackage");
  const uninstallEnd = source.indexOf("\nlet syncConflictSelectedPath", uninstallStart);
  const uninstallBody = source.slice(uninstallStart, uninstallEnd === -1 ? undefined : uninstallEnd);
  assert.match(uninstallBody, /skillGrants = skillGrants\.filter\([\s\S]*g\.id !== pkg\.id/);
  assert.match(uninstallBody, /await persist\(\)/);
});
