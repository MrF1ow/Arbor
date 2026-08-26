import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  try {
    return await import("../src/flashcards.ts");
  } catch (error) {
    assert.fail(`flashcard domain module could not load: ${error}`);
  }
}

const deck = {
  schema_version: 1,
  course: "Biology",
  cards: [
    {
      id: "fc_11111111",
      front: "What is a cell?",
      back: "The basic unit of life.",
      tags: ["cells"],
      source: {
        digest: "digests/2026-08-15.md",
        heading: "Cells",
      },
    },
    {
      id: "fc_22222222",
      front: "What is mitosis?",
      back: "Cell division.",
      tags: [],
      source: {
        digest: "digests/2026-08-15.md",
        heading: null,
      },
    },
  ],
};

test("parses a flashcard deck at the JSON boundary", async () => {
  const { parseFlashcardDeck } = await subject();

  assert.deepEqual(parseFlashcardDeck(deck), deck);
  assert.throws(
    () => parseFlashcardDeck({ ...deck, cards: [] }),
    /at least one card/,
  );
});

test("grades again, wrong, and mastered without mutating prior progress", async () => {
  const { gradeFlashcard, parseFlashcardProgress } = await subject();
  const prior = {
    fc_11111111: { seen: 2, correct: 1, wrong: 1 },
  };

  const again = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "again");
  assert.deepEqual(again.fc_11111111, { seen: 3, correct: 1, wrong: 1 });

  const wrong = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "wrong");
  assert.deepEqual(wrong.fc_11111111, { seen: 3, correct: 1, wrong: 2 });

  const mastered = gradeFlashcard(parseFlashcardProgress(prior), "fc_11111111", "mastered");
  assert.deepEqual(mastered.fc_11111111, { seen: 3, correct: 2, wrong: 1 });

  assert.deepEqual(prior.fc_11111111, { seen: 2, correct: 1, wrong: 1 });
  assert.deepEqual(gradeFlashcard({}, "fc_new", "again").fc_new, {
    seen: 1,
    correct: 0,
    wrong: 0,
  });
});

test("advance after grade moves to the next card face down", async () => {
  const { createReview, flipReview, advanceAfterGrade } = await subject();
  const flipped = flipReview(createReview(deck));
  const next = advanceAfterGrade(flipped);
  assert.equal(next.index, 1);
  assert.equal(next.flipped, false);
});

test("increments seen without changing other progress", async () => {
  const { incrementSeen, parseFlashcardProgress } = await subject();
  const prior = {
    fc_11111111: { seen: 2, correct: 1, wrong: 1 },
  };

  const next = incrementSeen(parseFlashcardProgress(prior), "fc_11111111");

  assert.deepEqual(next.fc_11111111, { seen: 3, correct: 1, wrong: 1 });
  assert.deepEqual(prior.fc_11111111, { seen: 2, correct: 1, wrong: 1 });
  assert.deepEqual(incrementSeen({}, "fc_new").fc_new, {
    seen: 1,
    correct: 0,
    wrong: 0,
  });
  assert.throws(
    () => parseFlashcardProgress({ fc_bad: { seen: -1, correct: 0, wrong: 0 } }),
    /non-negative integers/,
  );
});

test("shuffles a copy of the deck", async () => {
  const { shuffleCards } = await subject();

  const shuffled = shuffleCards(deck.cards, () => 0);

  assert.deepEqual(
    shuffled.map((card) => card.id).sort(),
    deck.cards.map((card) => card.id).sort(),
  );
  assert.notDeepEqual(shuffled, deck.cards);
  assert.equal(deck.cards[0].id, "fc_11111111");
});

test("builds Codex study job arguments", async () => {
  const { flashcardJobArgs } = await subject();

  assert.deepEqual(
    flashcardJobArgs("/knowledge", "Biology", true, "gpt-5.6-sol"),
    {
      root: "/knowledge",
      course: "Biology",
      skill: "flashcards",
      force: true,
      model: "gpt-5.6-sol",
    },
  );
});

test("auto-generates only after the matching successful update", async () => {
  const { shouldAutoGenerateFlashcards } = await subject();

  assert.equal(
    shouldAutoGenerateFlashcards(
      { job_id: "update-1", status: "succeeded", summary: null },
      "update-1",
      true,
    ),
    true,
  );
  assert.equal(
    shouldAutoGenerateFlashcards(
      { job_id: "study-1", status: "succeeded", summary: null },
      "update-1",
      true,
    ),
    false,
  );
  assert.equal(
    shouldAutoGenerateFlashcards(
      { job_id: "update-1", status: "failed", summary: null },
      "update-1",
      true,
    ),
    false,
  );
});

test("moves through and flips the current card", async () => {
  const {
    createReview,
    currentCard,
    flipReview,
    nextReview,
    previousReview,
  } = await subject();
  const review = createReview(deck);

  assert.equal(currentCard(review).id, "fc_11111111");
  assert.equal(review.flipped, false);

  const flipped = flipReview(review);
  assert.equal(flipped.flipped, true);
  assert.equal(nextReview(flipped).index, 1);
  assert.equal(nextReview(flipped).flipped, false);
  assert.equal(previousReview(nextReview(flipped)).index, 0);
  assert.equal(previousReview(review).index, 1);
});
