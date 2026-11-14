import { describe, expect, it } from "vitest";

import { mergeToday, type TodayCourseRow, type TodayPayload } from "~/domain/today";

function row(course: string, over: Partial<TodayCourseRow> = {}): TodayCourseRow {
  return {
    course,
    digest_count: 4,
    due_ids: [],
    deck_count: 0,
    mastered: 0,
    mastery: null,
    exam_date: null,
    days_to_exam: null,
    plan: null,
    ...over,
  };
}

function payload(over: Partial<TodayPayload> = {}): TodayPayload {
  return {
    courses: [],
    weak_topics: [],
    quiz_accuracy: {
      this_week: { correct: 0, total: 0 },
      last_week: { correct: 0, total: 0 },
    },
    next_exam: null,
    ...over,
  };
}

describe("mergeToday", () => {
  it("tags each class with its library and keeps every library's classes", () => {
    const merged = mergeToday([
      { root: "/k/mine", payload: payload({ courses: [row("Cell Biology", { due_ids: ["a", "b"] })] }) },
      { root: "/k/group", payload: payload({ courses: [row("Genetics", { due_ids: ["c"] })] }) },
    ]);
    expect(merged.courses.map((c) => [c.root, c.course, c.due_ids.length])).toEqual([
      ["/k/mine", "Cell Biology", 2],
      ["/k/group", "Genetics", 1],
    ]);
    expect(merged.errors).toEqual([]);
  });

  it("sums quiz accuracy counts across libraries", () => {
    const merged = mergeToday([
      {
        root: "/k/mine",
        payload: payload({
          quiz_accuracy: {
            this_week: { correct: 7, total: 10 },
            last_week: { correct: 1, total: 4 },
          },
        }),
      },
      {
        root: "/k/group",
        payload: payload({
          quiz_accuracy: {
            this_week: { correct: 2, total: 5 },
            last_week: { correct: 3, total: 6 },
          },
        }),
      },
    ]);
    expect(merged.quiz_accuracy).toEqual({
      this_week: { correct: 9, total: 15 },
      last_week: { correct: 4, total: 10 },
    });
  });

  it("keeps the earliest next exam and the library it belongs to", () => {
    const merged = mergeToday([
      {
        root: "/k/mine",
        payload: payload({
          next_exam: { course: "Cell Biology", exam_date: "2026-12-01", days_to_exam: 17 },
        }),
      },
      {
        root: "/k/group",
        payload: payload({
          next_exam: { course: "Genetics", exam_date: "2026-11-20", days_to_exam: 6 },
        }),
      },
      { root: "/k/empty", payload: payload() },
    ]);
    expect(merged.next_exam).toEqual({
      root: "/k/group",
      course: "Genetics",
      exam_date: "2026-11-20",
      days_to_exam: 6,
    });
  });

  it("has no next exam when no library has one", () => {
    expect(mergeToday([{ root: "/k/mine", payload: payload() }]).next_exam).toBeNull();
  });

  it("sorts weak topics by wrong rate and normalises digests to the course-prefixed path", () => {
    const merged = mergeToday([
      {
        root: "/k/mine",
        payload: payload({
          weak_topics: [
            {
              course: "Cell Biology",
              label: "Osmosis",
              digest: "digests/2026-09-12-membranes.md",
              heading: "Osmosis",
              wrong_rate: 0.3,
              wrong: 3,
              correct: 7,
            },
          ],
        }),
      },
      {
        root: "/k/group",
        payload: payload({
          weak_topics: [
            {
              course: "Genetics",
              label: "Linkage",
              digest: "Genetics/digests/2026-10-01-linkage.md",
              heading: null,
              wrong_rate: 4 / 9,
              wrong: 4,
              correct: 5,
            },
          ],
        }),
      },
    ]);
    expect(merged.weak_topics.map((t) => [t.label, t.root, t.digest, t.wrong, t.correct])).toEqual([
      ["Linkage", "/k/group", "Genetics/digests/2026-10-01-linkage.md", 4, 5],
      ["Osmosis", "/k/mine", "Cell Biology/digests/2026-09-12-membranes.md", 3, 7],
    ]);
  });

  it("lists a failing library in errors and still shows the others", () => {
    const merged = mergeToday([
      { root: "/k/mine", payload: payload({ courses: [row("Cell Biology")] }) },
      { root: "/k/broken", error: "worker server exited" },
    ]);
    expect(merged.courses.map((c) => c.course)).toEqual(["Cell Biology"]);
    expect(merged.errors).toEqual([{ root: "/k/broken", message: "worker server exited" }]);
  });
});
