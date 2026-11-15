import { describe, expect, it } from "vitest";

import { groupThreadsByDay, stampMs, threadMeta } from "~/components/chat/thread-groups";

const NOW = new Date("2026-11-12T15:00:00"); // a Thursday

const thread = (id: string, updated_at: string, mode: "ask" | "explain" = "ask") => ({
  id,
  title: id,
  mode,
  created_at: updated_at,
  updated_at,
});

describe("groupThreadsByDay", () => {
  it("groups newest first into Today, This week and Earlier, and drops empty groups", () => {
    const groups = groupThreadsByDay(
      [
        thread("old", "2026-10-01T10:00:00"),
        thread("today-early", "2026-11-12T08:00:00"),
        thread("tue", "2026-11-10T10:00:00"),
        thread("today-late", "2026-11-12T14:00:00"),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["Today", ["today-late", "today-early"]],
      ["This week", ["tue"]],
      ["Earlier", ["old"]],
    ]);
    expect(groupThreadsByDay([thread("a", "2026-11-12T14:00:00")], NOW).map((g) => g.label)).toEqual(["Today"]);
    expect(groupThreadsByDay([], NOW)).toEqual([]);
  });

  it("puts a thread from 7 days ago or more under Earlier", () => {
    const groups = groupThreadsByDay([thread("a", "2026-11-05T10:00:00"), thread("b", "2026-11-06T10:00:00")], NOW);
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["This week", ["b"]],
      ["Earlier", ["a"]],
    ]);
  });
});

describe("threadMeta", () => {
  it("shows the mode and how long ago, the weekday this week, the date before that", () => {
    expect(threadMeta(thread("a", "2026-11-12T14:58:00", "explain"), NOW)).toBe("Explain · 2 min ago");
    expect(threadMeta(thread("a", "2026-11-12T14:59:50"), NOW)).toBe("Ask · now");
    expect(threadMeta(thread("a", "2026-11-12T12:00:00"), NOW)).toBe("Ask · 3 hr ago");
    expect(threadMeta(thread("a", "2026-11-10T10:00:00"), NOW)).toBe("Ask · Tue");
    expect(threadMeta(thread("a", "2026-10-01T10:00:00", "explain"), NOW)).toBe("Explain · Oct 1");
  });
});

describe("stamps written as 2026-11-12T14:00:00Z.858", () => {
  // The old Rust writer put the milliseconds after the Z; Date cannot parse that form.
  const OLD = (iso: string) => iso.replace(/\.(\d+)Z$/, "Z.$1");
  const cases: [string, string][] = [
    ["Today", "2026-11-12T14:58:00.858Z"],
    ["This week", "2026-11-10T10:00:00.250Z"],
    ["Earlier", "2026-10-01T10:00:00.500Z"],
  ];

  for (const [label, good] of cases) {
    it(`groups and formats like its RFC 3339 twin under ${label}`, () => {
      const old = OLD(good);
      expect(old).not.toBe(good);
      const groupsOld = groupThreadsByDay([thread("a", old)], NOW);
      const groupsGood = groupThreadsByDay([thread("a", good)], NOW);
      expect(groupsOld.map((g) => g.label)).toEqual([label]);
      expect(groupsOld.map((g) => g.label)).toEqual(groupsGood.map((g) => g.label));
      expect(threadMeta(thread("a", old), NOW)).toBe(threadMeta(thread("a", good), NOW));
      expect(threadMeta(thread("a", old), NOW)).not.toContain("Invalid");
    });
  }

  it("shows 'now' for a thread updated seconds ago", () => {
    const now = new Date("2026-11-12T14:58:30.000Z");
    expect(threadMeta(thread("a", "2026-11-12T14:58:20Z.858"), now)).toBe("Ask · now");
  });

  it("sorts old and new forms together by real time", () => {
    const groups = groupThreadsByDay(
      [
        thread("good-early", "2026-11-12T08:00:00.100Z"),
        thread("old-late", "2026-11-12T09:00:00Z.900"),
        thread("good-mid", "2026-11-12T08:30:00.000Z"),
        thread("old-early", "2026-11-12T07:00:00Z.200"),
      ],
      new Date("2026-11-12T12:00:00.000Z"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.threads.map((t) => t.id)).toEqual(["old-late", "good-mid", "good-early", "old-early"]);
  });
});

describe("a stamp that cannot be parsed", () => {
  it("shows the mode alone and does not throw", () => {
    expect(threadMeta(thread("a", "not a date"), NOW)).toBe("Ask");
    expect(threadMeta(thread("a", "", "explain"), NOW)).toBe("Explain");
    expect(threadMeta(thread("a", "2026-13-45T99:99:99Z.5"), NOW)).toBe("Ask");
  });

  it("sorts after every dated thread and lands under Earlier", () => {
    const groups = groupThreadsByDay(
      [thread("bad", "zzz"), thread("dated", "2026-10-01T10:00:00.000Z"), thread("today", "2026-11-12T14:00:00")],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.threads.map((t) => t.id)])).toEqual([
      ["Today", ["today"]],
      ["Earlier", ["dated", "bad"]],
    ]);
  });

  it("breaks ties between unparseable stamps by the stamp string, newest first", () => {
    const groups = groupThreadsByDay([thread("a", "aaa"), thread("b", "bbb")], NOW);
    expect(groups[0]!.threads.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("stampMs", () => {
  it("parses RFC 3339 and the old Z.fff form to the same instant", () => {
    const expected = Date.parse("2026-11-15T02:44:14.858Z");
    expect(stampMs("2026-11-15T02:44:14.858Z")).toBe(expected);
    expect(stampMs("2026-11-15T02:44:14Z.858")).toBe(expected);
    expect(stampMs("2026-11-15T02:44:14Z.85")).toBe(Date.parse("2026-11-15T02:44:14.850Z"));
    expect(stampMs("2026-11-15T02:44:14Z")).toBe(Date.parse("2026-11-15T02:44:14Z"));
  });

  it("returns null for anything it cannot parse", () => {
    expect(stampMs("")).toBeNull();
    expect(stampMs("garbage")).toBeNull();
    expect(stampMs("2026-13-45T99:99:99Z.5")).toBeNull();
  });
});
