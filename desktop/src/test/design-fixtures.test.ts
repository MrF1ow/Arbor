import { describe, expect, it } from "vitest";

import { buildLectureRows, countLectures, type LectureBadge } from "~/domain/lectures";
import { mergeToday } from "~/domain/today";
import {
  DESIGN_ROOT_GROUP,
  DESIGN_ROOT_MINE,
  designCoursesByRoot,
  designDigestStats,
  designDigests,
  designReadingState,
  designTodayPayload,
} from "~/test/fixtures/design";
import { createMockHandler } from "~/test/mock-handlers";

const NOW = new Date("2026-11-07T12:00:00Z");

function merged() {
  return mergeToday(
    Object.entries(designCoursesByRoot).map(([root, courses]) => ({
      root,
      payload: designTodayPayload(courses, NOW),
    })),
  );
}

describe("design fixtures cover what the screens render", () => {
  it("has two libraries with the design's classes", () => {
    expect(designCoursesByRoot[DESIGN_ROOT_MINE]).toEqual([
      "Cell Biology",
      "Organic Chemistry",
      "Microeconomics",
      "Modern History",
    ]);
    expect(designCoursesByRoot[DESIGN_ROOT_GROUP]).toEqual(["Genetics", "Neuroscience"]);
  });

  it("has due cards in several classes, with the design's counts", () => {
    const due = Object.fromEntries(merged().courses.map((c) => [c.course, c.due_ids.length]));
    expect(due).toEqual({
      "Cell Biology": 18,
      "Organic Chemistry": 15,
      Microeconomics: 8,
      "Modern History": 0,
      Genetics: 0,
      Neuroscience: 4,
    });
  });

  it("has exam dates and the nearest is Organic Chemistry's", () => {
    const summary = merged();
    expect(summary.courses.filter((c) => c.exam_date).length).toBeGreaterThan(2);
    expect(summary.next_exam).toMatchObject({ course: "Organic Chemistry", days_to_exam: 9 });
  });

  it('has weak topics including "4 of 9"', () => {
    const topics = merged().weak_topics.map((t) => [t.label, `${t.wrong} of ${t.wrong + t.correct}`]);
    expect(topics).toContainEqual(["Carbocation stability", "4 of 9"]);
    expect(topics).toContainEqual(["Active vs passive transport", "5 of 10"]);
    expect(topics).toContainEqual(["Cross-price elasticity", "3 of 6"]);
  });

  it("gives Cell Biology units with several lectures and every badge kind", () => {
    const rows = buildLectureRows(
      "Cell Biology",
      designDigests("Cell Biology"),
      designDigestStats("Cell Biology"),
      designReadingState(["Cell Biology"]),
    );
    expect(rows.map((g) => g.unit)).toEqual(["Gene expression", "Division", "Membranes", "Foundations"]);
    expect(rows.every((g) => g.lectures.length >= 3)).toBe(true);
    const badges: LectureBadge[] = rows.flatMap((g) => g.lectures.map((l) => l.badge));
    const kinds = new Set(badges.map((b) => (b ? (b.kind === "mastery" && b.weak ? "weak" : b.kind) : "none")));
    expect(kinds).toEqual(new Set(["mastery", "weak", "new", "unread", "none"]));
    const counts = countLectures(rows);
    expect(counts.all).toBe(14);
    expect(counts.weak).toBeGreaterThan(0);
    expect(counts.due).toBeGreaterThan(0);
  });

  it("joins digest-stats, reading state and list_digests on the same course-prefixed key", () => {
    const rows = buildLectureRows(
      "Cell Biology",
      designDigests("Cell Biology"),
      designDigestStats("Cell Biology"),
      designReadingState(["Cell Biology"]),
    );
    const transport = rows.flatMap((g) => g.lectures).find((l) => l.title === "Membrane transport")!;
    expect(transport.badge).toEqual({ kind: "unread" });
    expect(transport.weak).toBe(true);
  });
});

describe("test mode joins list_digests, digest-stats and reading state for an aliased legacy class", () => {
  it("shows mastery, weak, due and unread badges for cell-biology", () => {
    const handler = createMockHandler();
    const root = "/mock/knowledge/fall-2026";
    const digests = handler("list_digests", { root, course: "cell-biology" }) as ReturnType<typeof designDigests>;
    const stats = handler("study_progress", { root, course: "cell-biology", action: "digest-stats" }) as {
      digests: Parameters<typeof buildLectureRows>[2];
    };
    const reading = handler("read_reading_state", { root }) as Parameters<typeof buildLectureRows>[3];
    const rows = buildLectureRows("cell-biology", digests, stats.digests, reading);
    const lectures = rows.flatMap((group) => group.lectures);
    expect(lectures).toHaveLength(digests.length);
    const kinds = new Set(
      lectures.map((l) => (l.badge ? (l.badge.kind === "mastery" && l.badge.weak ? "weak" : l.badge.kind) : "none")),
    );
    expect(kinds.has("mastery")).toBe(true);
    expect(kinds.has("unread")).toBe(true);
    expect(lectures.some((l) => l.weak)).toBe(true);
    expect(lectures.some((l) => l.due > 0)).toBe(true);
    expect(countLectures(rows).due).toBeGreaterThan(0);
    expect(countLectures(rows).weak).toBeGreaterThan(0);
  });
});

describe("mock handler answers every #138 command", () => {
  const handler = createMockHandler();

  it("answers study_today per library and reading state, stats and plan", () => {
    const today = handler("study_today", { root: DESIGN_ROOT_GROUP }) as ReturnType<typeof designTodayPayload>;
    expect(today.courses.map((c) => c.course)).toEqual(["Genetics", "Neuroscience"]);
    expect(handler("read_reading_state", { root: DESIGN_ROOT_MINE })).toHaveProperty([
      "Cell Biology/digests/2026-10-08-membrane-transport.md",
    ]);
    expect(handler("study_progress", { root: DESIGN_ROOT_MINE, course: "Cell Biology", action: "stats" })).toHaveProperty("quiz");
    const stats = handler("study_progress", {
      root: DESIGN_ROOT_MINE,
      course: "Cell Biology",
      action: "digest-stats",
    }) as { digests: Record<string, unknown> };
    expect(Object.keys(stats.digests)).toHaveLength(14);
    expect(handler("usage_summary", { root: DESIGN_ROOT_MINE, days: 7 })).toHaveLength(2);
    expect(handler("write_reading_state", { root: DESIGN_ROOT_MINE, digest: "x", fraction: 0.5 })).toBeNull();
  });

  it("ticks a study plan task", () => {
    const before = handler("study_plan_status", { root: DESIGN_ROOT_MINE, course: "Cell Biology" }) as {
      done: number;
      tasks: { id: string; done: boolean }[];
    };
    const open = before.tasks.find((t) => !t.done)!;
    const after = handler("study_plan_toggle", {
      root: DESIGN_ROOT_MINE,
      course: "Cell Biology",
      task: open.id,
      done: true,
    }) as { done: number };
    expect(after.done).toBe(before.done + 1);
    handler("study_plan_toggle", { root: DESIGN_ROOT_MINE, course: "Cell Biology", task: open.id, done: false });
  });

  it("lets a test make one library's study_today fail", () => {
    const failing = createMockHandler({
      study_today: (args) => {
        if ((args as { root: string }).root === DESIGN_ROOT_GROUP) {
          throw new Error("worker server exited");
        }
        return designTodayPayload(designCoursesByRoot[DESIGN_ROOT_MINE]!, NOW);
      },
    });
    expect(() => failing("study_today", { root: DESIGN_ROOT_GROUP })).toThrow("worker server exited");
    expect(failing("study_today", { root: DESIGN_ROOT_MINE })).toBeTruthy();
  });
});
