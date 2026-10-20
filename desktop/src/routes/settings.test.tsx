import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { resetAuthRefreshForTests } from "~/lib/auth-refresh";
import { modKeyLabel } from "~/lib/shortcuts";
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

    await user.click(within(settingsView()).getByRole("button", { name: "Provider & models" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-provider")).toBeInTheDocument();
    });

    await user.click(within(settingsView()).getByRole("button", { name: "Shortcuts" }));
    await waitFor(() => {
      expect(within(settingsView()).getByTestId("settings-shortcuts")).toBeInTheDocument();
    });
  });

  it("opens Settings on Mod+,", async () => {
    const user = userEvent.setup();
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
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
    await user.click(switches[5]!);

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

    await user.click(within(settingsView()).getByTestId("reindex-knowledge"));

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
    const { router } = await renderAppAtRoute("/course/cell-biology/notes");
    await waitFor(() => {
      expect(getMockIpcLog().filter((c) => c === "check_auth").length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 400));
    clearMockIpcLog();

    await router.navigate({ to: "/settings/provider" });
    await waitForProviderReady();
    await new Promise((r) => setTimeout(r, 400));
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
});
