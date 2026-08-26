import type {
  CardSource,
  JobFinished,
  QuizPack,
  QuizProgress,
  QuizProgressEntry,
  QuizQuestion,
  QuizReview,
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
  if (!isRecord(value)) throw new Error("question source must be an object");
  const heading = value.heading;
  if (heading !== undefined && heading !== null && typeof heading !== "string") {
    throw new Error("source.heading must be a string or null");
  }
  return {
    digest: nonBlankString(value.digest, "source.digest"),
    heading: typeof heading === "string" ? heading : null,
  };
}

function parseChoices(value: unknown): [string, string, string, string] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("question.choices must contain exactly 4 strings");
  }
  const choices = value.map((choice, index) =>
    nonBlankString(choice, `question.choices[${index}]`),
  );
  return [choices[0], choices[1], choices[2], choices[3]];
}

function parseQuestion(value: unknown): QuizQuestion {
  if (!isRecord(value)) throw new Error("question must be an object");
  if (value.type !== "multiple_choice") {
    throw new Error("question.type must be multiple_choice");
  }
  if (
    !Number.isInteger(value.answer_index) ||
    Number(value.answer_index) < 0 ||
    Number(value.answer_index) > 3
  ) {
    throw new Error("question.answer_index must be an integer from 0 to 3");
  }
  return {
    id: nonBlankString(value.id, "question.id"),
    type: "multiple_choice",
    prompt: nonBlankString(value.prompt, "question.prompt"),
    choices: parseChoices(value.choices),
    answer_index: Number(value.answer_index),
    explanation: nonBlankString(value.explanation, "question.explanation"),
    source: parseSource(value.source),
  };
}

export function parseQuizPack(value: unknown): QuizPack {
  if (!isRecord(value)) throw new Error("quiz pack must be an object");
  if (value.schema_version !== 1) {
    throw new Error("quiz pack schema_version must be 1");
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw new Error("quiz pack must contain at least one question");
  }
  return {
    schema_version: 1,
    course: nonBlankString(value.course, "pack.course"),
    questions: value.questions.map(parseQuestion),
  };
}

function parseProgressEntry(value: unknown): QuizProgressEntry {
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

export function parseQuizProgress(value: unknown): QuizProgress {
  if (!isRecord(value)) throw new Error("quiz progress must be an object");
  const progress: QuizProgress = {};
  for (const [id, entry] of Object.entries(value)) {
    progress[id] = parseProgressEntry(entry);
  }
  return progress;
}

export function createReview(pack: QuizPack): QuizReview {
  return {
    questions: [...pack.questions],
    index: 0,
    selected: null,
    submitted: false,
    answers: {},
  };
}

function restoreAt(review: QuizReview, index: number): QuizReview {
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

export function currentQuestion(review: QuizReview): QuizQuestion {
  return review.questions[review.index];
}

export function selectChoice(review: QuizReview, choiceIndex: number): QuizReview {
  if (review.submitted) return review;
  return { ...review, selected: choiceIndex };
}

export function submitChoice(
  review: QuizReview,
  choiceIndex: number,
  progress: QuizProgress,
): { review: QuizReview; progress: QuizProgress } {
  const question = currentQuestion(review);
  if (review.answers[question.id] !== undefined || review.submitted) {
    return { review, progress };
  }
  const current = progress[question.id] ?? { seen: 0, correct: 0, wrong: 0 };
  const correct = choiceIndex === question.answer_index;
  return {
    review: {
      ...review,
      selected: choiceIndex,
      submitted: true,
      answers: { ...review.answers, [question.id]: choiceIndex },
    },
    progress: {
      ...progress,
      [question.id]: {
        seen: current.seen + 1,
        correct: current.correct + (correct ? 1 : 0),
        wrong: current.wrong + (correct ? 0 : 1),
      },
    },
  };
}

export function nextReview(review: QuizReview): QuizReview {
  return restoreAt(review, (review.index + 1) % review.questions.length);
}

export function previousReview(review: QuizReview): QuizReview {
  return restoreAt(
    review,
    (review.index - 1 + review.questions.length) % review.questions.length,
  );
}

export function quizJobArgs(
  root: string,
  course: string,
  force: boolean,
  model: string,
) {
  return {
    root,
    course,
    skill: "quiz",
    force,
    model,
  };
}

export function shouldAutoGenerateQuiz(
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
