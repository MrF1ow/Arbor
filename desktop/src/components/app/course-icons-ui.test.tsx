import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { getMockIpcCalls } from "~/test/mock-handlers";
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
      lastCourse: null,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    vi.restoreAllMocks();
  });

  it("picking an icon and a colour updates the sidebar swatch; reset clears; viewer disabled", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/course/cell-biology/overview");
    const sidebar = await screen.findByRole("complementary");
    const row = await within(sidebar).findByRole("button", { name: /Cell Biology/i });
    const swatch = () => row.querySelector("[data-course-color]")!;
    // The mock library gives Cell Biology no colour: a stable fallback swatch is shown.
    expect(swatch()).toBeInTheDocument();

    const changeIcon = within(row.parentElement!).getByRole("button", { name: "Change icon" });
    await waitFor(() => expect(changeIcon).toBeEnabled(), { timeout: 5000 });
    await user.click(changeIcon);
    expect(await screen.findByText("Course icon", {}, { timeout: 15000 })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Genetics" }, { timeout: 5000 }));
    await waitFor(
      () => {
        const call = getMockIpcCalls().find(
          (c) => c.cmd === "set_course_meta" && (c.args as { icon?: string }).icon === "dna",
        );
        expect(call?.args).toMatchObject({ course: "cell-biology" });
      },
      { timeout: 5000 },
    );

    await user.click(await screen.findByRole("button", { name: "Sky" }, { timeout: 5000 }));
    await waitFor(
      () => {
        expect(swatch()).toHaveAttribute("data-course-color", "sky");
        expect(swatch()).toHaveClass("bg-course-sky");
      },
      { timeout: 5000 },
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(
      () => {
        expect(swatch()).not.toHaveAttribute("data-course-color", "sky");
      },
      { timeout: 5000 },
    );
  }, 30000);

  it("viewer cannot open picker", async () => {
    await renderAppAtRoute("/course/cell-biology/overview", {
      library_show: () => ({
        present: true,
        role: "viewer",
        name: "Shared",
        members: [],
        created_by: "a@test.local",
        provider: null,
      }),
    });
    const sidebar = await screen.findByRole("complementary");
    const row = await within(sidebar).findByRole("button", { name: /Cell Biology/i });
    await waitFor(() => {
      expect(within(row.parentElement!).getByRole("button", { name: "Change icon" })).toBeDisabled();
    });
  });
});
