import { render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { getRouter } from "../router";

describe("index route", () => {
  it("renders the rebuild placeholder heading", async () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = getRouter(history);
    await router.load();

    render(<RouterProvider router={router} />);

    expect(
      screen.getByRole("heading", { name: /Arbor 6\.0 rebuild in progress/i }),
    ).toBeInTheDocument();
  });
});
