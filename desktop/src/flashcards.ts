import type {
  CardSource,
  Flashcard,
  FlashcardDeck,
  FlashcardProgress,
  FlashcardProgressEntry,
  FlashcardReview,
  JobFinished,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseSource(value: unknown): CardSource {
  if (!isRecord(value)) throw new Error("card source must be an object");
  const heading = value.heading;
  if (heading !== undefined && heading !== null && typeof heading !== "string") {
    throw new Error("source.heading must be a string or null");
  }
  return {
    digest: nonBlankString(value.digest, "source.digest"),
    heading: typeof heading === "string" ? heading : null,
  };
}

function parseCard(value: unknown): Flashcard {
  if (!isRecord(value)) throw new Error("card must be an object");
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    throw new Error("card.tags must be an array of strings");
  }
  return {
    id: nonBlankString(value.id, "card.id"),
    front: nonBlankString(value.front, "card.front"),
    back: nonBlankString(value.back, "card.back"),
    tags: [...value.tags],
    source: parseSource(value.source),
  };
}

export function parseFlashcardDeck(value: unknown): FlashcardDeck {
  if (!isRecord(value)) throw new Error("flashcard deck must be an object");
  if (value.schema_version !== 1) {
    throw new Error("flashcard deck schema_version must be 1");
  }
  if (!Array.isArray(value.cards) || value.cards.length === 0) {
    throw new Error("flashcard deck must contain at least one card");
  }
  return {
    schema_version: 1,
    course: nonBlankString(value.course, "deck.course"),
    cards: value.cards.map(parseCard),
  };
}

function parseProgressEntry(value: unknown): FlashcardProgressEntry {
  if (!isRecord(value)) throw new Error("progress entry must be an object");
  const counts = [value.seen, value.correct, value.wrong];
  if (!counts.every((count) => Number.isInteger(count) && Number(count) >= 0)) {
    throw new Error("progress counts must be non-negative integers");
  }
  return {
    seen: Number(value.seen),
    correct: Number(value.correct),
    wrong: Number(value.wrong),
  };
}

export function parseFlashcardProgress(value: unknown): FlashcardProgress {
  if (!isRecord(value)) throw new Error("flashcard progress must be an object");
  const progress: FlashcardProgress = {};
  for (const [id, entry] of Object.entries(value)) {
    progress[id] = parseProgressEntry(entry);
  }
  return progress;
}

export function incrementSeen(
  progress: FlashcardProgress,
  id: string,
): FlashcardProgress {
  const current = progress[id] ?? { seen: 0, correct: 0, wrong: 0 };
  return {
    ...progress,
    [id]: { ...current, seen: current.seen + 1 },
  };
}

export function shuffleCards(
  cards: readonly Flashcard[],
  random: () => number = Math.random,
): Flashcard[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function createReview(deck: FlashcardDeck): FlashcardReview {
  return {
    cards: [...deck.cards],
    index: 0,
    flipped: false,
  };
}

export function currentCard(review: FlashcardReview): Flashcard {
  return review.cards[review.index];
}

export function flipReview(review: FlashcardReview): FlashcardReview {
  return { ...review, flipped: !review.flipped };
}

export function nextReview(review: FlashcardReview): FlashcardReview {
  return {
    ...review,
    index: (review.index + 1) % review.cards.length,
    flipped: false,
  };
}

export function previousReview(review: FlashcardReview): FlashcardReview {
  return {
    ...review,
    index: (review.index - 1 + review.cards.length) % review.cards.length,
    flipped: false,
  };
}

export function flashcardJobArgs(
  root: string,
  course: string,
  force: boolean,
  model: string,
) {
  return {
    root,
    course,
    skill: "flashcards",
    force,
    model,
  };
}

export function shouldAutoGenerateFlashcards(
  finished: JobFinished,
  updateJobId: string | null,
  enabled: boolean,
): boolean {
  return (
    enabled &&
    updateJobId !== null &&
    finished.job_id === updateJobId &&
    finished.status === "succeeded"
  );
}
