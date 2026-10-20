import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "~/hooks/use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on the interval", () => {
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(new Date("2026-10-20T12:00:00Z").getTime());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(new Date("2026-10-20T12:01:00Z").getTime());
  });
});
