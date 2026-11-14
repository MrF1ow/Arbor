import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { qk } from "~/lib/queries/keys";
import { useReadingState, useWriteReadingState } from "~/lib/queries/reading-state";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

const ROOT = "/mock/knowledge/fall-2026";
const DIGEST = "cell-biology/digests/2026-09-12-membranes.md";

describe("reading state", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearTauriMocks();
  });

  it("reads the map keyed by course-prefixed digest path", async () => {
    const { Wrapper } = renderWithProviders(<></>, {
      minimal: true,
      fixtures: {
        read_reading_state: () => ({
          [DIGEST]: { fraction: 0.4, last_opened: "2026-11-10T10:00:00Z", read: false },
        }),
      },
    });
    const { result } = renderHook(() => useReadingState(ROOT), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.[DIGEST]?.fraction).toBe(0.4));
  });

  describe("writes", () => {
    const writes: { digest: string; fraction: number }[] = [];
    beforeEach(() => {
      writes.length = 0;
      vi.useFakeTimers();
    });

    function mount() {
      const { Wrapper } = renderWithProviders(<></>, {
        minimal: true,
        fixtures: {
          write_reading_state: (args) => {
            writes.push(args as unknown as { digest: string; fraction: number });
            return null;
          },
        },
      });
      return renderHook(() => useWriteReadingState(ROOT), { wrapper: Wrapper });
    }

    it("writes at most once per 2 s per digest and keeps the latest fraction", async () => {
      const { result } = mount();
      act(() => result.current.write(DIGEST, 0.1));
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toEqual([{ root: ROOT, digest: DIGEST, fraction: 0.1 }]);

      act(() => result.current.write(DIGEST, 0.2));
      act(() => result.current.write(DIGEST, 0.35));
      await vi.advanceTimersByTimeAsync(1000);
      expect(writes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1100);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual({ root: ROOT, digest: DIGEST, fraction: 0.35 });
    });

    it("only writes increases", async () => {
      const { result } = mount();
      act(() => result.current.write(DIGEST, 0.5));
      await vi.advanceTimersByTimeAsync(2500);
      act(() => result.current.write(DIGEST, 0.3));
      await vi.advanceTimersByTimeAsync(2500);
      expect(writes).toHaveLength(1);
    });

    it("throttles each digest separately", async () => {
      const { result } = mount();
      act(() => result.current.write(DIGEST, 0.1));
      act(() => result.current.write("cell-biology/digests/other.md", 0.1));
      await vi.advanceTimersByTimeAsync(0);
      expect(writes.map((w) => w.digest).sort()).toEqual([DIGEST, "cell-biology/digests/other.md"].sort());
    });

    function mountSwitching() {
      const { Wrapper, queryClient } = renderWithProviders(<></>, {
        minimal: true,
        fixtures: {
          write_reading_state: (args) => {
            writes.push(args as unknown as { digest: string; fraction: number });
            return null;
          },
        },
      });
      const hook = renderHook(({ root }) => useWriteReadingState(root), {
        wrapper: Wrapper,
        initialProps: { root: "/A" },
      });
      return { ...hook, queryClient };
    }

    it("sends a pending write to the library it was made in after a switch", async () => {
      const { result, rerender, unmount } = mountSwitching();
      act(() => result.current.write(DIGEST, 0.1));
      await vi.advanceTimersByTimeAsync(0);
      act(() => result.current.write(DIGEST, 0.6));
      rerender({ root: "/B" });
      act(() => result.current.write(DIGEST, 0.2));
      await vi.advanceTimersByTimeAsync(2500);
      unmount();
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveLength(3);
      expect(writes).toContainEqual({ root: "/A", digest: DIGEST, fraction: 0.1 });
      expect(writes).toContainEqual({ root: "/A", digest: DIGEST, fraction: 0.6 });
      expect(writes).toContainEqual({ root: "/B", digest: DIGEST, fraction: 0.2 });
    });

    it("flushes a pending write on unmount to its own library", async () => {
      const { result, rerender, unmount } = mountSwitching();
      act(() => result.current.write(DIGEST, 0.1));
      await vi.advanceTimersByTimeAsync(0);
      act(() => result.current.write(DIGEST, 0.7));
      rerender({ root: "/B" });
      unmount();
      await vi.advanceTimersByTimeAsync(0);
      expect(writes.at(-1)).toEqual({ root: "/A", digest: DIGEST, fraction: 0.7 });
    });

    it("invalidates that library's reading state after a successful write", async () => {
      const { Wrapper, queryClient } = renderWithProviders(<></>, {
        minimal: true,
        fixtures: { write_reading_state: () => null },
      });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useWriteReadingState(ROOT), { wrapper: Wrapper });
      act(() => result.current.write(DIGEST, 0.3));
      await vi.advanceTimersByTimeAsync(0);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.readingState(ROOT) });
    });

    it("retries a failed write on the next scroll instead of remembering it as sent", async () => {
      let fail = true;
      const attempts: number[] = [];
      const { Wrapper, queryClient } = renderWithProviders(<></>, {
        minimal: true,
        fixtures: {
          write_reading_state: (args) => {
            attempts.push((args as unknown as { fraction: number }).fraction);
            if (fail) {
              throw new Error("disk full");
            }
            return null;
          },
        },
      });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useWriteReadingState(ROOT), { wrapper: Wrapper });
      act(() => result.current.write(DIGEST, 0.4));
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toEqual([0.4]);
      expect(invalidate).not.toHaveBeenCalled();

      fail = false;
      await vi.advanceTimersByTimeAsync(2500);
      act(() => result.current.write(DIGEST, 0.4));
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toEqual([0.4, 0.4]);
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it("flushes a pending write on unmount", async () => {
      const { result, unmount } = mount();
      act(() => result.current.write(DIGEST, 0.1));
      await vi.advanceTimersByTimeAsync(0);
      act(() => result.current.write(DIGEST, 0.8));
      expect(writes).toHaveLength(1);
      unmount();
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveLength(2);
      expect(writes[1]!.fraction).toBe(0.8);
    });
  });
});
