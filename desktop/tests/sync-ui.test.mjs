import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("successful sync with head_changed reloads the library like update commit", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const reloadStart = source.indexOf("function reloadLibraryAfterSync");
  assert.ok(reloadStart >= 0, "reloadLibraryAfterSync must exist");
  const reloadEnd = source.indexOf("\nasync function runSyncNow", reloadStart);
  const reloadBody = source.slice(reloadStart, reloadEnd === -1 ? undefined : reloadEnd);
  assert.match(reloadBody, /renderCourseList\(\)/);
  assert.match(reloadBody, /loadCourseContent\(currentCourse\)/);
  assert.match(reloadBody, /runSearch\(searchInput\.value\)/);

  const syncStart = source.indexOf("async function runSyncNow");
  const syncEnd = source.indexOf("\nasync function runSearch", syncStart);
  const syncBody = source.slice(syncStart, syncEnd === -1 ? undefined : syncEnd);
  assert.match(syncBody, /result\.head_changed[\s\S]*reloadLibraryAfterSync\(\)/);

  const continueStart = source.indexOf('syncConflictContinueBtn.addEventListener("click"');
  assert.ok(continueStart >= 0, "sync continue handler must exist");
  const continueEnd = source.indexOf('reindexBtn.addEventListener("click"', continueStart);
  const continueBody = source.slice(continueStart, continueEnd === -1 ? undefined : continueEnd);
  assert.match(continueBody, /result\.head_changed[\s\S]*reloadLibraryAfterSync\(\)/);

  const syncDoneIndex = source.indexOf('case "sync_done":');
  assert.ok(syncDoneIndex >= 0, "sync_done worker event handler must exist");
  const syncDoneSlice = source.slice(syncDoneIndex, syncDoneIndex + 200);
  assert.match(syncDoneSlice, /reloadLibraryAfterSync\(\)/);
});
