import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("main.ts does not invoke list_providers", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /invoke(\s*<[^>]*>)?\(\s*["']list_providers["']/);
});

test("flashcard and quiz grades enqueue study writes instead of awaiting study_progress", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const gradeStart = source.indexOf("function gradeCurrentFlashcard");
  const gradeEnd = source.indexOf("function abortIfSignedOut", gradeStart);
  const gradeBody = source.slice(gradeStart, gradeEnd);
  assert.doesNotMatch(gradeBody, /await invoke\(\s*["']study_progress["']/);
  assert.match(gradeBody, /studyWriteQueue\.enqueue/);

  const quizStart = source.indexOf('quizSubmitBtn.addEventListener("click"');
  const quizEnd = source.indexOf('quizNextBtn.addEventListener("click"', quizStart);
  const quizBody = source.slice(quizStart, quizEnd);
  assert.doesNotMatch(quizBody, /await invoke\(\s*["']study_progress["']/);
  assert.match(quizBody, /studyWriteQueue\.enqueue/);
});
