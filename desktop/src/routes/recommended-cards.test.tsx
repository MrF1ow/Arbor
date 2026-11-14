import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { resetStudyWriteQueueForTests } from "~/lib/study-writes";
import { clearMockIpcLog, resetMockHandlerTimers } from "~/test/mock-handlers";
import { useLectureSelectionStore } from "~/stores/lecture-selection-store";
import { useStudySessionStore } from "~/stores/study-session-store";
import { renderAppAtRoute } from "~/test/render";

describe("Overview > Recommended 'N cards due' opens the due deck (C39)", { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAuthRefreshForTests();
    resetStudyWriteQueueForTests();
    localStorage.clear();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
    useLectureSelectionStore.setState({ byClass: {} });
    clearMockIpcLog();
  });
  afterEach(() => {
    cleanup();
    resetMockHandlerTimers();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("lands on Due today, 1 / 14, after the class's Cards were left on Full deck mid-way", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/practice/cards");
    await waitFor(() => expect(screen.getByText(/Due today · 14/i)).toBeInTheDocument(), { timeout: 8000 });
    // Browse the Full deck and move on a card: that is the saved session Cards would restore.
    await user.click(screen.getByRole("tab", { name: /Full deck/i }));
    await user.click(await screen.findByRole("button", { name: /^Flip$/i }));
    await user.keyboard("3");
    await waitFor(() => expect(screen.getByText(/^2 \/ \d+$/)).toBeInTheDocument());
    await act(async () => {
      await router.navigate({ to: "/course/$course/overview", params: { course: "cell-biology" } });
    });
    await user.click(await screen.findByRole("button", { name: /Review 14 due flashcards/i }, { timeout: 8000 }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/course/cell-biology/practice/cards"));
    await waitFor(() => expect(screen.getByTestId("flashcards-view")).toBeInTheDocument(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.getByRole("tab", { name: /Due today/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 / 14")).toBeInTheDocument();
  });
});
