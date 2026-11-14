import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTauriMocks } from "~/test/mock-ipc";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

// jsdom has no layout, so these pin the classes that carry the approved design's measurements
// (frames 4508 / 5991); the pixel values themselves were measured in the mock-mode browser run.
const indexCss = await (async () => {
  const NODE_FS = "node:fs";
  const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
    readFileSync: (path: string, encoding: "utf8") => string;
  };
  return readFileSync("src/index.css", "utf8");
})();

describe("shell chrome metrics", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ sidebarOpen: true, sidebarTouched: true, lastCourse: null });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("makes the pill and the Settings button 27 px high, and drops the search magnifier", async () => {
    await renderAppAtRoute("/course/cell-biology/overview");
    const pill = await screen.findByRole("button", { name: /Library status/i });
    expect(pill.className).toContain("h-6.75");
    expect(pill.className).toContain("shrink");
    expect(pill.className).not.toContain("shrink-0");
    expect(screen.getByRole("button", { name: "Settings" }).className).toContain("h-6.75");
    const search = screen.getByRole("button", { name: /Search notes, concepts, and cards/i });
    expect(search.querySelector("svg")).toBeNull();
    expect(search.className).toContain("pl-3");
    // the mark block may shrink so the search field keeps room at narrow widths
    const mark = screen.getByText("Arbor").parentElement!;
    expect(mark.className).toContain("shrink");
    expect(mark.className).not.toContain("shrink-0");
  });

  it("gives sidebar and settings nav rows the design's 29 px pitch", async () => {
    await renderAppAtRoute("/course/cell-biology/overview");
    const today = await screen.findByRole("link", { name: /Today/ });
    expect(today.className).toContain("py-1.25");
    expect(today.className).not.toContain("py-1.5");
  });

  it("centres the library menu under the pill with the popover shadow, and hints Ctrl+` for Show log", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
    await user.click(await screen.findByRole("button", { name: /Library status/i }));
    const menu = await screen.findByRole("menu");
    // shadow-popover is registered with tailwind-merge, so it replaces the primitive's shadow-card.
    expect(menu.className).toContain("shadow-popover");
    expect(menu.className).not.toContain("shadow-card");
    expect(menu.parentElement).toHaveAttribute("data-align", "center");
    expect(within(menu).getByRole("menuitem", { name: /Show log/i })).toHaveTextContent("Ctrl+`");
  });

  it("defines --popover-shadow in Light and Dark and exposes shadow-popover", () => {
    expect(indexCss.match(/--popover-shadow:/g)).toHaveLength(2);
    expect(indexCss).toContain("--shadow-popover: var(--popover-shadow);");
    expect(indexCss).toContain("--popover-shadow: 0 2px 4px rgb(43 36 32 / 0.1), 0 12px 32px rgb(43 36 32 / 0.14);");
  });
});
