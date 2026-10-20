import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "~/stores/ui-store";

describe("useUiStore persist", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ appearance: "system" });
  });

  it("falls back to system when rehydrating an invalid appearance", async () => {
    localStorage.setItem(
      "arbor.ui",
      JSON.stringify({ state: { appearance: "neon" }, version: 0 }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().appearance).toBe("system");
  });

  it("keeps a valid persisted appearance", async () => {
    localStorage.setItem(
      "arbor.ui",
      JSON.stringify({ state: { appearance: "dark" }, version: 0 }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().appearance).toBe("dark");
  });
});
