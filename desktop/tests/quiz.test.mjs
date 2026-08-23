import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  try {
    return await import("../src/quiz.ts");
  } catch (error) {
    assert.fail(`quiz domain module could not load: ${error}`);
  }
}

const pack = {
  schema_version: 1,
  course: "Biology",
  questions: [
    {
      id: "q_11111111",
      type: "multiple_choice",
      prompt: "Where does glycolysis occur?",
      choices: ["Nucleus", "Cytoplasm", "Mitochondria", "Golgi"],
      answer_index: 1,
      explanation: "Glycolysis is cytoplasmic and does not require oxygen.",
      source: {
        digest: "digests/2026-08-15.md",
        heading: "Glycolysis",
      },
    },
    {
      id: "q_22222222",
      type: "multiple_choice",
      prompt: "What does mitosis produce?",
      choices: ["One cell", "Two cells", "Four cells", "Eight cells"],
      answer_index: 1,
      explanation: "Mitosis produces two daughter cells.",
      source: {
        digest: "digests/2026-08-16.md",
        heading: null,
      },
    },
  ],
};

test("parses a quiz pack at the JSON boundary", async () => {
  const { parseQuizPack } = await subject();

  assert.deepEqual(parseQuizPack(pack), pack);
  assert.throws(
    () => parseQuizPack({ ...pack, questions: [] }),
    /at least one question/,
  );
  assert.throws(
    () =>
      parseQuizPack({
        ...pack,
        questions: [{ ...pack.questions[0], choices: ["A", "B", "C"] }],
      }),
    /exactly 4/,
  );
  assert.throws(
    () =>
      parseQuizPack({
        ...pack,
        questions: [{ ...pack.questions[0], answer_index: 4 }],
      }),
    /answer_index/,
  );
});

test("parses quiz progress and rejects negative counts", async () => {
  const { parseQuizProgress } = await subject();
  const prior = {
    q_11111111: { seen: 2, correct: 1, wrong: 1 },
  };

  assert.deepEqual(parseQuizProgress(prior), prior);
  assert.throws(
    () => parseQuizProgress({ q_bad: { seen: -1, correct: 0, wrong: 0 } }),
    /non-negative integers/,
  );
});

test("builds Codex study job arguments", async () => {
  const { quizJobArgs } = await subject();

  assert.deepEqual(quizJobArgs("/knowledge", "Biology", true, "gpt-5.6-sol"), {
    root: "/knowledge",
    course: "Biology",
    skill: "quiz",
    force: true,
    model: "gpt-5.6-sol",
  });
});

test("auto-generates only after the matching successful update", async () => {
  const { shouldAutoGenerateQuiz } = await subject();

  assert.equal(
    shouldAutoGenerateQuiz(
      { job_id: "update-1", status: "succeeded", summary: null },
      "update-1",
      true,
    ),
    true,
  );
  assert.equal(
    shouldAutoGenerateQuiz(
      { job_id: "study-1", status: "succeeded", summary: null },
      "update-1",
      true,
    ),
    false,
  );
  assert.equal(
    shouldAutoGenerateQuiz(
      { job_id: "update-1", status: "failed", summary: null },
      "update-1",
      true,
    ),
    false,
  );
});

test("moves through questions and submits a choice", async () => {
  const {
    createReview,
    currentQuestion,
    nextReview,
    previousReview,
    submitChoice,
  } = await subject();
  const review = createReview(pack);

  assert.equal(currentQuestion(review).id, "q_11111111");
  assert.equal(review.submitted, false);
  assert.equal(review.selected, null);

  const { review: submitted, progress } = submitChoice(review, 1, {});
  assert.equal(submitted.submitted, true);
  assert.equal(submitted.selected, 1);
  assert.deepEqual(progress.q_11111111, { seen: 1, correct: 1, wrong: 0 });
  assert.equal(submitted.questions[0].explanation.length > 0, true);

  const wrong = submitChoice(review, 0, {});
  assert.deepEqual(wrong.progress.q_11111111, { seen: 1, correct: 0, wrong: 1 });

  const again = submitChoice(submitted, 2, progress);
  assert.deepEqual(again.progress, progress);
  assert.equal(again.review.selected, 1);

  assert.equal(nextReview(submitted).index, 1);
  assert.equal(nextReview(submitted).submitted, false);
  assert.equal(nextReview(submitted).selected, null);
  assert.equal(previousReview(nextReview(submitted)).index, 0);
  assert.equal(previousReview(review).index, 1);
});
