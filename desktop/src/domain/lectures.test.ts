import { describe, expect, it } from "vitest";

import {
  buildLectureRows,
  countLectures,
  filterLectures,
  scopeLabel,
  toCourseDigest,
  type DigestStatsRow,
  type ReadingEntry,
} from "~/domain/lectures";
import type { DigestInfo } from "~/domain/types";
import { fixtureConceptGraph } from "~/test/fixtures/data";

const COURSE = "Cell Biology";

function digest(name: string, date: string, unit: string | null, title = name): DigestInfo {
  return {
    title,
    date,
    path: `${COURSE}/digests/${name}.md`,
    unit,
    source_path: null,
  };
}

function stats(over: Partial<DigestStatsRow> = {}): DigestStatsRow {
  return {
    cards: 0,
    due: 0,
    mastered: 0,
    mastery: null,
    quiz_correct: 0,
    quiz_wrong: 0,
    card_correct: 0,
    card_wrong: 0,
    ...over,
  };
}

const opened = (read: boolean, fraction = read ? 1 : 0.4): ReadingEntry => ({
  fraction,
  last_opened: "2026-11-10T10:00:00Z",
  read,
});

describe("toCourseDigest", () => {
  it("maps every path form to the course-prefixed one", () => {
    const want = "Cell Biology/digests/2026-09-12-membranes.md";
    expect(toCourseDigest(COURSE, "digests/2026-09-12-membranes.md")).toBe(want);
    expect(toCourseDigest(COURSE, "Cell Biology/digests/2026-09-12-membranes.md")).toBe(want);
    expect(toCourseDigest(COURSE, "2026-09-12-membranes.md")).toBe(want);
  });

  it("maps a concept's sources[].digest path onto the lecture it cites", () => {
    const cited = fixtureConceptGraph.nodes.flatMap((node) => node.sources.map((source) => source.digest));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((path) => path.startsWith("digests/"))).toBe(true);
    expect(toCourseDigest(COURSE, cited[0]!)).toBe("Cell Biology/digests/2026-09-12-membranes.md");
    const rows = buildLectureRows(
      COURSE,
      [digest("2026-09-12-membranes", "2026-09-12", null, "Cell membranes")],
      {},
      {},
    );
    const lectureDigests = rows.flatMap((group) => group.lectures.map((lecture) => lecture.digest));
    expect(cited.map((path) => toCourseDigest(COURSE, path))).toContain(lectureDigests[0]);
  });
});

describe("buildLectureRows", () => {
  const digests = [
    digest("a", "2026-09-01", "Unit 1", "Cells"),
    digest("b", "2026-09-10", "Unit 1", "Membranes"),
    digest("c", "2026-10-05", "Unit 2", "Energy"),
    digest("d", "2026-10-20", "Unit 2", "Respiration"),
    digest("e", "2026-09-15", null, "Loose notes"),
  ];

  it("groups by unit, newest unit first, lectures in date order, no numbers", () => {
    const rows = buildLectureRows(COURSE, digests, {}, {});
    expect(rows.map((g) => g.unit)).toEqual(["Unit 2", "Lectures", "Unit 1"]);
    expect(rows[0]!.lectures.map((l) => l.title)).toEqual(["Energy", "Respiration"]);
    expect(rows[2]!.lectures.map((l) => l.title)).toEqual(["Cells", "Membranes"]);
    expect(rows[1]!.lectures[0]!.digest).toBe("Cell Biology/digests/e.md");
  });

  it("keys everything by the course-prefixed path whatever form digest-stats uses", () => {
    const rows = buildLectureRows(
      COURSE,
      [digest("a", "2026-09-01", "Unit 1")],
      { "digests/a.md": stats({ cards: 4, due: 2, mastered: 1, mastery: 0.25 }) },
      { "Cell Biology/digests/a.md": opened(true) },
    );
    const lecture = rows[0]!.lectures[0]!;
    expect(lecture.digest).toBe("Cell Biology/digests/a.md");
    expect(lecture.due).toBe(2);
    expect(lecture.badge).toEqual({ kind: "mastery", value: 25, weak: false });
  });

  it("badges: mastery with cards, New never opened, Unread opened not read, none once read", () => {
    const rows = buildLectureRows(
      COURSE,
      digests,
      { "digests/a.md": stats({ cards: 5, mastered: 3, mastery: 0.6 }) },
      {
        "Cell Biology/digests/b.md": opened(false),
        "Cell Biology/digests/c.md": opened(true),
      },
    );
    const byTitle = Object.fromEntries(rows.flatMap((g) => g.lectures).map((l) => [l.title, l.badge]));
    expect(byTitle["Cells"]).toEqual({ kind: "mastery", value: 60, weak: false });
    expect(byTitle["Membranes"]).toEqual({ kind: "unread" });
    expect(byTitle["Energy"]).toBeNull();
    expect(byTitle["Respiration"]).toEqual({ kind: "new" });
  });

  it("is weak at 3+ answers with more than 40% wrong, counting quiz and card answers", () => {
    const weak = (s: Partial<DigestStatsRow>) =>
      buildLectureRows(COURSE, [digest("a", "2026-09-01", "U")], { "digests/a.md": stats(s) }, {})[0]!
        .lectures[0]!.weak;
    expect(weak({ quiz_wrong: 4, quiz_correct: 5 })).toBe(true); // 4 of 9
    expect(weak({ quiz_wrong: 1, card_wrong: 1, quiz_correct: 1 })).toBe(true); // 2 of 3
    expect(weak({ quiz_wrong: 2, quiz_correct: 3 })).toBe(false); // exactly 40%
    expect(weak({ quiz_wrong: 2 })).toBe(false); // fewer than 3 answers
    expect(weak({ card_wrong: 3 })).toBe(true); // cards alone count
    expect(weak({})).toBe(false);
  });

  it("counts a missing answer count as 0 instead of turning the weak test into NaN", () => {
    const weak = (s: unknown) =>
      buildLectureRows(COURSE, [digest("a", "2026-09-01", "U")], { "digests/a.md": s as DigestStatsRow }, {})[0]!
        .lectures[0]!.weak;
    // An older worker sends no card_* counts: 4 wrong of 9 quiz answers is still weak.
    expect(weak({ digest: "digests/a.md", due: 0, quiz_wrong: 4, quiz_correct: 5 })).toBe(true);
    expect(weak({ digest: "digests/a.md", due: 0, card_wrong: 3 })).toBe(true);
    expect(weak({ digest: "digests/a.md", due: 0, quiz_wrong: 1, quiz_correct: 5 })).toBe(false);
    expect(weak({ digest: "digests/a.md", due: 0 })).toBe(false);
  });

  it("shows the weak flag in red on the mastery badge and never weakens on mastery alone", () => {
    const rows = buildLectureRows(
      COURSE,
      [digest("a", "2026-09-01", "U"), digest("b", "2026-09-02", "U")],
      {
        "digests/a.md": stats({ cards: 4, mastery: 0, card_wrong: 3, card_correct: 1 }),
        "digests/b.md": stats({ cards: 4, mastery: 0 }),
      },
      {},
    );
    const [a, b] = rows[0]!.lectures;
    expect(a!.badge).toEqual({ kind: "mastery", value: 0, weak: true });
    expect(a!.weak).toBe(true);
    expect(b!.badge).toEqual({ kind: "mastery", value: 0, weak: false });
    expect(b!.weak).toBe(false);
  });

  it("shows no percent badge when mastery is null", () => {
    const rows = buildLectureRows(
      COURSE,
      [digest("a", "2026-09-01", "U")],
      { "digests/a.md": stats({ cards: 2, mastery: null }) },
      { "Cell Biology/digests/a.md": opened(true) },
    );
    expect(rows[0]!.lectures[0]!.badge).toBeNull();
  });
});

describe("filterLectures and countLectures", () => {
  const digests = [
    digest("a", "2026-09-01", "Unit 1", "Cells"),
    digest("b", "2026-09-02", "Unit 1", "Membranes"),
    digest("c", "2026-10-05", "Unit 2", "Energy"),
  ];
  const rows = buildLectureRows(
    COURSE,
    digests,
    {
      "digests/a.md": stats({ cards: 4, due: 3, mastery: 0.1, card_wrong: 3, card_correct: 1 }),
      "digests/b.md": stats({ cards: 2, due: 0, mastery: 0.9 }),
    },
    { "Cell Biology/digests/b.md": opened(true), "Cell Biology/digests/c.md": opened(false) },
  );
  const titles = (filtered: ReturnType<typeof filterLectures>) =>
    filtered.flatMap((g) => g.lectures.map((l) => l.title));

  it("all keeps everything", () => {
    expect(titles(filterLectures(rows, "all"))).toEqual(["Energy", "Cells", "Membranes"]);
  });

  it("unread keeps lectures not read to the end, new or opened", () => {
    expect(titles(filterLectures(rows, "unread"))).toEqual(["Energy", "Cells"]);
  });

  it("weak keeps weak lectures and drops emptied units", () => {
    const weak = filterLectures(rows, "weak");
    expect(titles(weak)).toEqual(["Cells"]);
    expect(weak.map((g) => g.unit)).toEqual(["Unit 1"]);
  });

  it("due keeps lectures with due cards", () => {
    expect(titles(filterLectures(rows, "due"))).toEqual(["Cells"]);
  });

  it("counts every chip", () => {
    expect(countLectures(rows)).toEqual({ all: 3, unread: 2, weak: 1, due: 1 });
  });
});

describe("scopeLabel", () => {
  const rows = buildLectureRows(
    COURSE,
    [
      digest("a", "2026-09-01", "Unit 1"),
      digest("b", "2026-09-02", "Unit 1"),
      digest("c", "2026-10-05", "Unit 2"),
    ],
    {},
    {},
  );
  it("names the unit when the ticked lectures are one whole unit", () => {
    expect(
      scopeLabel(rows, ["Cell Biology/digests/a.md", "Cell Biology/digests/b.md"]),
    ).toBe("Unit 1 · 2 lectures");
  });
  it("counts lectures otherwise", () => {
    expect(scopeLabel(rows, ["Cell Biology/digests/a.md"])).toBe("1 lecture");
    expect(
      scopeLabel(rows, ["Cell Biology/digests/a.md", "Cell Biology/digests/c.md"]),
    ).toBe("2 lectures");
  });
  it("is null with nothing ticked", () => {
    expect(scopeLabel(rows, [])).toBeNull();
  });
});
