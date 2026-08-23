import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("graph tab exists with generate controls after quiz", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /data-mode="graph"/);
  assert.match(html, /data-panel="graph"/);
  for (const id of [
    "concepts-empty",
    "generate-concepts",
    "concepts-graph",
    "concept-stale",
    "refresh-concepts",
    "concept-list",
    "concept-summary",
    "concept-neighbors",
    "concept-sources",
    "notes-concept-chips",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.doesNotMatch(
    html,
    /id="generate-concepts"[^>]*disabled/,
    "concept generation must not be permanently disabled",
  );
  assert.doesNotMatch(
    html,
    /id="generate-quiz"[^>]*disabled/,
    "quiz generation must not be permanently disabled",
  );
  const quizIndex = html.indexOf('data-mode="quiz"');
  const graphIndex = html.indexOf('data-mode="graph"');
  assert.ok(quizIndex >= 0 && graphIndex > quizIndex, "Graph tab must follow Quiz");
});
