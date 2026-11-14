import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { fixtureSettings } from "~/test/fixtures/data";
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
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("uses fixed h-6 root group header buttons without h-auto", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fall 2026/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Shared · Study group/i })).toBeInTheDocument();
    });
    for (const name of [/Fall 2026/i, /Shared · Study group/i]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-6");
      expect(button.className).not.toContain("h-auto");
    }
  });

  it("scopes the hover swap of due count and Change icon to its own row", async () => {
    await renderAppAtRoute("/course/cell-biology/notes");
    await screen.findByText("Cell Biology");
    const { change, row, count } = await waitFor(() => {
      const button = screen.getAllByRole("button", { name: "Change icon" })[0]!;
      const wrapper = button.parentElement;
      const el = wrapper?.querySelector("span.text-primary");
      expect(wrapper).not.toBeNull();
      expect(el).not.toBeNull();
      return { change: button, row: wrapper!, count: el! };
    });
    // An unnamed `group-hover` would also match the sidebar wrapper's own `group`, hiding every
    // row's count while the pointer is anywhere in the sidebar.
    expect(row.className).toContain("group/nav-row");
    expect(change.className).toContain("group-hover/nav-row:opacity-100");
    expect(change.className).toContain("group-focus-within/nav-row:opacity-100");
    expect(change.className).not.toMatch(/(^|\s)group-(hover|focus-within):/);
    expect(count.className).toContain("group-hover/nav-row:hidden");
    expect(count.className).toContain("group-focus-within/nav-row:hidden");
    expect(count.className).not.toMatch(/(^|\s)group-(hover|focus-within):/);
  });

  it("with no library, labels the + Add class row with a My library group like First run's design frame", async () => {
    await renderAppAtRoute("/", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    const sidebar = await screen.findByRole("complementary");
    const label = await within(sidebar).findByText("My library");
    const add = within(sidebar).getByRole("button", { name: "+ Add class" });
    expect(label.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
