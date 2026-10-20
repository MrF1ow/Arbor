import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { createAppQueryClient } from "~/lib/query-client";
import { getRouter } from "../router";
import { installMockIpc } from "~/test/mock-ipc";

describe("index route", () => {
  afterEach(() => {
    clearMocks();
  });

  it("renders the rebuild placeholder heading and fixture courses", async () => {
    installMockIpc();
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = getRouter(history);
    await router.load();
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: /Arbor 6\.0 rebuild in progress/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("cell-biology")).toBeInTheDocument();
    });
  });
});
