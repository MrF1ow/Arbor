import { describe, expect, it } from "vitest";

import {
  buildLectureRows,
  naturalCompare,
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

describe("a class whose folder name ends in digests (C41)", () => {
  const stats = { cards: 10, due: 2, mastered: 5, mastery: 0.5, quiz_correct: 0, quiz_wrong: 0, card_correct: 3, card_wrong: 1 };
  for (const course of ["Biology", "Weekly digests", "digests"]) {
    it(`${course}: list_digests path, digest-stats key and reading-state key join`, () => {
      const path = `${course}/digests/2026-09-01-a.md`; // list_digests (Rust) format
      const rows = buildLectureRows(
        course,
        [{ title: "A", date: "2026-09-01", path, unit: null, source_path: null } as never],
        { "digests/2026-09-01-a.md": stats }, // study_progress digest-stats key
        { [path]: { fraction: 1, last_opened: "2026-09-02T00:00:00Z", read: true } as never }, // read_reading_state key
      );
      const lecture = rows[0]!.lectures[0]!;
      expect(lecture.digest).toBe(path);
      expect(lecture.read).toBe(true);
      expect(lecture.badge).toEqual({ kind: "mastery", value: 50, weak: false });
      expect(toCourseDigest(course, path)).toBe(path);
      expect(toCourseDigest(course, "digests/2026-09-01-a.md")).toBe(path);
    });
  }
});

/** A digest whose stem is `T<hhmm>[-N]`, the way the worker names same-minute digests. */
function sourced(stem: string, source: string | null, unit: string | null = null): DigestInfo {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})/.exec(stem)!;
  return {
    title: stem,
    date: `${parts[1]}T${parts[2]}:${parts[3]}`,
    path: `${COURSE}/digests/${stem}.md`,
    unit,
    source_path: source === null ? null : `${COURSE}/${source}`,
  };
}

const order = (rows: ReturnType<typeof buildLectureRows>, unit?: string) =>
  (unit ? rows.find((g) => g.unit === unit)! : rows[0]!).lectures.map((l) =>
    l.digest.replace(`${COURSE}/digests/`, "").replace(".md", ""),
  );

describe("naturalCompare", () => {
  it("compares digit runs as numbers and ignores case", () => {
    expect(naturalCompare("09-a.pdf", "10-a.pdf")).toBeLessThan(0);
    expect(naturalCompare("Lecture 2.pdf", "lecture 10.pdf")).toBeLessThan(0);
    expect(naturalCompare("lecture 10.pdf", "Lecture 2.pdf")).toBeGreaterThan(0);
    expect(naturalCompare("Notes.pdf", "notes.PDF")).toBe(0);
    expect(naturalCompare("alpha.pdf", "beta.pdf")).toBeLessThan(0);
  });
});

describe("lectures in source order (Q5, Q26, Q32)", () => {
  // The real Gastroenterology class: source 02 was digested into `T2228-2`, source 01 into `T2228`.
  const gastro: DigestInfo[] = [
    ["2026-11-18T2228", "01-esophageal-disorders.pdf"],
    ["2026-11-18T2228-2", "02-peptic-ulcer-disease-gastritis-zes.pdf"],
    ["2026-11-18T2229", "03-emesis-blood-and-guts.pdf"],
    ["2026-11-18T2230", "04-biliary-diseases.pdf"],
    ["2026-11-18T2231", "05-liver-disease-and-etoh.pdf"],
    ["2026-11-18T2232", "06-jaundice-and-hepatitis.pdf"],
    ["2026-11-18T2233", "07-pancreatitis-and-pancreatic-cancer.pdf"],
    ["2026-11-18T2233-2", "08-absorption-and-malabsorption.pdf"],
    ["2026-11-18T2234", "09-colon-polyps-and-colorectal-cancer.pdf"],
    ["2026-11-18T2235", "10-anorectal-disease.pdf"],
    ["2026-11-18T2236", "11-diverticulitis-appendicitis-sbo-etc.pdf"],
    ["2026-11-18T2237", "12-chrons-ulcerative-colitis-celiac-disease.pdf"],
  ].map(([stem, source]) => ({
    title: source!,
    date: `${stem!.slice(0, 10)}T${stem!.slice(11, 13)}:${stem!.slice(13, 15)}`,
    path: `${COURSE}/digests/${stem}.md`,
    unit: null,
    source_path: `${COURSE}/${source}`,
  }));

  it("lists same-minute digests in source order: Esophageal before Peptic Ulcer", () => {
    const rows = buildLectureRows(COURSE, [...gastro].reverse(), {}, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lectures.map((l) => l.title)).toEqual(gastro.map((d) => d.title));
    expect(rows[0]!.lectures[0]!.title).toBe("01-esophageal-disorders.pdf");
  });

  it("orders two digests of one source T1015 < T1015-2 < T1015-10", () => {
    const input = [
      sourced("2026-11-18T1015-10", "Unit/a.pdf"),
      sourced("2026-11-18T1015-2", "Unit/a.pdf"),
      sourced("2026-11-18T1015", "Unit/a.pdf"),
    ];
    expect(order(buildLectureRows(COURSE, input, {}, {}))).toEqual([
      "2026-11-18T1015",
      "2026-11-18T1015-2",
      "2026-11-18T1015-10",
    ]);
  });

  it("puts 10-… after 09-… (natural sort, not text sort)", () => {
    const input = [
      sourced("2026-11-18T1002", "10-late.pdf"),
      sourced("2026-11-18T1001", "09-early.pdf"),
      sourced("2026-11-18T1000", "9-x.pdf"),
    ];
    expect(buildLectureRows(COURSE, input, {}, {})[0]!.lectures.map((l) => l.title)).toEqual([
      "2026-11-18T1001",
      "2026-11-18T1000",
      "2026-11-18T1002",
    ]);
  });

  it("orders mixed-case names with and without numbers", () => {
    const input = [
      sourced("2026-11-18T1003", "lecture 10.pdf"),
      sourced("2026-11-18T1002", "Lecture 2.pdf"),
      sourced("2026-11-18T1001", "Intro.pdf"),
    ];
    expect(buildLectureRows(COURSE, input, {}, {})[0]!.lectures.map((l) => l.title)).toEqual([
      "2026-11-18T1001",
      "2026-11-18T1002",
      "2026-11-18T1003",
    ]);
  });

  it("falls back to date, then stem with the -N suffix, without a source_path", () => {
    const input = [
      sourced("2026-11-18T2228-10", null),
      sourced("2026-11-18T2228-2", null),
      sourced("2026-11-18T2228", null),
      sourced("2026-11-18T2200", null),
    ];
    expect(order(buildLectureRows(COURSE, input, {}, {}))).toEqual([
      "2026-11-18T2200",
      "2026-11-18T2228",
      "2026-11-18T2228-2",
      "2026-11-18T2228-10",
    ]);
  });

  it("reads a date-only stem as a whole, not as base 2026-09 suffix 13", () => {
    // The worker writes `2026-09-12` for a day's first digest, then `2026-09-12T1015[-N]`.
    const stems = ["2026-09-12", "2026-09-12T1015", "2026-09-12T1015-2", "2026-09-13"];
    const row = (stem: string, source: string | null): DigestInfo => ({
      title: stem,
      date: stem.length === 10 ? stem : `${stem.slice(0, 10)}T${stem.slice(11, 13)}:${stem.slice(13, 15)}`,
      path: `${COURSE}/digests/${stem}.md`,
      unit: null,
      source_path: source === null ? null : `${COURSE}/a.pdf`,
    });
    for (const source of ["shared", null]) {
      const input = [...stems].reverse().map((stem) => row(stem, source));
      expect(order(buildLectureRows(COURSE, input, {}, {}))).toEqual(stems);
    }
  });

  it("gives one order for all 6 permutations of a mixed 3-row input", () => {
    // B has a source, A and C do not: a comparator that mixed the two keys would cycle here.
    const a = sourced("2026-11-18T1000", null);
    const b = sourced("2026-11-18T0900", "02-b.pdf");
    const c = sourced("2026-11-18T1100", null);
    const perms = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    const results = perms.map((p) => order(buildLectureRows(COURSE, p, {}, {})));
    for (const result of results) {
      expect(result).toEqual(["2026-11-18T0900", "2026-11-18T1000", "2026-11-18T1100"]);
    }
  });

  it("keeps unit order by the newest lecture date for date-only units", () => {
    const input = [
      sourced("2026-11-01T1000", null, "Old"),
      sourced("2026-11-20T1000", null, "New"),
      sourced("2026-11-10T1000", null, "Mid"),
    ];
    expect(buildLectureRows(COURSE, input, {}, {}).map((g) => g.unit)).toEqual(["New", "Mid", "Old"]);
  });

  it("orders units by their max lecture date even when source order puts an older lecture last", () => {
    const input = [
      sourced("2026-11-20T1000", "01-a.pdf", "Fresh"),
      sourced("2026-11-01T1000", "02-b.pdf", "Fresh"),
      sourced("2026-11-10T1000", "01-c.pdf", "Mid"),
    ];
    const rows = buildLectureRows(COURSE, input, {}, {});
    expect(rows.map((g) => g.unit)).toEqual(["Fresh", "Mid"]);
    expect(rows[0]!.lectures.map((l) => l.title)).toEqual(["2026-11-20T1000", "2026-11-01T1000"]);
  });
});
