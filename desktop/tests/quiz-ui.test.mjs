import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quiz panel exposes generation, pack controls, and settings", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  for (const id of [
    "quiz-empty",
    "generate-quiz",
    "quiz-pack",
    "quiz-stale",
    "refresh-quiz",
    "quiz-count",
    "quiz-prompt",
    "quiz-choice-0",
    "quiz-choice-1",
    "quiz-choice-2",
    "quiz-choice-3",
    "quiz-submit",
    "quiz-explanation",
    "quiz-source",
    "quiz-prev",
    "quiz-next",
    "toggle-auto-quiz",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(
    html,
    /id="generate-quiz"[^>]*disabled/,
    "quiz generation must not be permanently disabled",
  );
  assert.match(
    html,
    /id="toggle-auto-quiz"[^>]*aria-label="Auto-generate quiz"/,
  );
  assert.match(html, /Auto-generate quiz after Update/);
});
