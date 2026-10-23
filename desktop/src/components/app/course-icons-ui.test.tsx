import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

describe("course icons UI", () => {
  beforeEach(async () => {
    await import("~/components/app/course-icon-picker");
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
    await screen.findByRole(
      "button",
      { name: "Change course icon" },
      { timeout: 5000 },
    );
    await waitFor(
      () => {
        const btn = screen.getByRole("button", { name: "Change course icon" });
        expect(btn.querySelector("[data-icon]")).toHaveAttribute("data-icon", "microscope");
      },
      { timeout: 15000 },
    );
    const headerButton = screen.getByRole("button", { name: "Change course icon" });

    const sidebarRow = screen.getByRole("button", { name: /Cell Biology/i });
    expect(sidebarRow.querySelector("[data-icon]")).toHaveAttribute("data-icon", "microscope");

    await waitFor(
      async () => {
        await user.click(headerButton);
        expect(screen.getByText("Course icon")).toBeInTheDocument();
      },
      { timeout: 15000 },
    );
    await user.click(
      await screen.findByRole("button", { name: "Genetics" }, { timeout: 5000 }),
    );
    await waitFor(
      () => {
      expect(headerButton.querySelector("[data-icon]")).toHaveAttribute("data-icon", "dna");
    },
      { timeout: 5000 },
    );
    expect(sidebarRow.querySelector("[data-icon]")).toHaveAttribute("data-icon", "dna");

    await user.click(await screen.findByRole("button", { name: "Sky" }, { timeout: 5000 }));
    await waitFor(
      () => {
      expect(headerButton.querySelector("[data-icon]")).toHaveClass("text-course-sky");
    },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(
      () => {
      expect(headerButton.querySelector("[data-icon]")).toHaveAttribute("data-icon", "book-open");
    },
      { timeout: 5000 },
    );
  }, 15000);

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
