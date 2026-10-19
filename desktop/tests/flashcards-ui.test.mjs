import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("flashcard panel exposes generation, deck controls, and settings", async () => {
  const html = await readFile(new URL("../legacy.html", import.meta.url), "utf8");

  for (const id of [
    "study-overview",
    "study-plan-exam",
    "study-plan-generate",
    "study-plan-body",
    "study-recommendation-list",
    "explain-weakest",
    "make-card",
    "make-card-dialog",
    "make-card-front",
    "make-card-back",
    "make-card-save",
    "flashcards-empty",
    "generate-flashcards",
    "flashcard-due",
    "flashcard-all",
    "weak-topics",
    "flashcards-deck",
    "flashcard-stale",
    "refresh-flashcards",
    "flashcard-count",
    "flashcard-face",
    "flashcard-source",
    "flashcard-tags",
    "flashcard-prev",
    "flashcard-flip",
    "flashcard-again",
    "flashcard-wrong",
    "flashcard-mastered",
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
});
