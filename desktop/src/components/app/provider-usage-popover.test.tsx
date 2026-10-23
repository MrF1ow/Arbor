import { cleanup, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsageLimitsBody, UsagePanelBody } from "~/components/app/provider-usage-popover-content";

vi.mock("~/lib/queries/auth", () => ({
  useAuth: () => ({
    data: { authenticated: true, reason: "", docs_url: "https://example.com/docs" },
    isLoading: false,
  }),
}));

vi.mock("~/lib/queries/provider-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/queries/provider-usage")>();
  return {
    ...actual,
    useProviderUsage: () => ({
      data: {
        checked_at: new Date().toISOString(),
        windows: [{ id: "five_hour", kind: "session", label: "Session", used_percent: 50 }],
      },
      isLoading: false,
    }),
  };
});
import * as providerUsage from "~/lib/provider-usage";
import { renderWithProviders } from "~/test/render";
import { clearTauriMocks, installMockIpc } from "~/test/mock-ipc";

describe("provider usage popover", () => {
  beforeEach(() => {
    clearTauriMocks();
    installMockIpc();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("renders window rows for claude fixtures", () => {
    renderWithProviders(
      <UsageLimitsBody
        now={Date.now()}
        limits={{
          checked_at: new Date().toISOString(),
          windows: [
            { id: "five_hour", kind: "session", label: "Session", used_percent: 62 },
            { id: "seven_day", kind: "weekly", label: "Weekly", used_percent: 18 },
            {
              id: "seven_day_opus",
              kind: "weekly",
              label: "Weekly · Opus",
              used_percent: 40,
            },
          ],
        }}
      />,
      { minimal: true },
    );
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Weekly · Opus")).toBeInTheDocument();
    expect(screen.getByText("38% left")).toBeInTheDocument();
  });

  it("renders unsupported and probe_failed states", () => {
    const { rerender } = renderWithProviders(
      <UsageLimitsBody
        now={Date.now()}
        limits={{
          checked_at: new Date().toISOString(),
          windows: [],
          unavailable: { reason: "unsupported" },
        }}
      />,
      { minimal: true },
    );
    expect(
      screen.getByText("This provider doesn't report usage limits."),
    ).toBeInTheDocument();

    rerender(
      <UsageLimitsBody
        now={Date.now()}
        limits={{
          checked_at: new Date().toISOString(),
          windows: [],
          unavailable: { reason: "probe_failed", message: "Codex probe failed in mock" },
        }}
      />,
    );
    expect(screen.getByText(/Couldn't read usage/)).toBeInTheDocument();
  });

  it("fetchProviderUsage passes force to read_provider_usage", async () => {
    renderWithProviders(<div />, { minimal: true });
    const limits = await providerUsage.fetchProviderUsage("codex", true);
    expect(limits.unavailable?.reason).toBe("probe_failed");
    expect(limits.unavailable?.message).toBe("Forced refresh");
  });

  it("refresh button refetches usage", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(providerUsage, "fetchProviderUsage");
    fetchSpy.mockResolvedValueOnce({
      checked_at: new Date().toISOString(),
      windows: [{ id: "five_hour", kind: "session", label: "Session", used_percent: 1 }],
    });
    renderWithProviders(
      <UsagePanelBody
        providerId="claude"
        providerLabel="Claude"
        modelLabel="opus"
        enabled
        refetchInterval={false}
        now={Date.now()}
      />,
      { minimal: true },
    );
    expect(await screen.findByText("50% left")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Refresh usage" });
    await user.click(refresh);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("claude", true);
    });
    fetchSpy.mockRestore();
  });
});
