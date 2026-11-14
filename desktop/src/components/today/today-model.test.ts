import { describe, expect, it } from "vitest";

import {
  accuracyCaption,
  continueReading,
  daysLeftLabel,
  formatExamDate,
  reviewMinutes,
  reviewOrder,
} from "~/components/today/today-model";
import type { TodayCourse } from "~/domain/today";
import type { DigestInfo } from "~/domain/types";

function course(name: string, due: number, daysToExam: number | null = null, root = "/r"): TodayCourse {
  return {
    root,
    course: name,
    digest_count: 3,
    due_ids: Array.from({ length: due }, (_, i) => `${name}-${i}`),
    deck_count: 10,
    mastered: 0,
    mastery: null,
    exam_date: daysToExam === null ? null : "2026-12-01",
    days_to_exam: daysToExam,
    plan: null,
  };
}

describe("reviewMinutes", () => {
  it.each([
    [0, 0],
    [1, 1],
    [3, 1],
    [25, 8],
    [41, 12],
    [200, 60],
  ])("%i cards take about %i min at 18 s a card", (cards, minutes) => {
    expect(reviewMinutes(cards)).toBe(minutes);
  });
});

describe("reviewOrder", () => {
  it("keeps only classes with cards due, nearest exam first, then most due, then name", () => {
    const order = reviewOrder([
      course("zeta", 5),
      course("alpha", 5),
      course("far-exam", 2, 30),
      course("near-exam", 1, 3),
      course("empty-near", 0, 1),
      course("busy", 9),
    ]);
    expect(order.map((c) => c.course)).toEqual(["near-exam", "far-exam", "busy", "alpha", "zeta"]);
  });

  it("treats a past exam like no exam", () => {
    expect(reviewOrder([course("past", 9, -4), course("soon", 1, 2)]).map((c) => c.course)).toEqual([
      "soon",
      "past",
    ]);
  });
});

describe("Today captions", () => {
  it("compares this week's accuracy with last week's", () => {
    expect(accuracyCaption({ correct: 7, total: 9 }, { correct: 5, total: 7 })).toBe("last 7 days · up from 71%");
    expect(accuracyCaption({ correct: 1, total: 4 }, { correct: 3, total: 4 })).toBe("last 7 days · down from 75%");
    expect(accuracyCaption({ correct: 3, total: 4 }, { correct: 6, total: 8 })).toBe("last 7 days · same as 75%");
    expect(accuracyCaption({ correct: 3, total: 4 }, { correct: 0, total: 0 })).toBe("last 7 days");
  });

  it("words days left and dates the exam without a time-zone shift", () => {
    expect(daysLeftLabel(9)).toBe("9 days");
    expect(daysLeftLabel(1)).toBe("1 day");
    expect(daysLeftLabel(0)).toBe("Today");
    expect(formatExamDate("2026-11-16")).toBe("Nov 16");
    expect(formatExamDate("2026-01-01")).toBe("Jan 1");
  });
});

describe("continueReading", () => {
  const info = (stem: string, title: string): DigestInfo => ({
    title,
    date: stem.slice(0, 10),
    path: `Bio/digests/${stem}.md`,
    unit: null,
    source_path: `Bio/${stem}.pdf`,
  });
  const digests = [
    info("2026-10-01-a", "A"),
    info("2026-10-02-b", "B"),
    info("2026-10-03-c", "C"),
    info("2026-10-04-d", "D"),
    info("2026-10-05-e", "E"),
  ];

  it("puts opened-but-unread first (latest opened first), then New (newest first), and drops read ones", () => {
    const items = continueReading(
      [
        {
          root: "/r",
          course: "Bio",
          digests,
          reading: {
            "Bio/digests/2026-10-01-a.md": { fraction: 1, last_opened: "2026-10-01T10:00:00Z", read: true },
            "Bio/digests/2026-10-02-b.md": { fraction: 0.2, last_opened: "2026-11-01T10:00:00Z", read: false },
            "Bio/digests/2026-10-03-c.md": { fraction: 0.6, last_opened: "2026-11-02T10:00:00Z", read: false },
          },
        },
      ],
      10,
    );
    expect(items.map((i) => [i.title, i.fraction])).toEqual([
      ["C", 0.6],
      ["B", 0.2],
      ["E", null],
      ["D", null],
    ]);
    expect(items[0]).toMatchObject({ root: "/r", course: "Bio", digest: "Bio/digests/2026-10-03-c.md", slug: "2026-10-03-c" });
  });

  it("is capped", () => {
    expect(continueReading([{ root: "/r", course: "Bio", digests, reading: {} }], 2)).toHaveLength(2);
    expect(continueReading([{ root: "/r", course: "Bio", digests, reading: {} }])).toHaveLength(4);
  });
});
