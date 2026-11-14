import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

describe("+ Add class with a name another library also has (C40)", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
  });
  afterEach(() => {
    cleanup();
    clearTauriMocks();
  });

  for (const name of ["collab-notes", "brand-new"]) {
    it(`${name}: stays in the active library and opens the class just created there`, async () => {
      const user = userEvent.setup();
      let current = fixtureSettings;
      const created: string[] = [];
      const saves: string[] = [];
      const { router } = await renderAppAtRoute("/course/cell-biology/overview", {
        get_settings: () => current,
        save_settings: (args) => {
          current = (args as { settings: typeof fixtureSettings }).settings;
          saves.push(current.active_root ?? "");
          return null;
        },
        // The real `create_course` returns the name as typed and makes the folder; the refetched
        // `list_courses` then includes it, but answers asynchronously, as real IPC does.
        create_course: (args) => {
          const typed = String((args as { name: string }).name);
          created.push(typed);
          return typed;
        },
        list_courses: (args) => {
          const root = (args as { root: string }).root;
          const list = root === FIXTURE_ROOT_SHARED ? ["collab-notes"] : ["cell-biology", "organic-chemistry-ii", ...created];
          return new Promise((resolve) => setTimeout(() => resolve(list), 30));
        },
      });
      const sidebar = await screen.findByRole("complementary");
      await waitFor(() => expect(within(sidebar).getByText(/collab-notes|Collab notes/i)).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: /Add class/i }));
      await user.type(screen.getByLabelText(/Class name/i), name);
      await user.click(screen.getByRole("button", { name: /Create class/i }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${name}/overview`));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(saves).toEqual([]);
      expect(current.active_root).toBe(FIXTURE_ROOT_FALL);
      expect(router.state.location.pathname).toBe(`/course/${name}/overview`);
    });
  }
});
