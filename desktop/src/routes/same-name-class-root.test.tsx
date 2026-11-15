import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";
import { getMockIpcCalls } from "~/test/mock-handlers";
import { FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED, fixtureSettings } from "~/test/fixtures/data";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

const CLASS = "cell-biology";
const UNCONFIGURED_ROOT = "/mock/knowledge/removed-library";

/** Real Tauri IPC is never instant: answer after a short delay, as the app sees it. */
function later<T>(value: T, ms = 10): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * Two libraries that both have a class called `cell-biology`, with a backend that follows saves:
 * it answers `get_settings` with what it holds when asked, and holds a save only once it has landed
 * (so a slow save or a slow read is a real window in which settings read as not yet switched).
 */
function sameNameFixtures(
  has: { shared?: string[]; fall?: string[] } = {},
  delay: { get?: number; save?: number } = {},
  active: string = FIXTURE_ROOT_FALL,
) {
  const state = {
    current: { ...fixtureSettings, active_root: active, knowledge_root: active } as typeof fixtureSettings,
    /** How many of the next `get_settings` / `save_settings` calls reject (a failed IPC call). */
    failGets: 0,
    failSaves: 0,
    /** How long a failing `get_settings` takes before it rejects. */
    failGetMs: 10,
  };
  const saves: string[] = [];
  return {
    state,
    saves,
    fixtures: {
      get_settings: () => {
        if (state.failGets > 0) {
          state.failGets -= 1;
          return later(null, state.failGetMs).then(() => Promise.reject(new Error("get_settings failed")));
        }
        const held = state.current;
        return later(held, delay.get ?? 10);
      },
      save_settings: (args: unknown) => {
        const next = (args as { settings: typeof fixtureSettings }).settings;
        if (state.failSaves > 0) {
          state.failSaves -= 1;
          return later(null, delay.save ?? 10).then(() => Promise.reject(new Error("save_settings failed")));
        }
        return later(null, delay.save ?? 10).then(() => {
          state.current = next;
          saves.push(next.active_root ?? "");
          return null;
        });
      },
      start_folder_watch: () => later(null),
      list_courses: (args: unknown) => {
        const root = (args as { root: string }).root;
        return later(
          root === FIXTURE_ROOT_SHARED
            ? (has.shared ?? [CLASS, "collab-notes"])
            : (has.fall ?? [CLASS, "organic-chemistry-ii"]),
        );
      },
    },
  };
}

type AppRouter = Awaited<ReturnType<typeof renderAppAtRoute>>["router"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (root: string) => `/course/${CLASS}/overview?root=${encodeURIComponent(root)}`;

/** Wait until the router has finished navigating and any switch has had time to (wrongly) happen. */
async function settle(router: AppRouter) {
  await waitFor(() => expect(router.state.status).toBe("idle"));
  await sleep(400);
}

/** Open A's class, then B's same-named class from the sidebar, and wait until that has fully settled. */
async function openAThenB(
  has?: { shared?: string[]; fall?: string[] },
  delay?: { get?: number; save?: number },
) {
  const user = userEvent.setup();
  const app = sameNameFixtures(has, delay);
  const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_FALL), app.fixtures);
  const sidebar = await screen.findByRole("complementary");
  const rows = () => within(sidebar).getAllByRole("button", { name: /cell.?biology/i });
  await waitFor(() => expect(rows()).toHaveLength(2));
  await screen.findByLabelText("Exam date");
  await user.click(rows()[1]!);
  await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
  await waitFor(() => expect(app.state.current.active_root).toBe(FIXTURE_ROOT_SHARED));
  await screen.findByLabelText("Exam date");
  await settle(router);
  return { ...app, router, user, sidebar };
}

async function writeExamDate(value: string) {
  const before = getMockIpcCalls().filter((c) => c.cmd === "set_course_meta").length;
  const input = await screen.findByLabelText("Exam date");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(getMockIpcCalls().filter((c) => c.cmd === "set_course_meta").length).toBe(before + 1),
  );
  return getMockIpcCalls().filter((c) => c.cmd === "set_course_meta").at(-1)?.args;
}

describe("a class URL names its library (same class name in two libraries)", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
  });
  afterEach(() => {
    cleanup();
    clearTauriMocks();
  });

  it("opening the other library's same-named class from the sidebar keeps that library active and writes there", async () => {
    const { state, saves, router } = await openAThenB();
    // Exactly one switch, at the click: A -> B. Nothing switched back while the URL says B.
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);
    expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED);
    expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED });
    expect(await writeExamDate("2027-12-01")).toMatchObject({ root: FIXTURE_ROOT_SHARED, course: CLASS });
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);
  });

  it("Back from the other library's same-named class returns to this library, and writes go there", async () => {
    const { state, saves, router } = await openAThenB();
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);

    router.history.back();
    await waitFor(() => expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
    await settle(router);
    expect(router.state.location.pathname).toBe(`/course/${CLASS}/overview`);
    expect(saves).toEqual([FIXTURE_ROOT_SHARED, FIXTURE_ROOT_FALL]);

    // A write the class page makes (the exam date) goes to the library the URL names.
    expect(await writeExamDate("2027-12-01")).toMatchObject({
      root: FIXTURE_ROOT_FALL,
      course: CLASS,
      examDate: "2027-12-01",
    });
    expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL);
  });

  it("Forward after Back returns to the other library, and writes go there", async () => {
    const { state, saves, router } = await openAThenB();
    router.history.back();
    await waitFor(() => expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL));
    await settle(router);

    router.history.forward();
    await waitFor(() => expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
    await settle(router);
    expect(saves).toEqual([FIXTURE_ROOT_SHARED, FIXTURE_ROOT_FALL, FIXTURE_ROOT_SHARED]);
    expect(await writeExamDate("2027-12-02")).toMatchObject({ root: FIXTURE_ROOT_SHARED, course: CLASS });
  });

  it("the sidebar's library header from a ?root= class page lands on Today in the new library and never switches back", async () => {
    const user = userEvent.setup();
    const { state, saves, fixtures } = sameNameFixtures();
    const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_FALL), fixtures);
    const sidebar = await screen.findByRole("complementary");
    await screen.findByLabelText("Exam date");
    await user.click(within(sidebar).getByRole("button", { name: /Shared · Study group/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await settle(router);
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);
    expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED);
    expect(router.state.location.href).not.toContain("root=");
  });

  it("a ?root= naming a configured library that lacks the class falls back to the other libraries instead of staying blank", async () => {
    const { state, fixtures } = sameNameFixtures({ shared: ["collab-notes"] });
    await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), fixtures);
    // The lookup finds it in the library that has it, as for a URL with no ?root=.
    await screen.findByLabelText("Exam date", undefined, { timeout: 3000 });
    expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL);
  });

  it("a ?root= naming a configured library that lacks the class, with no library having it, says Class not found", async () => {
    const { fixtures } = sameNameFixtures({ shared: ["collab-notes"], fall: ["organic-chemistry-ii"] });
    await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), fixtures);
    expect(await screen.findByText("Class not found", undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("opening a class from the sidebar puts its library in the URL", async () => {
    const user = userEvent.setup();
    const { fixtures } = sameNameFixtures();
    const { router } = await renderAppAtRoute("/", fixtures);
    const sidebar = await screen.findByRole("complementary");
    await waitFor(() => expect(within(sidebar).getByText(/collab-notes|Collab notes/i)).toBeInTheDocument());
    await user.click(within(sidebar).getByText(/collab-notes|Collab notes/i));
    await waitFor(() => expect(router.state.location.pathname).toBe("/course/collab-notes/overview"));
    expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED });
  });

  it("a ?root= naming a library that is not configured is ignored: the class opens from the active library", async () => {
    const { state, saves, fixtures } = sameNameFixtures();
    const { router } = await renderAppAtRoute(
      `/course/${CLASS}/overview?root=${encodeURIComponent(UNCONFIGURED_ROOT)}`,
      fixtures,
    );
    await screen.findByLabelText("Exam date");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(saves).toEqual([]);
    expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL);
    expect(router.state.location.pathname).toBe(`/course/${CLASS}/overview`);
  });

  it("clicking a class tab keeps ?root=", async () => {
    const user = userEvent.setup();
    const { fixtures } = sameNameFixtures();
    const { router } = await renderAppAtRoute(
      `/course/${CLASS}/overview?root=${encodeURIComponent(FIXTURE_ROOT_FALL)}`,
      fixtures,
    );
    await screen.findByLabelText("Exam date");
    await user.click(await screen.findByRole("link", { name: "Practice" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${CLASS}/practice/cards`));
    expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL });
  });

  it("Today from a class has no root in its URL", async () => {
    const user = userEvent.setup();
    const { fixtures } = sameNameFixtures();
    const { router } = await renderAppAtRoute(
      `/course/${CLASS}/overview?root=${encodeURIComponent(FIXTURE_ROOT_FALL)}`,
      fixtures,
    );
    const sidebar = await screen.findByRole("complementary");
    await screen.findByLabelText("Exam date");
    await user.click(within(sidebar).getByRole("link", { name: /^Today/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.state.location.search).not.toHaveProperty("root");
    expect(router.state.location.href).not.toContain("root=");
  });

  // A library switch takes real time (read settings, flush, save, refresh), and Back or Forward
  // can come while one is still running. The URL, the active library and every write must agree
  // on the last location, whichever switches were in flight.
  describe("Back and Forward while a library switch is still running", () => {
    /** The class page is up for the library the URL names, and a write there goes to it. */
    async function expectSettledOn(
      root: string,
      app: { state: { current: { active_root?: string | null } }; saves: string[]; router: AppRouter },
    ) {
      await waitFor(() => expect(app.state.current.active_root).toBe(root), { timeout: 8000 });
      await screen.findByLabelText("Exam date", undefined, { timeout: 8000 });
      await settle(app.router);
      expect(app.router.state.location.search).toMatchObject({ root });
      expect(app.state.current.active_root).toBe(root);
      expect(app.saves.at(-1)).toBe(root);
      expect(await writeExamDate("2027-12-09")).toMatchObject({ root, course: CLASS });
    }

    /** If the class page is up, a write there goes to the library its URL names; it may also be down. */
    async function expectNoWriteToAnotherLibrary(router: AppRouter) {
      if (!screen.queryByLabelText("Exam date")) {
        return;
      }
      const { root } = router.state.location.search as { root?: string };
      expect(await writeExamDate("2027-11-30")).toMatchObject({ root, course: CLASS });
    }

    it("Back then a quick Forward, while the Back switch is still saving, ends on the library the URL names", async () => {
      const app = await openAThenB(undefined, { save: 150 });
      app.router.history.back();
      await sleep(30);
      app.router.history.forward();
      await waitFor(() => expect(app.router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
      await expectSettledOn(FIXTURE_ROOT_SHARED, app);
    });

    it("Back then a quick Forward, while the Back switch is still reading settings, ends on the library the URL names", async () => {
      const app = await openAThenB(undefined, { get: 200 });
      app.router.history.back();
      await waitFor(() => expect(app.router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await sleep(20);
      app.router.history.forward();
      await waitFor(() => expect(app.router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
      await expectSettledOn(FIXTURE_ROOT_SHARED, app);
    });

    it("Back, Forward, Back in quick succession ends on the library of the last URL, and nothing writes to another one meanwhile", async () => {
      const app = await openAThenB(undefined, { get: 30, save: 100 });
      app.router.history.back();
      await sleep(20);
      app.router.history.forward();
      // By now the Back switch has reached the settings: the class must not be up for the URL's
      // library while the active one is the other (a write here would go to the wrong library).
      await sleep(60);
      await expectNoWriteToAnotherLibrary(app.router);
      app.router.history.back();
      await waitFor(() => expect(app.router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await expectSettledOn(FIXTURE_ROOT_FALL, app);
    });

    it("Back, Forward, Back, Forward in quick succession ends on the library of the last URL", async () => {
      const app = await openAThenB(undefined, { get: 100, save: 100 });
      app.router.history.back();
      await sleep(20);
      app.router.history.forward();
      await sleep(20);
      app.router.history.back();
      await sleep(20);
      app.router.history.forward();
      await waitFor(() => expect(app.router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
      await expectSettledOn(FIXTURE_ROOT_SHARED, app);
    });
  });

  // `?root=X` can name a library that is configured but lacks the class, while another library has
  // it. The class opens from that other library, and the URL then names it, so every later
  // navigation inside the class (a tab, Ctrl+1-5, the graph view's replace) stays there.
  describe("a ?root= naming a library that lacks the class, which another library has", () => {
    const only = { shared: ["collab-notes"] };

    it("rewrites the URL's root to the library that has the class, replacing the entry", async () => {
      const app = sameNameFixtures(only);
      const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), app.fixtures);
      await screen.findByLabelText("Exam date", undefined, { timeout: 5000 });
      await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await settle(router);
      expect(app.state.current.active_root).toBe(FIXTURE_ROOT_FALL);
      // The rewrite replaced the entry (Back does not return to the stale root), and was no switch.
      expect(app.saves).toEqual([FIXTURE_ROOT_SHARED, FIXTURE_ROOT_FALL]);
      expect(router.history.length).toBe(1);
    });

    it("a class tab clicked after that still renders the class, in the library that has it", async () => {
      const user = userEvent.setup();
      const app = sameNameFixtures(only);
      const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), app.fixtures);
      await screen.findByLabelText("Exam date", undefined, { timeout: 5000 });
      await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await settle(router);
      const before = [...app.saves];

      await user.click(await screen.findByRole("link", { name: "Practice" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${CLASS}/practice/cards`));
      await settle(router);
      expect(screen.queryByText("Class not found")).toBeNull();
      expect(await screen.findByRole("link", { name: "Practice" })).toBeInTheDocument();
      expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL });
      expect(app.state.current.active_root).toBe(FIXTURE_ROOT_FALL);
      expect(app.saves).toEqual(before);
    });

    it("the same, when the stale root's library was already the active one", async () => {
      const user = userEvent.setup();
      const app = sameNameFixtures(only, {}, FIXTURE_ROOT_SHARED);
      const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), app.fixtures);
      await screen.findByLabelText("Exam date", undefined, { timeout: 5000 });
      await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await settle(router);
      expect(app.saves).toEqual([FIXTURE_ROOT_FALL]);

      await user.click(await screen.findByRole("link", { name: "Practice" }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${CLASS}/practice/cards`));
      await settle(router);
      expect(screen.queryByText("Class not found")).toBeNull();
      expect(await screen.findByRole("link", { name: "Practice" })).toBeInTheDocument();
      expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL });
      expect(app.state.current.active_root).toBe(FIXTURE_ROOT_FALL);
      expect(app.saves).toEqual([FIXTURE_ROOT_FALL]);
    });

    it("a replace navigation inside the class (the graph view's) is no switch either", async () => {
      const app = sameNameFixtures(only);
      const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_SHARED), app.fixtures);
      await screen.findByLabelText("Exam date", undefined, { timeout: 5000 });
      await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
      await settle(router);
      const before = [...app.saves];
      await router.navigate({
        to: "/course/$course/map",
        params: { course: CLASS },
        search: { concept: "x" } as never,
        replace: true,
      });
      await settle(router);
      expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL });
      expect(app.saves).toEqual(before);
      expect(screen.queryByText("Class not found")).toBeNull();
    });
  });
});

describe("a failed or overlapped library switch never leaves the URL and the library apart (council)", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
  });
  afterEach(() => {
    cleanup();
    clearTauriMocks();
  });

  it("Back whose switch fails rewrites ?root= to the library that is active, and writes go there", async () => {
    const { state, saves, router } = await openAThenB();
    state.failGets = 1;

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED }));
    await settle(router);
    // The switch to FALL failed: the class shows SHARED's, so the URL names SHARED, never FALL.
    expect(saves).toEqual([FIXTURE_ROOT_SHARED]);
    expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED);
    expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_SHARED });
    expect(await writeExamDate("2027-12-03")).toMatchObject({ root: FIXTURE_ROOT_SHARED, course: CLASS });
  });

  it("a failed save, then Back to the library the backend still has, renders the class instead of staying blank", async () => {
    const app = sameNameFixtures();
    const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_FALL), app.fixtures);
    await screen.findByLabelText("Exam date");
    await settle(router);
    app.state.failSaves = 1;

    await router.navigate({ to: "/course/$course/overview", params: { course: CLASS }, search: { root: FIXTURE_ROOT_SHARED } });
    // The save failed, so the backend never left FALL: the URL is rewritten to name FALL.
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
    await settle(router);
    expect(app.saves).toEqual([]);
    expect(app.state.current.active_root).toBe(FIXTURE_ROOT_FALL);

    router.history.back();
    await settle(router);
    expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL });
    expect(await writeExamDate("2027-12-04")).toMatchObject({ root: FIXTURE_ROOT_FALL, course: CLASS });
    expect(app.state.current.active_root).toBe(FIXTURE_ROOT_FALL);
  });

  it("the sidebar's library header clicked while Back's switch is still pending lands on Today in that library", async () => {
    const { state, router, sidebar } = await openAThenB(undefined, { get: 200 });

    router.history.back();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
    // Back's switch to FALL is still reading settings; the user picks SHARED's header now.
    fireEvent.click(within(sidebar).getByRole("button", { name: /Shared · Study group/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED));
    await settle(router);
    expect(router.state.location.pathname).toBe("/");
    expect(state.current.active_root).toBe(FIXTURE_ROOT_SHARED);
  });
  it("Back twice, the first Back's switch failing slowly: the page never shows one library under a URL naming another", async () => {
    const user = userEvent.setup();
    const app = sameNameFixtures();
    // History: FALL cell-biology -> FALL organic-chemistry-ii -> SHARED cell-biology.
    const { router } = await renderAppAtRoute(urlOf(FIXTURE_ROOT_FALL), app.fixtures);
    await screen.findByLabelText("Exam date");
    await settle(router);
    await router.navigate({
      to: "/course/$course/overview",
      params: { course: "organic-chemistry-ii" },
      search: { root: FIXTURE_ROOT_FALL },
    });
    await settle(router);
    const sidebar = await screen.findByRole("complementary");
    const rows = () => within(sidebar).getAllByRole("button", { name: /cell.?biology/i });
    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.click(rows()[1]!);
    await waitFor(() => expect(app.state.current.active_root).toBe(FIXTURE_ROOT_SHARED));
    await screen.findByLabelText("Exam date");
    await settle(router);

    app.state.failGets = 1;
    app.state.failGetMs = 300;
    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/course/organic-chemistry-ii/overview"));
    // A switch to FALL is already pending: this location must still get a switch of its own.
    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/course/${CLASS}/overview`));
    await settle(router);
    await sleep(400);

    const urlRoot = (router.state.location.search as { root?: string }).root;
    expect(await writeExamDate("2027-12-09")).toMatchObject({ root: urlRoot, course: CLASS });
    expect(app.state.current.active_root).toBe(urlRoot);
  });

  it("a sidebar class row whose switch fails while Back lands on that library: the page never shows the other library under it", async () => {
    const { state, router, sidebar } = await openAThenB();
    state.failGets = 1;
    state.failGetMs = 300;
    fireEvent.click(within(sidebar).getByRole("button", { name: /organic.?chemistry/i }));
    await sleep(50);
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
    await settle(router);
    await sleep(400);
    const urlRoot = (router.state.location.search as { root?: string }).root;
    expect(await writeExamDate("2027-12-10")).toMatchObject({ root: urlRoot, course: CLASS });
    expect(state.current.active_root).toBe(urlRoot);
  });

  it("the header of the library a failing Back switch is heading to still lands on Today in that library", async () => {
    const { state, router, sidebar } = await openAThenB();
    state.failGets = 1;
    state.failGetMs = 300;
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ root: FIXTURE_ROOT_FALL }));
    fireEvent.click(within(sidebar).getByRole("button", { name: /Fall 2026/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await settle(router);
    await sleep(400);
    expect(router.state.location.pathname).toBe("/");
    expect(state.current.active_root).toBe(FIXTURE_ROOT_FALL);
  });
  it("the other-libraries lookup whose switch keeps failing tries once, for a ?root= URL and for one without", async () => {
    for (const url of [urlOf(FIXTURE_ROOT_FALL), `/course/${CLASS}/overview`]) {
      const app = sameNameFixtures({ fall: ["organic-chemistry-ii"], shared: [CLASS] });
      app.state.failSaves = 1000;
      const before = getMockIpcCalls().filter((c) => c.cmd === "save_settings").length;
      const { router } = await renderAppAtRoute(url, app.fixtures);
      await waitFor(() => expect(router.state.status).toBe("idle"));
      await sleep(1500);
      expect(getMockIpcCalls().filter((c) => c.cmd === "save_settings").length - before).toBeLessThanOrEqual(1);
      cleanup();
      clearTauriMocks();
    }
  }, 20000);
});
