import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("flashcard panel exposes generation, deck controls, and settings", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  for (const id of [
    "flashcards-empty",
    "generate-flashcards",
    "flashcards-deck",
    "flashcard-stale",
    "refresh-flashcards",
    "flashcard-count",
    "flashcard-face",
    "flashcard-source",
    "flashcard-tags",
    "flashcard-prev",
    "flashcard-flip",
    "flashcard-next",
    "flashcard-shuffle",
    "toggle-auto-flashcards",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(
    html,
    /id="generate-flashcards"[^>]*disabled/,
    "flashcard generation must not be permanently disabled",
  );
  assert.match(
    html,
    /id="generate-quiz"[^>]*disabled/,
    "quiz generation must remain disabled",
  );
});
