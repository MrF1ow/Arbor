import { describe, expect, it } from "vitest";

import { groupThreadsByDay, threadMeta } from "~/components/chat/thread-groups";

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
