import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";
import type { Settings } from "~/domain/types";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { qk } from "~/lib/queries/keys";

const later = <T,>(v: T, ms = 10) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the sidebar library header, then Back into a class page of the old library while it saves", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
  });
  afterEach(() => {
    cleanup();
    clearTauriMocks();
  });

  // organic-chemistry-ii first: Today's route chunk is still cold, the window in which the left-behind
  // class layout used to switch back (diff council round 3).
  for (const klass of ["organic-chemistry-ii", "cell-biology"]) {
    it(`header picks Shared, Back to ${klass} in Fall while it saves: Today ends in Shared`, async () => {
      let current: Settings = { ...fixtureSettings };
      let onSharedSave: (() => void) | null = null;
      const out = await renderAppAtRoute(
        `/course/${klass}/overview?root=${encodeURIComponent(FIXTURE_ROOT_FALL)}`,
        {
          get_settings: () => later(current),
          save_settings: (args: unknown) => {
            const next = (args as { settings: Settings }).settings;
            if (next.active_root === FIXTURE_ROOT_SHARED && onSharedSave) {
              const fire = onSharedSave;
              onSharedSave = null;
              fire();
            }
            return later(null, 150).then(() => {
              current = next;
              return null;
            });
          },
          list_courses: (args: unknown) =>
            later(
              (args as { root: string }).root === FIXTURE_ROOT_SHARED
                ? ["cell-biology", "collab-notes"]
                : ["cell-biology", "organic-chemistry-ii"],
            ),
          start_folder_watch: () => later(null),
        },
      );
      const { router, queryClient } = out;
      await waitFor(() => expect(router.state.status).toBe("idle"));
      await sleep(400);
      await router.navigate({ to: "/jobs" });
      await waitFor(() => expect(router.state.status).toBe("idle"));
      await sleep(200);
      const sidebar = await screen.findByRole("complementary");
      const header = within(sidebar).getAllByRole("button", { name: /Shared · Study group/i })[0]!;
      onSharedSave = () => router.history.back();
      fireEvent.click(header);
      await sleep(1500);
      await waitFor(() => expect(router.state.status).toBe("idle"));
      const path = router.state.location.pathname;
      expect(pickActiveRoot(queryClient.getQueryData<Settings>(qk.settings()))).toBe(FIXTURE_ROOT_SHARED);
      expect(path).toBe("/");
      expect(current.active_root).toBe(FIXTURE_ROOT_SHARED);
    }, 30000);
  }
});
