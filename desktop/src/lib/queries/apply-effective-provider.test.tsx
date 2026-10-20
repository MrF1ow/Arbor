import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { qk } from "~/lib/queries/keys";
import { fixtureSettings } from "~/test/fixtures/data";
import {
  resetEffectiveProviderApplyForTests,
  useApplyEffectiveProvider,
} from "~/lib/queries/effective-provider";
import { installMockIpc } from "~/test/mock-ipc";

function Probe({ root }: { root: string | null }) {
  useApplyEffectiveProvider(root);
  return null;
}

describe("useApplyEffectiveProvider", () => {
  afterEach(() => {
    clearTauriMocks();
    resetEffectiveProviderApplyForTests();
  });

  it("runs on root change, not on unrelated remounts", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { rerender, unmount } = render(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() =>
      expect(
        invalidateSpy.mock.calls.some(
          (call) => call[0]?.queryKey?.[1] === "grok",
        ),
      ).toBe(true),
    );
    invalidateSpy.mockClear();

    rerender(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(invalidateSpy.mock.calls.length).toBe(0);

    rerender(
      <QueryClientProvider client={client}>
        <Probe root="/mock/b" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(invalidateSpy.mock.calls.length).toBeGreaterThan(0));

    unmount();
    invalidateSpy.mockClear();
    render(
      <QueryClientProvider client={client}>
        <Probe root="/mock/b" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(invalidateSpy.mock.calls.length).toBe(0));
  });

  it("does not invalidate models when only the effective model id changes", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        invalidateSpy.mock.calls.some((call) => call[0]?.queryKey?.[1] === "grok"),
      ).toBe(true),
    );
    invalidateSpy.mockClear();
    await new Promise((r) => setTimeout(r, 50));

    client.setQueryData(qk.settings(), { ...fixtureSettings, model_id: "grok-mini" });
    rerender(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(invalidateSpy.mock.calls.length).toBe(0);
  });

  it("invalidates models when library provider snapshot changes", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    client.setQueryData(qk.settings(), {
      ...fixtureSettings,
      provider_id: "codex",
      model_id: "codex-model",
    });
    client.setQueryData(qk.library("/mock/a"), {
      present: true,
      name: "Lib",
      created_by: "o@x.com",
      role: "owner",
      provider: { id: "grok", model: "grok-4.7" },
      members: [],
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: qk.models("grok", "/mock/a") }),
      ),
    );
    invalidateSpy.mockClear();
    client.setQueryData(qk.library("/mock/a"), {
      present: true,
      name: "Lib",
      created_by: "o@x.com",
      role: "owner",
      provider: { id: "grok", model: "grok-4.8" },
      members: [],
    });
    rerender(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: qk.models("grok", "/mock/a") }),
      ),
    );
  });

  it("invalidates models for the effective provider", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <Probe root="/mock/a" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: qk.models("grok", "/mock/a") }),
      ),
    );
  });
});
