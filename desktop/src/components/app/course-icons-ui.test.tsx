import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

describe("course icons UI", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      lastCourse: null,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("picking an icon updates sidebar and header; reset clears; viewer disabled", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/notes");
    const headerButton = await screen.findByRole("button", { name: "Change course icon" });
    await waitFor(() => {
      expect(headerButton.querySelector("[data-icon]")).toHaveAttribute("data-icon", "microscope");
    });

    const sidebarRow = screen.getByRole("button", { name: /Cell Biology/i });
    expect(sidebarRow.querySelector("[data-icon]")).toHaveAttribute("data-icon", "microscope");

    await user.click(headerButton);
    await screen.findByText("Course icon");
    await user.click(await screen.findByRole("button", { name: "Genetics" }));
    await waitFor(() => {
      expect(headerButton.querySelector("[data-icon]")).toHaveAttribute("data-icon", "dna");
    });
    expect(sidebarRow.querySelector("[data-icon]")).toHaveAttribute("data-icon", "dna");

    await user.click(await screen.findByRole("button", { name: "Sky" }));
    await waitFor(() => {
      expect(headerButton.querySelector("[data-icon]")).toHaveClass("text-course-sky");
    });

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(headerButton.querySelector("[data-icon]")).toHaveAttribute("data-icon", "book-open");
    });
  });

  it("viewer cannot open picker", async () => {
    await renderAppAtRoute("/course/cell-biology/notes", {
      library_show: () => ({
        present: true,
        role: "viewer",
        name: "Shared",
        members: [],
        created_by: "a@test.local",
        provider: null,
      }),
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Update knowledge/i })).toBeDisabled();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Change course icon")).toBeDisabled();
    });
  });
});
