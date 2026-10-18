import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sidebar groups courses under workspace roots", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="course-list"/);

  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const renderStart = source.indexOf("async function renderCourseList");
  assert.ok(renderStart >= 0, "renderCourseList must exist");
  const renderEnd = source.indexOf("\nfunction scrollNotesToHeading", renderStart);
  const renderBody = source.slice(renderStart, renderEnd === -1 ? undefined : renderEnd);
  assert.match(renderBody, /className = "workspace-root"/);
  assert.match(renderBody, /dataset\.root = entry\.path/);
  assert.match(renderBody, /list_courses", \{ root: entry\.path \}/);

  const switchStart = source.indexOf("async function switchKnowledgeRoot");
  assert.ok(switchStart >= 0, "switchKnowledgeRoot must exist");
  const switchEnd = source.indexOf("\nasync function renderCourseList", switchStart);
  const switchBody = source.slice(switchStart, switchEnd === -1 ? undefined : switchEnd);
  assert.match(switchBody, /start_folder_watch/);
  assert.match(switchBody, /loadJobHistory\(\)/);
  assert.match(switchBody, /searchInput\.value\.trim\(\)/);
  assert.match(switchBody, /runSearch\(searchInput\.value\)/);
  assert.match(renderBody, /switchKnowledgeRoot\(entry\.path\)/);

  const persistStart = source.indexOf("async function persist");
  const persistEnd = source.indexOf("\nasync function loadModels", persistStart);
  const persistBody = source.slice(persistStart, persistEnd === -1 ? undefined : persistEnd);
  assert.match(persistBody, /knowledge_roots: knowledgeRoots/);
  assert.match(persistBody, /active_root: knowledgeRoot/);
});
