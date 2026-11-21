import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { modKeyLabel } from "~/lib/shortcuts";
import { resetEffectiveProviderApplyForTests } from "~/lib/queries/effective-provider";
import { qk } from "~/lib/queries/keys";
import { resetSaveSettingsChainForTests } from "~/lib/queries/settings";
import type { QueryClient } from "@tanstack/react-query";
import { FIXTURE_ROOT_FALL, fixtureKnowledgeSettings, fixtureSettings } from "~/test/fixtures/data";
import {
  clearMockIpcLog,
  getMockIpcCalls,
  getMockIpcLog,
} from "~/test/mock-handlers";
import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";
import { renderAppAtRoute } from "~/test/render";

function settingsView() {
  return screen.getByTestId("settings-view");
}

/** The settings nav lives in the sidebar (settings mode), outside the page. */
function settingsNav() {
  return within(screen.getByRole("navigation", { name: "Settings sections" }));
}

async function waitForSettingsGeneral() {
  await waitFor(() => {
    expect(within(settingsView()).getByTestId("settings-general")).toBeInTheDocument();
  });
}

async function waitForKnowledgeToggles() {
  await waitFor(
    () => {
      expect(within(settingsView()).getAllByRole("switch").length).toBeGreaterThan(0);
    },
    { timeout: 5000 },
  );
}

async function waitForProviderReady() {
  await waitFor(
    () => {
      expect(within(settingsView()).getByTestId("settings-provider")).toBeInTheDocument();
      expect(within(settingsView()).getByRole("combobox", { name: "Provider" })).toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

async function waitForAuthCached(queryClient: QueryClient, providerId: string) {
  await waitFor(() => {
    expect(queryClient.getQueryData(qk.settings())).toBeDefined();
  });
  await waitFor(
    () => {
      const state = queryClient.getQueryState(qk.auth(providerId));
      expect(state?.status).toBe("success");
      expect(state?.fetchStatus).toBe("idle");
    },
    { timeout: 5000 },
  );
}

describe("settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ appearance: "system" });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      label: null,
      lines: [],
      unread: 0,
    });
    resetAuthRefreshForTests();
    resetEffectiveProviderApplyForTests();
    resetSaveSettingsChainForTests();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    clearMockIpcLog();
    vi.restoreAllMocks();
  });

  it("redirects /settings to General", async () => {
    const { router } = await renderAppAtRoute("/settings");
    await waitForSettingsGeneral();
    expect(router.state.location.pathname).toBe("/settings/general");
  });

  it("navigates between settings sections from the nav", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general");
    await waitForSettingsGeneral();

    await user.click(settingsNav().getByRole("button", { name: "Provider & models" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-provider")).toBeInTheDocument();
    });

    await user.click(settingsNav().getByRole("button", { name: "Shortcuts" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-shortcuts")).toBeInTheDocument();
    });
  });

  it("opens Settings on Mod+,", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitFor(() => {
      expect(screen.getAllByText("Course overview").length).toBeGreaterThan(0);
    });
    const mod = modKeyLabel() === "⌘" ? "{Meta>}" : "{Control>}";
    const modEnd = modKeyLabel() === "⌘" ? "{/Meta}" : "{/Control}";
    await user.keyboard(`${mod},${modEnd}`);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/general");
    });
  });

  it("updates appearance and persists save_settings", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general");
    await waitForSettingsGeneral();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Appearance" }));
    await user.click(await screen.findByRole("option", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "save_settings")).toBe(true);
    });
    const saveCall = getMockIpcCalls().find((c) => c.cmd === "save_settings");
    expect((saveCall?.args as { settings?: { appearance?: string } })?.settings?.appearance).toBe(
      "dark",
    );
  });

  it("saves knowledge toggles with merged auto_generate", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general");
    await waitForSettingsGeneral();
    await waitForKnowledgeToggles();

    const switches = within(settingsView()).getAllByRole("switch");
    await user.click(switches[4]!);

    await waitFor(() => {
      const save = getMockIpcCalls().find((c) => c.cmd === "save_knowledge_settings");
      expect(save).toBeDefined();
      const settings = (save?.args as { settings?: typeof fixtureKnowledgeSettings })?.settings;
      expect(settings?.auto_generate.quiz).toBe(false);
      expect(settings?.auto_generate.flashcards).toBe(true);
    });
  });

  it("rolls back a failed knowledge toggle and shows a toast", async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    await renderAppAtRoute("/settings/general", {
      save_knowledge_settings: () => {
        throw new Error("disk full");
      },
    });
    await waitForSettingsGeneral();
    await waitForKnowledgeToggles();

    const watchSwitch = within(settingsView()).getAllByRole("switch")[0]!;
    const before = watchSwitch.getAttribute("aria-checked");
    await user.click(watchSwitch);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    });
    expect(watchSwitch.getAttribute("aria-checked")).toBe(before);
    toastError.mockRestore();
  });

  it("reindexes knowledge with toast and log line", async () => {
    const user = userEvent.setup();
    const toastSuccess = vi.spyOn(toast, "success").mockImplementation(() => "toast-id");
    await renderAppAtRoute("/settings/general");
    await waitForSettingsGeneral();
    await waitForKnowledgeToggles();

    await user.click(within(settingsView()).getByRole("button", { name: "Reindex" }));

    await waitFor(() => {
      expect(getMockIpcLog()).toContain("reindex_knowledge");
      expect(toastSuccess).toHaveBeenCalledWith("Reindexed 12 document(s).");
    });
    expect(useJobStore.getState().lines.some((l) => l.includes("Reindexed 12 document(s)."))).toBe(
      true,
    );
    toastSuccess.mockRestore();
  });

  it("shows the no-root hint on General", async () => {
    await renderAppAtRoute("/settings/general", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await waitForSettingsGeneral();
    await waitFor(() => {
      expect(within(settingsView()).getByText("Choose a Knowledge folder first")).toBeInTheDocument();
    });
  });

  it("lists PROVIDER_FALLBACK and never calls list_providers", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    expect(await screen.findByRole("option", { name: "Anthropic API" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "LM Studio" })).toBeInTheDocument();
    expect(getMockIpcLog()).not.toContain("list_providers");
  });

  it("shows API key controls for openai_api and saves the secret", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "OpenAI API" }));

    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-api-key")).toBeInTheDocument();
    });

    await user.type(within(settingsView()).getByTestId("provider-api-key"), "sk-test");
    await user.click(within(settingsView()).getByRole("button", { name: "Save key" }));

    await waitFor(() => {
      expect(getMockIpcLog()).toContain("set_provider_secret");
      expect(within(settingsView()).getByTestId("provider-api-key")).toHaveValue("");
      expect(within(settingsView()).getByTestId("provider-key-status")).toHaveTextContent("ready");
    });
  });

  it("clears the API key", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "OpenAI API" }));
    await user.click(within(settingsView()).getByRole("button", { name: "Clear key" }));

    await waitFor(() => {
      expect(getMockIpcLog()).toContain("clear_provider_secret");
    });
  });

  it("persists ollama base URL", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Ollama" }));

    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-base-url")).toBeInTheDocument();
    });
    const input = within(settingsView()).getByTestId("provider-base-url");
    expect(input).toHaveAttribute("placeholder", "http://127.0.0.1:11434");

    fireEvent.change(input, { target: { value: "http://127.0.0.1:11434" } });
    fireEvent.blur(input);

    await waitFor(() => {
      const saves = getMockIpcCalls().filter((c) => c.cmd === "save_settings");
      expect(
        saves.some(
          (save) =>
            (save.args as { settings?: { ollama_base_url?: string | null } })?.settings
              ?.ollama_base_url === "http://127.0.0.1:11434",
        ),
      ).toBe(true);
    });
  });

  it("persists model_id on model change", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider", {
      list_models: () => ({
        models: [
          { id: "grok-4.7", label: "Grok 4.7" },
          { id: "grok-mini", label: "Grok Mini" },
        ],
      }),
    });
    await waitForProviderReady();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "Grok Mini" }));

    await waitFor(() => {
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      expect((save?.args as { settings?: { model_id?: string } })?.settings?.model_id).toBe(
        "grok-mini",
      );
    });
  });

  it("writes provider_overrides when a library provider is present", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider", {
      library_show: () => ({
        present: true,
        provider: { id: "claude", model: "sonnet" },
      }),
    });
    await waitFor(() => {
      expect(within(settingsView()).getByText("recommended by library")).toBeInTheDocument();
    });

    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Codex" }));

    await waitFor(() => {
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      const overrides = (
        save?.args as {
          settings?: { provider_overrides?: { path: string; provider_id: string }[] };
        }
      )?.settings?.provider_overrides;
      expect(overrides?.some((o) => o.path === FIXTURE_ROOT_FALL && o.provider_id === "codex")).toBe(
        true,
      );
      expect((save?.args as { settings?: { provider_id?: string } })?.settings?.provider_id).toBe(
        "grok",
      );
    });
  });

  it("forces check_auth after a provider change", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    clearMockIpcLog();

    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Codex" }));

    await waitFor(() => {
      const authCalls = getMockIpcCalls().filter((c) => c.cmd === "check_auth");
      expect(authCalls.some((c) => (c.args as { force?: boolean })?.force === true)).toBe(true);
    });
  });

  it("does not call check_auth when opening settings within the auth cache window", async () => {
    const providerId = fixtureSettings.provider_id;
    const { router, queryClient } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForAuthCached(queryClient, providerId);
    clearMockIpcLog();

    await router.navigate({ to: "/settings/provider" });
    await waitForProviderReady();
    await waitFor(() => {
      expect(queryClient.getQueryState(qk.auth(providerId))?.fetchStatus).toBe("idle");
    });
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(0);
  });

  it("renders shortcut groups and platform modifier labels", async () => {
    await renderAppAtRoute("/settings/shortcuts");
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-shortcuts")).toBeInTheDocument();
    });
    expect(within(settingsView()).getByText("Toggle sidebar")).toBeInTheDocument();
    expect(within(settingsView()).getByText("Flashcards")).toBeInTheDocument();
    expect(within(settingsView()).getAllByText(modKeyLabel()).length).toBeGreaterThan(0);
  });

  it("shows Ctrl vs ⌘ labels when the platform is mocked", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    const shortcutsMac = await import("~/lib/shortcuts");
    expect(shortcutsMac.modKeyLabel()).toBe("⌘");

    vi.resetModules();
    vi.stubGlobal("navigator", { ...navigator, platform: "Linux x86_64" });
    const shortcutsLinux = await import("~/lib/shortcuts");
    expect(shortcutsLinux.modKeyLabel()).toBe("Ctrl");
  });

  it("preserves sync_after_commit when toggling each knowledge switch", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general", {
      get_knowledge_settings: () => ({
        ...fixtureKnowledgeSettings,
        sync_after_commit: true,
      }),
    });
    await waitForSettingsGeneral();
    await waitForKnowledgeToggles();

    const switches = within(settingsView()).getAllByRole("switch");
    expect(switches.length).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      clearMockIpcLog();
      await user.click(switches[i]!);
      await waitFor(() => {
        const save = getMockIpcCalls().find((c) => c.cmd === "save_knowledge_settings");
        expect(save).toBeDefined();
        const settings = (save?.args as { settings?: typeof fixtureKnowledgeSettings })?.settings;
        expect(settings?.sync_after_commit).toBe(true);
      });
    }
  });

  it("logs and toasts reindex failures", async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    await renderAppAtRoute("/settings/general", {
      reindex_knowledge: () => {
        throw new Error("index locked");
      },
    });
    await waitForSettingsGeneral();
    await waitForKnowledgeToggles();
    await user.click(within(settingsView()).getByRole("button", { name: "Reindex" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("index locked"));
    });
    expect(useJobStore.getState().lines.some((l) => l.includes("Reindex failed:"))).toBe(true);
    toastError.mockRestore();
  });

  it("keeps unrelated settings fields on provider save_settings", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Codex" }));
    await waitFor(() => {
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      const settings = (save?.args as { settings?: typeof fixtureSettings })?.settings;
      expect(settings?.knowledge_roots).toEqual(fixtureSettings.knowledge_roots);
      expect(settings?.workers).toEqual(fixtureSettings.workers);
      expect(settings?.skill_grants).toEqual(fixtureSettings.skill_grants);
      expect(settings?.lmstudio_base_url).toBe(fixtureSettings.lmstudio_base_url);
    });
  });

  it("shows LM Studio base URL placeholder", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "LM Studio" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-base-url")).toHaveAttribute(
        "placeholder",
        "http://127.0.0.1:1234/v1",
      );
    });
  });

  it("shows API key row for Anthropic API", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Anthropic API" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-api-key")).toBeInTheDocument();
    });
  });

  it("updates auth status after saving an API key", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider", {
      check_auth: (args) => {
        const force = Boolean((args as { force?: boolean }).force);
        return {
          authenticated: force,
          reason: force ? "" : "cached",
          docs_url: "",
        };
      },
    });
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "OpenAI API" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-api-key")).toBeInTheDocument();
    });
    clearMockIpcLog();
    await user.type(within(settingsView()).getByTestId("provider-api-key"), "sk-test");
    await user.click(within(settingsView()).getByRole("button", { name: "Save key" }));
    await waitFor(() => {
      const forced = getMockIpcCalls().filter(
        (c) => c.cmd === "check_auth" && (c.args as { force?: boolean }).force === true,
      );
      expect(forced.length).toBeGreaterThan(0);
      expect(within(settingsView()).getByTestId("provider-auth-status")).toHaveTextContent(
        "OpenAI API · grok-4.7",
      );
    });
  });

  it("shows key missing and refreshes auth after clear key", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "OpenAI API" }));
    await user.click(within(settingsView()).getByRole("button", { name: "Clear key" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-key-status")).toHaveTextContent(
        "key missing",
      );
      expect(getMockIpcLog()).toContain("clear_provider_secret");
    });
  });

  it("does not call check_auth when opening General within the auth cache window", async () => {
    const providerId = fixtureSettings.provider_id;
    const { router, queryClient } = await renderAppAtRoute("/course/cell-biology/overview");
    await waitForAuthCached(queryClient, providerId);
    clearMockIpcLog();
    await router.navigate({ to: "/settings/general" });
    await waitForSettingsGeneral();
    await waitFor(() => {
      expect(queryClient.getQueryState(qk.auth(providerId))?.fetchStatus).toBe("idle");
    });
    expect(getMockIpcLog().filter((c) => c === "check_auth")).toHaveLength(0);
  });

  it("shows human-readable labels on appearance, provider, and model selects", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general");
    await waitForSettingsGeneral();
    expect(within(settingsView()).getByRole("combobox", { name: "Appearance" })).toHaveTextContent(
      "System",
    );

    await user.click(settingsNav().getByRole("button", { name: "Provider & models" }));
    await waitForProviderReady();
    expect(within(settingsView()).getByRole("combobox", { name: "Provider" })).toHaveTextContent(
      "Grok",
    );
    expect(within(settingsView()).getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "Grok 4.7",
    );
  });

  it("does not repeat list_models after a model change for a cached provider", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider", {
      list_models: () => ({
        models: [
          { id: "grok-4.7", label: "Grok 4.7" },
          { id: "grok-mini", label: "Grok Mini" },
        ],
      }),
    });
    await waitForProviderReady();
    await waitFor(() => {
      expect(getMockIpcLog().filter((c) => c === "list_models").length).toBeGreaterThan(0);
    });
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Model" }));
    await user.click(await screen.findByRole("option", { name: "Grok Mini" }));
    await waitFor(() => {
      expect(getMockIpcCalls().some((c) => c.cmd === "save_settings")).toBe(true);
    });
    expect(getMockIpcLog().filter((c) => c === "list_models")).toHaveLength(0);
  });

  it("skips persist and refresh when base URL blur matches stored value", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider", {
      get_settings: () => ({
        ...fixtureSettings,
        ollama_base_url: "http://127.0.0.1:11434",
      }),
    });
    await waitForProviderReady();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Ollama" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("provider-base-url")).toBeInTheDocument();
    });
    clearMockIpcLog();
    const input = within(settingsView()).getByTestId("provider-base-url");
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 200));
    expect(getMockIpcLog().filter((c) => c === "save_settings")).toHaveLength(0);
    expect(getMockIpcLog().filter((c) => c === "list_models")).toHaveLength(0);
  });

  it("renders sharing settings routes and highlights the active nav row", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/library");
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-library")).toBeInTheDocument();
    });
    const libraryNav = settingsNav().getByRole("button", { name: "Library & sharing" });
    expect(libraryNav.getAttribute("aria-current")).toBe("page");

    await user.click(settingsNav().getByRole("button", { name: "Sync" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-sync")).toBeInTheDocument();
      expect(settingsNav().getByRole("button", { name: "Sync" }).getAttribute("aria-current")).toBe(
        "page",
      );
    });
  });

  it("persists a fallback model id when the stored model is missing from the list", async () => {
    await renderAppAtRoute("/settings/provider", {
      get_settings: () => ({
        ...fixtureSettings,
        model_id: "missing-model",
      }),
      list_models: () => ({
        models: [{ id: "grok-4.7", label: "Grok 4.7" }],
      }),
    });
    await waitForProviderReady();
    await waitFor(() => {
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      expect((save?.args as { settings?: { model_id?: string } })?.settings?.model_id).toBe(
        "grok-4.7",
      );
    });
  });

  it("persists provider when list_models fails and still forces auth", async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
    await renderAppAtRoute("/settings/provider", {
      list_models: () => {
        throw new Error("models down");
      },
    });
    await waitForProviderReady();
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Codex" }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("models down"));
      const save = getMockIpcCalls().filter((c) => c.cmd === "save_settings").at(-1);
      expect((save?.args as { settings?: { provider_id?: string } })?.settings?.provider_id).toBe(
        "codex",
      );
      expect(
        getMockIpcCalls().some(
          (c) => c.cmd === "check_auth" && (c.args as { force?: boolean }).force === true,
        ),
      ).toBe(true);
    });
    toastError.mockRestore();
  });
});

describe("settings pages in the design's layout", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({ appearance: "system" });
    resetAuthRefreshForTests();
    resetEffectiveProviderApplyForTests();
    resetSaveSettingsChainForTests();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    clearMockIpcLog();
    vi.restoreAllMocks();
  });

  /** A settings group: the card under its heading. */
  async function groupByTitle(title: string) {
    const heading = await within(settingsView()).findByRole("heading", { level: 2, name: title });
    return heading.closest("section") as HTMLElement;
  }

  it.each([
    ["/settings/general", "General"],
    ["/settings/provider", "Provider & models"],
    ["/settings/library", "Library & sharing"],
    ["/settings/sync", "Sync"],
    ["/settings/skills", "Skills"],
    ["/settings/workers", "Workers"],
    ["/settings/shortcuts", "Shortcuts"],
  ])("%s starts with a %s page heading", async (route, title) => {
    await renderAppAtRoute(route);
    await waitFor(() => {
      expect(
        within(settingsView()).getByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
    });
  });

  it("shows Usage this week from usage_summary: tokens and requests", async () => {
    await renderAppAtRoute("/settings/provider", {
      usage_summary: () => [
        { provider: "grok", requests: 48, input_tokens: 182_400, output_tokens: 61_200, tokens_known: 48 },
        { provider: "codex", requests: 12, input_tokens: 40_100, output_tokens: 9_800, tokens_known: 10 },
      ],
    });
    const usage = await groupByTitle("Usage this week");
    // 182,400 + 61,200 + 40,100 + 9,800 = 293,500 tokens; 48 + 12 = 60 requests.
    expect(await within(usage).findByText("293.5K")).toBeInTheDocument();
    expect(within(usage).getByText("60")).toBeInTheDocument();
    expect(within(usage).getByText(/2 requests reported no token counts/)).toBeInTheDocument();
    const call = getMockIpcCalls().find((c) => c.cmd === "usage_summary");
    expect(call?.args).toMatchObject({ root: FIXTURE_ROOT_FALL, days: 7 });
  });

  it("says to choose a Knowledge folder when there is no active library", async () => {
    await renderAppAtRoute("/settings/provider", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    const usage = await groupByTitle("Usage this week");
    expect(
      await within(usage).findByText("Choose a Knowledge folder to see usage"),
    ).toBeInTheDocument();
    expect(within(usage).queryByText("No usage yet this week.")).toBeNull();
  });

  it("has no Settings link inside the settings view on Provider & models", async () => {
    await renderAppAtRoute("/settings/provider");
    const limits = await groupByTitle("Provider limits");
    expect(await within(limits).findByText("Weekly")).toBeInTheDocument();
    expect(within(limits).getByRole("button", { name: "Refresh usage" })).toBeInTheDocument();
    expect(within(settingsView()).queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("shows a labelled Status row with a ready chip on Provider & models", async () => {
    await renderAppAtRoute("/settings/provider");
    await waitForProviderReady();
    const status = await within(settingsView()).findByTestId("provider-auth-status");
    expect(within(status).getByText("Status")).toBeInTheDocument();
    expect(await within(status).findByText("ready")).toBeInTheDocument();
    expect(status).toHaveTextContent("· grok-4.7");
  });

  it("says so when there is no usage this week", async () => {
    await renderAppAtRoute("/settings/provider", { usage_summary: () => [] });
    const usage = await groupByTitle("Usage this week");
    expect(await within(usage).findByText("No usage yet this week.")).toBeInTheDocument();
  });

  it("reuses the usage popover content: limit windows with reset times and Refresh", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/provider");
    const limits = await groupByTitle("Provider limits");
    // The grok fixture reports one Weekly window, 37% used, resetting in two days.
    expect(await within(limits).findByText("Weekly")).toBeInTheDocument();
    expect(within(limits).getByText("63% left")).toBeInTheDocument();
    expect(within(limits).getByText(/^resets in /)).toBeInTheDocument();
    clearMockIpcLog();
    await user.click(within(limits).getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) => c.cmd === "read_provider_usage" && (c.args as { force?: boolean }).force === true,
        ),
      ).toBe(true);
    });
  });

  it("shows Last synced from sync_show.last_synced_at", async () => {
    const minutesAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    await renderAppAtRoute("/settings/sync", {
      sync_show: () => ({
        remote: "git@example.com:me/notes.git",
        shared: false,
        remote_note: null,
        last_synced_at: minutesAgo,
      }),
    });
    expect(await within(settingsView()).findByText("Last synced 12 min ago")).toBeInTheDocument();
  });

  it("shows Never synced when last_synced_at is null", async () => {
    await renderAppAtRoute("/settings/sync", {
      sync_show: () => ({
        remote: "git@example.com:me/notes.git",
        shared: false,
        remote_note: null,
        last_synced_at: null,
      }),
    });
    expect(await within(settingsView()).findByText("Never synced")).toBeInTheDocument();
  });

  it("General's Folder row shows the folder and Change… runs the folder picker", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general", {
      "plugin:dialog|open": () => "/scratch/other-library",
    });
    await waitForSettingsGeneral();
    expect(await within(settingsView()).findByText(FIXTURE_ROOT_FALL)).toBeInTheDocument();
    clearMockIpcLog();
    await user.click(within(settingsView()).getByRole("button", { name: "Change…" }));
    await waitFor(() => {
      expect(
        getMockIpcCalls().some(
          (c) =>
            c.cmd === "start_folder_watch" &&
            (c.args as { root?: string }).root === "/scratch/other-library",
        ),
      ).toBe(true);
    });
  });

  it("General has no Folder row without a Knowledge folder", async () => {
    await renderAppAtRoute("/settings/general", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
    });
    await waitForSettingsGeneral();
    await within(settingsView()).findByText("Choose a Knowledge folder first");
    expect(within(settingsView()).queryByRole("button", { name: "Change…" })).toBeNull();
  });

  it("General's Choose Knowledge folder… runs the folder picker when there is no folder", async () => {
    const user = userEvent.setup();
    await renderAppAtRoute("/settings/general", {
      get_settings: () => ({
        ...fixtureSettings,
        knowledge_root: null,
        active_root: null,
        knowledge_roots: [],
      }),
      "plugin:dialog|open": () => "/scratch/picked-library",
    });
    await waitForSettingsGeneral();
    clearMockIpcLog();
    await user.click(
      await within(settingsView()).findByRole("button", { name: "Choose Knowledge folder…" }),
    );
    await waitFor(() => {
      expect(getMockIpcLog().some((entry) => entry.includes("plugin:dialog|open"))).toBe(true);
    });
  });

  it("lists Mod+1–5 as Open Overview, Cards, Quiz, Map and Ask", async () => {
    await renderAppAtRoute("/settings/shortcuts");
    for (const name of ["Open Overview", "Open Cards", "Open Quiz", "Open Map", "Open Ask"]) {
      expect(await within(settingsView()).findByText(name)).toBeInTheDocument();
    }
  });
});
