import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared library sync UI and success paths", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of [
    "create-shared-library",
    "join-library",
    "library-create-dialog",
    "library-create-name",
    "library-create-error",
    "library-create-confirm",
    "library-create-cancel",
    "library-join-dialog",
    "library-join-url",
    "library-join-dest",
    "library-join-pick",
    "library-join-error",
    "library-join-confirm",
    "library-join-cancel",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const createConfirm = source.indexOf('libraryCreateConfirmBtn.addEventListener("click"');
  assert.ok(createConfirm >= 0, "library create confirm handler must exist");
  const createEnd = source.indexOf("\nlibraryJoinBtn.addEventListener", createConfirm);
  const createBody = source.slice(createConfirm, createEnd === -1 ? undefined : createEnd);
  assert.match(createBody, /entry\.kind = "shared"/);

  const joinConfirm = source.indexOf('libraryJoinConfirmBtn.addEventListener("click"');
  assert.ok(joinConfirm >= 0, "library join confirm handler must exist");
  const joinEnd = source.indexOf("\nsyncConflictCloseBtn.addEventListener", joinConfirm);
  const joinBody = source.slice(joinConfirm, joinEnd === -1 ? undefined : joinEnd);
  assert.match(joinBody, /switchKnowledgeRoot\(result\.path\)/);
});
