import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

/** Real Tauri IPC is never instant: answer after a short delay, as the app sees it. */
function later<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("switching library from a class page", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
  });
  afterEach(() => {
    cleanup();
    clearTauriMocks();
  });

  it("keeps the library just picked; the class page never switches back", async () => {
    const user = userEvent.setup();
    let current = fixtureSettings;
    const saves: string[] = [];
    const { router } = await renderAppAtRoute("/course/cell-biology/overview", {
      get_settings: () => later(current),
      save_settings: (args) => {
        current = (args as { settings: typeof fixtureSettings }).settings;
        saves.push(current.active_root ?? "");
        return later(null);
      },
      start_folder_watch: () => later(null),
      list_courses: (args) => {
        const root = (args as { root: string }).root;
        return later(root === FIXTURE_ROOT_SHARED ? ["collab-notes"] : ["cell-biology", "organic-chemistry-ii"]);
      },
    });
    const sidebar = await screen.findByRole("complementary");
    await waitFor(() => expect(within(sidebar).getByText(/collab-notes|Collab notes/i)).toBeInTheDocument());
    await user.click(within(sidebar).getByRole("button", { name: /Shared · Study group/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);
    expect(current.active_root).toBe(FIXTURE_ROOT_SHARED);
    expect(current.active_root).not.toBe(FIXTURE_ROOT_FALL);
  });
});
