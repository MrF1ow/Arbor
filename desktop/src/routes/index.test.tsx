import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { renderAppAtRoute } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";

describe("index route", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ lastCourse: null });
  });

  afterEach(() => {
    clearTauriMocks();
  });

  it("redirects to the first course overview when lastCourse is unset", async () => {
    const { router } = await renderAppAtRoute("/");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/cell-biology/notes");
    });
  });

  it("redirects to lastCourse notes when set for the active root", async () => {
    useUiStore.setState({
      lastCourse: { root: FIXTURE_ROOT_FALL, course: "linear-algebra" },
    });
    const { router } = await renderAppAtRoute("/");
    await waitFor(() => {
      expect(router.state.location.pathname).toContain("/course/linear-algebra/notes");
    });
  });
});
