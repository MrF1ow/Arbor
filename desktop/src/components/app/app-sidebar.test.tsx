import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

describe("app sidebar root groups", () => {
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
    clearMocks();
    vi.restoreAllMocks();
  });

  it("uses fixed h-control root group header buttons without h-auto", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fall 2026/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Shared · Study group/i })).toBeInTheDocument();
    });
    for (const name of [/Fall 2026/i, /Shared · Study group/i]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-control");
      expect(button.className).not.toContain("h-auto");
    }
  });
});
