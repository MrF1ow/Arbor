import type { FlashcardDeck, FlashcardReview, QuizPack, QuizReview } from "~/domain/types";

export type SavedFlashcards = {
  identity: string;
  savedAt: number;
  deckMode: "due" | "full";
  cardIds: string[];
  index: number;
  flipped: boolean;
};

export type SavedQuiz = {
  identity: string;
  savedAt: number;
  questionIds: string[];
  index: number;
  selected: number | null;
  submitted: boolean;
  answers: Record<string, number>;
};

export type SavedStudySession = SavedFlashcards | SavedQuiz;

export function studySessionKey(
  root: string,
  course: string,
  kind: "flashcards" | "quiz",
): string {
  return `${root}\0${course}\0${kind}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cardsFromIds(deck: FlashcardDeck, ids: readonly string[]) {
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const cards = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (card) {
      cards.push(card);
    }
  }
  return cards;
}

function questionsFromIds(pack: QuizPack, ids: readonly string[]) {
  const byId = new Map(pack.questions.map((q) => [q.id, q]));
  const questions = [];
  for (const id of ids) {
    const question = byId.get(id);
    if (question) {
      questions.push(question);
    }
  }
  return questions;
}

function quizAtIndex(review: QuizReview, index: number): QuizReview {
  const choice = review.answers[review.questions[index].id];
  if (choice === undefined) {
    return {
      ...review,
      index,
      selected: null,
      submitted: false,
    };
  }
  return {
    ...review,
    index,
    selected: choice,
    submitted: true,
  };
}

function parseSavedFlashcards(value: unknown): SavedFlashcards | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.identity !== "string" || value.identity === "") {
    return null;
  }
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) {
    return null;
  }
  if (value.deckMode !== "due" && value.deckMode !== "full") {
    return null;
  }
  if (
    !Array.isArray(value.cardIds) ||
    !value.cardIds.every((id) => typeof id === "string")
  ) {
    return null;
  }
  if (!Number.isInteger(value.index) || Number(value.index) < 0) {
    return null;
  }
  if (typeof value.flipped !== "boolean") {
    return null;
  }
  return {
    identity: value.identity,
    savedAt: value.savedAt,
    deckMode: value.deckMode,
    cardIds: [...value.cardIds],
    index: Number(value.index),
    flipped: value.flipped,
  };
}

function parseSavedQuiz(value: unknown): SavedQuiz | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.identity !== "string" || value.identity === "") {
    return null;
  }
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) {
    return null;
  }
  if (
    !Array.isArray(value.questionIds) ||
    !value.questionIds.every((id) => typeof id === "string")
  ) {
    return null;
  }
  if (!Number.isInteger(value.index) || Number(value.index) < 0) {
    return null;
  }
  if (
    value.selected !== null &&
    (!Number.isInteger(value.selected) || Number(value.selected) < 0)
  ) {
    return null;
  }
  if (typeof value.submitted !== "boolean") {
    return null;
  }
  if (!isRecord(value.answers)) {
    return null;
  }
  const answers: Record<string, number> = {};
  for (const [id, choice] of Object.entries(value.answers)) {
    if (!Number.isInteger(choice) || Number(choice) < 0) {
      return null;
    }
    answers[id] = Number(choice);
  }
  return {
    identity: value.identity,
    savedAt: value.savedAt,
    questionIds: [...value.questionIds],
    index: Number(value.index),
    selected: value.selected === null ? null : Number(value.selected),
    submitted: value.submitted,
    answers,
  };
}

export function snapshotFlashcards(
  review: FlashcardReview,
  deckMode: "due" | "full",
  identity: string,
): SavedFlashcards {
  return {
    identity,
    savedAt: Date.now(),
    deckMode,
    cardIds: review.cards.map((c) => c.id),
    index: review.index,
    flipped: review.flipped,
  };
}

export function restoreFlashcards(
  saved: unknown,
  deck: FlashcardDeck,
  identity: string,
): { review: FlashcardReview; deckMode: "due" | "full" } | null {
  const parsed = parseSavedFlashcards(saved);
  if (!parsed || parsed.identity !== identity) {
    return null;
  }
  const cards = cardsFromIds(deck, parsed.cardIds);
  if (cards.length === 0) {
    return null;
  }
  const index = Math.min(parsed.index, cards.length - 1);
  return {
    deckMode: parsed.deckMode,
    review: {
      cards,
      index,
      flipped: parsed.flipped,
    },
  };
}

export function snapshotQuiz(review: QuizReview, identity: string): SavedQuiz {
  return {
    identity,
    savedAt: Date.now(),
    questionIds: review.questions.map((q) => q.id),
    index: review.index,
    selected: review.selected,
    submitted: review.submitted,
    answers: { ...review.answers },
  };
}

export function restoreQuiz(
  saved: unknown,
  pack: QuizPack,
  identity: string,
): QuizReview | null {
  const parsed = parseSavedQuiz(saved);
  if (!parsed || parsed.identity !== identity) {
    return null;
  }
  const questions = questionsFromIds(pack, parsed.questionIds);
  if (questions.length === 0) {
    return null;
  }
  const questionIds = new Set(questions.map((q) => q.id));
  const answers: Record<string, number> = {};
  for (const [id, choice] of Object.entries(parsed.answers)) {
    if (questionIds.has(id)) {
      answers[id] = choice;
    }
  }
  const index = Math.min(parsed.index, questions.length - 1);
  const base: QuizReview = {
    questions,
    index,
    selected: null,
    submitted: false,
    answers,
  };
  return quizAtIndex(base, index);
}

export const STUDY_SESSION_CAP = 50;

export function trimStudySessions(
  sessions: Record<string, SavedStudySession>,
): Record<string, SavedStudySession> {
  const entries = Object.entries(sessions);
  if (entries.length <= STUDY_SESSION_CAP) {
    return sessions;
  }
  entries.sort((a, b) => a[1].savedAt - b[1].savedAt);
  return Object.fromEntries(entries.slice(entries.length - STUDY_SESSION_CAP));
}