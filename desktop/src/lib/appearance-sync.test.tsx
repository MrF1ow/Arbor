import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { AppearanceSync } from "~/lib/appearance-sync";
import { createAppQueryClient } from "~/lib/query-client";
import { useUiStore } from "~/stores/ui-store";
import { getMockIpcLog } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

describe("AppearanceSync", () => {
  afterEach(() => {
    clearMocks();
    useUiStore.setState({ appearance: "system" });
  });

  it("hydrates from settings without saving, then saves user changes once", async () => {
    installMockIpc({
      get_settings: () => ({
        knowledge_root: "/mock/a",
        active_root: "/mock/a",
        knowledge_roots: [],
        model_id: "grok-4.7",
        provider_id: "grok",
        appearance: "dark",
        ollama_base_url: null,
        lmstudio_base_url: null,
        skill_index_source: "",
        skill_index_ref: "",
        skill_grants: [],
        provider_overrides: [],
        workers: [],
      }),
    });
    useUiStore.setState({ appearance: "system" });
    const client = createAppQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <AppearanceSync />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useUiStore.getState().appearance).toBe("dark"));
    expect(getMockIpcLog().filter((c) => c === "save_settings")).toHaveLength(0);

    useUiStore.getState().setAppearance("light");
    rerender(
      <QueryClientProvider client={client}>
        <AppearanceSync />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(getMockIpcLog().filter((c) => c === "save_settings")).toHaveLength(1),
    );
  });
});
