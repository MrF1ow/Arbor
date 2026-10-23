import { describe, expect, it } from "vitest";

import {
  elapsedShare,
  formatResetsIn,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "~/domain/usage";

const now = Date.parse("2026-09-03T12:00:00.000Z");

const window = {
  id: "five_hour",
  kind: "session" as const,
  label: "Session",
  used_percent: 40,
  window_minutes: 300,
  resets_at: "2026-09-03T14:00:00.000Z",
};

describe("usage helpers", () => {
  it("computes remaining and pace from a five-hour window", () => {
    expect(remainingPercent(window)).toBe(60);
    expect(elapsedShare(window, now)).toBeCloseTo(0.6);
    expect(paceRemainingPercent(window, now)).toBe(40);
    expect(paceOf(window, now)).toBe("under");
    expect(paceOf({ ...window, used_percent: 62 }, now)).toBe("on");
    expect(paceOf({ ...window, used_percent: 80 }, now)).toBe("ahead");
  });

  it("formats reset copy", () => {
    expect(formatResetsIn(window, now)).toBe("resets in 2h 0m");
    expect(formatResetsIn({ resets_at: "2026-09-03T12:00:00.000Z" }, now)).toBe("resets now");
  });
});
