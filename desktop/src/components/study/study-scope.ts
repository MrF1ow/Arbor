import { digestKey } from "~/domain/concepts";
import { studySessionKey } from "~/domain/study-session";
import type { QuizReview } from "~/domain/types";

/**
 * A lecture's identity for comparing a ticked path with a card's source: `digests/x`, no course,
 * no `.md`. The course prefix goes first: `digestKey` cuts at the first `digests/`, which is inside
 * the course name of a class such as "Weekly digests". Paths made by the earlier
 * `toCourseDigest(course, "Course/digests/x.md")` carried a doubled `digests/` and match too.
 */
function lectureId(course: string, path: string): string {
  let rest = path.startsWith(`${course}/`) ? path.slice(course.length + 1) : path;
  while (rest.startsWith("digests/digests/")) {
    rest = rest.slice("digests/".length);
  }
  return digestKey(rest).replace(/\.md$/, "");
}

/**
 * The cards or questions of the ticked lectures (Q17). Sources name their digest as
 * `digests/x.md` while the scope holds `Course/digests/x.md`, so both go through
 * `lectureId`. An empty scope means the whole class: the items come back untouched.
 */
export function scopeItems<T extends { source: { digest: string } }>(
  course: string,
  items: readonly T[],
  scope: readonly string[],
): T[] {
  if (scope.length === 0) {
    return [...items];
  }
  const ticked = new Set(scope.map((path) => lectureId(course, path)));
  return items.filter((item) => ticked.has(lectureId(course, item.source.digest)));
}

/** Whether one source digest is among the ticked lectures. */
export function inScope(course: string, digest: string, scope: readonly string[]): boolean {
  return scopeItems(course, [{ source: { digest } }], scope).length > 0;
}

/** "this lecture" / "these 3 lectures", for the empty states that name the scope. */
export function scopeNoun(count: number): { these: string; their: string } {
  return count === 1
    ? { these: "this lecture", their: "its digest" }
    : { these: `these ${count} lectures`, their: "their digests" };
}

/**
 * The saved-session key: one per class and kind, and one more per set of ticked lectures, so
 * studying two lectures does not replace the whole-class session (its place and its answers).
 * An empty scope is the plain class key.
 */
export function scopedSessionKey(
  root: string,
  course: string,
  kind: "flashcards" | "quiz",
  scope: readonly string[],
): string {
  const base = studySessionKey(root, course, kind);
  return scope.length === 0 ? base : `${base}\0${[...scope].sort().join("\0")}`;
}

/** Correct answers out of the questions answered so far ("3 / 4 correct" on question 4 of 10). */
export function answeredScore(review: QuizReview): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const question of review.questions) {
    const answer = review.answers[question.id];
    if (answer === undefined) {
      continue;
    }
    total += 1;
    if (answer === question.answer_index) {
      correct += 1;
    }
  }
  return { correct, total };
}
