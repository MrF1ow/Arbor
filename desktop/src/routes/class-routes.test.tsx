import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { classHref, classPath, lecturesToSearch, type ClassTab } from "~/lib/class-path";
import { clearTauriMocks } from "~/test/mock-ipc";
import { renderAppAtRoute } from "~/test/render";

describe("class routes", () => {
  afterEach(() => clearTauriMocks());

  const DIGEST = "2026-09-12-membranes";
  const cases: { tab: ClassTab; path: string; marker: () => Promise<unknown> }[] = [
    {
      tab: "overview",
      path: "/course/cell-biology/overview",
      marker: () => screen.findByText(/Quiz accuracy/i),
    },
    {
      tab: "read",
      path: `/course/cell-biology/read/${DIGEST}`,
      marker: () => screen.findByTestId("digest-view"),
    },
    { tab: "map", path: "/course/cell-biology/map", marker: () => screen.findByTestId("graph-view") },
    {
      tab: "cards",
      path: "/course/cell-biology/practice/cards",
      marker: () => screen.findByText(/Due today/i),
    },
    {
      tab: "quiz",
      path: "/course/cell-biology/practice/quiz",
      marker: () => screen.findByTestId("quiz-card", undefined, { timeout: 5000 }),
    },
    { tab: "ask", path: "/course/cell-biology/ask", marker: () => screen.findByTestId("chat-view") },
  ];

  for (const { tab, path, marker } of cases) {
    it(`${tab} renders the existing view at ${path}`, async () => {
      const { router } = await renderAppAtRoute(path);
      await marker();
      expect(router.state.location.pathname).toBe(path);
      expect(classHref("cell-biology", tab, tab === "read" ? DIGEST : undefined)).toBe(path);
    });
  }

  it("every class route accepts ?lectures= and keeps it", async () => {
    const lectures = lecturesToSearch(["cell-biology/digests/2026-09-12-membranes.md"])!;
    const { router } = await renderAppAtRoute(
      `/course/cell-biology/practice/quiz?lectures=${encodeURIComponent(lectures)}`,
    );
    await waitFor(() => expect(router.state.location.search).toEqual({ lectures }));
  });

  it("/course/$course redirects to its overview", async () => {
    const { router } = await renderAppAtRoute("/course/cell-biology");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/course/cell-biology/overview");
    });
  });

  it("a typed navigate reaches every route", async () => {
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    const tabs: [ClassTab, string | undefined][] = [
      ["overview", undefined],
      ["read", DIGEST],
      ["map", undefined],
      ["cards", undefined],
      ["quiz", undefined],
      ["ask", undefined],
    ];
    for (const [tab, digest] of tabs) {
      await router.navigate({ ...classPath("cell-biology", tab, digest), search: {} });
      expect(router.state.location.pathname).toBe(classHref("cell-biology", tab, digest));
    }
  });

  it("the old class routes still render beside the new ones", async () => {
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await screen.findByText(/Quiz accuracy/i);
    expect(router.state.location.pathname).toBe("/course/cell-biology/notes");
  });
});
