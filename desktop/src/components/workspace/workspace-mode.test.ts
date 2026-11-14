import { describe, expect, it } from "vitest";

import { buildLectureRows } from "~/domain/lectures";
import {
  pickReadTarget,
  showsLectureColumn,
  workspaceLocation,
} from "~/components/workspace/workspace-mode";

describe("workspaceLocation", () => {
  it.each([
    ["/course/cell-biology/overview", "overview", null, null],
    ["/course/cell-biology/read/2026-09-12-membranes", "read", "2026-09-12-membranes", null],
    ["/course/cell-biology/map", "map", null, null],
    ["/course/cell-biology/practice/cards", "practice", null, "cards"],
    ["/course/cell-biology/practice/quiz", "practice", null, "quiz"],
    ["/course/cell-biology/ask", "ask", null, null],
    // The old paths still resolve to the matching view until they are deleted.
    ["/course/cell-biology/notes", "overview", null, null],
    ["/course/cell-biology/notes/2026-09-12-membranes", "read", "2026-09-12-membranes", null],
    ["/course/cell-biology/flashcards", "practice", null, "cards"],
    ["/course/cell-biology/quiz", "practice", null, "quiz"],
    ["/course/cell-biology/graph", "map", null, null],
    ["/course/cell-biology/chat", "ask", null, null],
    ["/course/Cell%20Biology/read/a%20b", "read", "a b", null],
  ])("%s", (path, mode, digestSlug, practiceTab) => {
    expect(workspaceLocation(path)).toEqual({ mode, digestSlug, practiceTab });
  });

  it("only Overview, Read and Map show the lecture column", () => {
    expect(
      (["overview", "read", "map", "practice", "ask"] as const).filter(showsLectureColumn),
    ).toEqual(["overview", "read", "map"]);
  });
});

describe("pickReadTarget", () => {
  const digests = [
    { title: "A", date: "2026-09-01", path: "c/digests/a.md", unit: "U1" },
    { title: "B", date: "2026-10-01", path: "c/digests/b.md", unit: "U2" },
    { title: "C", date: "2026-10-05", path: "c/digests/c.md", unit: "U2" },
  ];

  it("picks the most recently opened lecture", () => {
    const reading = {
      "c/digests/a.md": { fraction: 0.2, last_opened: "2026-10-20T10:00:00Z", read: false },
      "c/digests/b.md": { fraction: 1, last_opened: "2026-10-10T10:00:00Z", read: true },
    };
    expect(pickReadTarget(buildLectureRows("c", digests, {}, reading), reading)).toBe("c/digests/a.md");
  });

  it("falls back to the newest lecture, and to null without digests", () => {
    expect(pickReadTarget(buildLectureRows("c", digests, {}, {}), {})).toBe("c/digests/c.md");
    expect(pickReadTarget([], {})).toBeNull();
  });
});
