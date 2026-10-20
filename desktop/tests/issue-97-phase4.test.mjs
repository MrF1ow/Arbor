import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("main.ts does not invoke list_providers", async () => {
  const source = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /invoke(\s*<[^>]*>)?\(\s*["']list_providers["']/);
});

test("flashcard grades enqueue study writes instead of awaiting study_progress", async () => {
  const source = await readFile(
    new URL("../src/components/flashcards/flashcards-view.tsx", import.meta.url),
    "utf8",
  );
  const gradeStart = source.indexOf("function gradeCard");
  assert.ok(gradeStart >= 0, "gradeCard function missing");
  const gradeEnd = source.indexOf("\n  useEffect", gradeStart);
  const gradeBody = source.slice(gradeStart, gradeEnd);
  assert.doesNotMatch(gradeBody, /await invoke\(\s*["']study_progress["']/);
  assert.match(gradeBody, /enqueueWrite\(/);
});

test("quiz grades enqueue study writes instead of awaiting study_progress", async () => {
  const source = await readFile(
    new URL("../src/components/quiz/quiz-view.tsx", import.meta.url),
    "utf8",
  );
  const submitStart = source.indexOf("function handleSubmit");
  assert.ok(submitStart >= 0, "handleSubmit function missing");
  const submitEnd = source.indexOf("useEffect(() => {", submitStart);
  const submitBody = source.slice(submitStart, submitEnd);
  assert.doesNotMatch(submitBody, /await invoke\(\s*["']study_progress["']/);
  assert.match(submitBody, /enqueueWrite\(/);
});
