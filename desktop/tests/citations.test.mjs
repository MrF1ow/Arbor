import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function subject() {
  try {
    return await import("../src/citations.ts");
  } catch (error) {
    assert.fail(`citations module could not load: ${error}`);
  }
}

const report = {
  schema_version: 1,
  course: "Biology",
  failures: [
    {
      path: "study/flashcards.json",
      id: "fc_bogus",
      reason: "claim not in digest",
    },
  ],
};

test("parses a citations report at the JSON boundary", async () => {
  const { parseCitationsReport, failedIdsFor } = await subject();

  assert.deepEqual(parseCitationsReport(report), report);
  assert.deepEqual(
    [...failedIdsFor(parseCitationsReport(report), "study/flashcards.json")],
    ["fc_bogus"],
  );
  assert.deepEqual(
    [...failedIdsFor(parseCitationsReport(report), "study/quiz.json")],
    [],
  );
});

test("builds Codex study job arguments for citations", async () => {
  const { citationJobArgs } = await subject();

  assert.deepEqual(
    citationJobArgs("/knowledge", "Biology", true, "gpt-5.6-sol"),
    {
      root: "/knowledge",
      course: "Biology",
      skill: "citations",
      force: true,
      model: "gpt-5.6-sol",
    },
  );
});

test("jobs panel exposes a citations generate control", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  for (const id of [
    "generate-citations",
    "flashcard-citation",
    "quiz-citation",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});
