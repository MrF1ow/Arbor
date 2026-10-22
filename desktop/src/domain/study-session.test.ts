import { describe, expect, it } from "vitest";

import { createReview as createFlashReview } from "~/domain/flashcards";
import { createReview as createQuizReview } from "~/domain/quiz";
import {
  restoreFlashcards,
  restoreQuiz,
  snapshotFlashcards,
  snapshotQuiz,
  studySessionKey,
  trimStudySessions,
  type SavedFlashcards,
  type SavedQuiz,
} from "~/domain/study-session";
import type { FlashcardDeck, QuizPack } from "~/domain/types";

const deck: FlashcardDeck = {
  schema_version: 1,
  course: "bio",
  cards: [
    {
      id: "a",
      front: "A",
      back: "a",
      tags: [],
      source: { digest: "d", heading: null, page: null },
    },
    {
      id: "b",
      front: "B",
      back: "b",
      tags: [],
      source: { digest: "d", heading: null, page: null },
    },
    {
      id: "c",
      front: "C",
      back: "c",
      tags: [],
      source: { digest: "d", heading: null, page: null },
    },
  ],
};

const pack: QuizPack = {
  schema_version: 1,
  course: "bio",
  questions: [
    {
      id: "q1",
      type: "multiple_choice",
      prompt: "P1",
      choices: ["a", "b", "c", "d"],
      answer_index: 0,
      explanation: "E1",
      source: { digest: "d", heading: null },
    },
    {
      id: "q2",
      type: "multiple_choice",
      prompt: "P2",
      choices: ["a", "b", "c", "d"],
      answer_index: 1,
      explanation: "E2",
      source: { digest: "d", heading: null },
    },
  ],
};

const identity = "root|bio:ids";

describe("study-session domain", () => {
  it("builds stable session keys per root, course, and kind", () => {
    expect(studySessionKey("r1", "c1", "flashcards")).toBe("r1\0c1\0flashcards");
    expect(studySessionKey("r2", "c1", "quiz")).not.toBe(
      studySessionKey("r1", "c1", "quiz"),
    );
  });

  it("snapshots and restores flashcards with flip state", () => {
    const review = {
      ...createFlashReview(deck),
      index: 2,
      flipped: true,
    };
    const saved = snapshotFlashcards(review, "full", identity);
    const restored = restoreFlashcards(saved, deck, identity);
    expect(restored?.review.index).toBe(2);
    expect(restored?.review.flipped).toBe(true);
    expect(restored?.review.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(restored?.deckMode).toBe("full");
  });

  it("returns null when flashcard identity mismatches", () => {
    const saved = snapshotFlashcards(createFlashReview(deck), "due", identity);
    expect(restoreFlashcards(saved, deck, "other")).toBeNull();
  });

  it("drops removed flashcard ids and clamps index", () => {
    const saved: SavedFlashcards = {
      identity,
      savedAt: 1,
      deckMode: "full",
      cardIds: ["a", "missing", "c"],
      index: 2,
      flipped: false,
    };
    const restored = restoreFlashcards(saved, deck, identity);
    expect(restored?.review.cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(restored?.review.index).toBe(1);
  });

  it("returns null when no flashcards remain after restore", () => {
    const saved: SavedFlashcards = {
      identity,
      savedAt: 1,
      deckMode: "full",
      cardIds: ["gone"],
      index: 0,
      flipped: false,
    };
    expect(restoreFlashcards(saved, deck, identity)).toBeNull();
  });

  it("ignores corrupt flashcard snapshots", () => {
    expect(restoreFlashcards(null, deck, identity)).toBeNull();
    expect(restoreFlashcards({ identity }, deck, identity)).toBeNull();
  });

  it("restores quiz with submitted state at index", () => {
    let review = createQuizReview(pack);
    review = {
      ...review,
      index: 1,
      selected: 1,
      submitted: true,
      answers: { q1: 0, q2: 1 },
    };
    const saved = snapshotQuiz(review, identity);
    const restored = restoreQuiz(saved, pack, identity);
    expect(restored?.index).toBe(1);
    expect(restored?.submitted).toBe(true);
    expect(restored?.selected).toBe(1);
    expect(restored?.answers).toEqual({ q1: 0, q2: 1 });
  });

  it("drops answers for removed quiz questions", () => {
    const saved: SavedQuiz = {
      identity,
      savedAt: 1,
      questionIds: ["q1"],
      index: 0,
      selected: null,
      submitted: false,
      answers: { q1: 0, removed: 2 },
    };
    const restored = restoreQuiz(saved, pack, identity);
    expect(restored?.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(restored?.answers).toEqual({ q1: 0 });
  });

  it("ignores corrupt quiz snapshots", () => {
    expect(restoreQuiz({ identity, savedAt: "nope" }, pack, identity)).toBeNull();
  });

  it("trimStudySessions keeps newest entries", () => {
    const sessions: Record<string, SavedFlashcards> = {};
    for (let i = 0; i < 55; i += 1) {
      sessions[`k${i}`] = {
        identity: "x",
        savedAt: i,
        deckMode: "full",
        cardIds: ["a"],
        index: 0,
        flipped: false,
      };
    }
    const trimmed = trimStudySessions(sessions);
    expect(Object.keys(trimmed)).toHaveLength(50);
    expect(trimmed.k54).toBeDefined();
    expect(trimmed.k0).toBeUndefined();
  });
});
