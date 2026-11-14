import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";

type Mutate = (input: Record<string, unknown>) => Promise<string>;

describe("useStudyJobLauncher scope", () => {
  afterEach(() => clearTauriMocks());

  function mount(mutateAsync: Mutate) {
    const { Wrapper } = renderWithProviders(<></>, { minimal: true });
    return renderHook(
      () =>
        useStudyJobLauncher(FIXTURE_ROOT_FALL, {
          mutateAsync,
          isPending: false,
          startedMessage: (id) => `started ${id}`,
          failedMessage: "failed",
        }),
      { wrapper: Wrapper },
    );
  }

  it("passes digests and fromText to the mutation when given", async () => {
    const mutateAsync = vi.fn<Mutate>().mockResolvedValue("job-1");
    const { result } = mount(mutateAsync);
    await waitFor(() => expect(result.current.viewerBlocked).toBe(false));
    await act(async () => {
      await result.current.launchStudyJob("cell-biology", false, {
        digests: ["cell-biology/digests/a.md"],
        fromText: "Osmosis",
      });
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        course: "cell-biology",
        force: false,
        digests: ["cell-biology/digests/a.md"],
        fromText: "Osmosis",
      }),
    );
  });

  it("sends no scope keys when launched with (course, force) as before", async () => {
    const mutateAsync = vi.fn<Mutate>().mockResolvedValue("job-1");
    const { result } = mount(mutateAsync);
    await waitFor(() => expect(result.current.viewerBlocked).toBe(false));
    await act(async () => {
      await result.current.launchStudyJob("cell-biology", true);
    });
    const input = mutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("digests");
    expect(input).not.toHaveProperty("fromText");
  });
});
