import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { reloadLibraryAfterSync } from "~/lib/library-reload";
import { qk } from "~/lib/queries/keys";

describe("reloadLibraryAfterSync", () => {
  it("marks the library's Today stale, since a pull can bring another device's progress", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    reloadLibraryAfterSync(client, "/mock/knowledge/fall-2026", null);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.todayRoot("/mock/knowledge/fall-2026") });
  });

  it("leaves another library's Today alone", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    reloadLibraryAfterSync(client, "/mock/knowledge/fall-2026", "cell-biology");
    expect(spy).not.toHaveBeenCalledWith({ queryKey: qk.todayRoot("/mock/knowledge/shared") });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.todayRoot("/mock/knowledge/fall-2026") });
  });
});
