import { afterEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { qk } from "~/lib/queries/keys";
import {
  resetSaveSettingsChainForTests,
  saveSettingsSerialized,
} from "~/lib/queries/settings";
import { fixtureSettings } from "~/test/fixtures/data";
import { getMockIpcCalls } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

describe("saveSettingsSerialized", () => {
  afterEach(() => {
    clearTauriMocks();
    resetSaveSettingsChainForTests();
  });

  it("merges rapid writes so both partials survive", async () => {
    installMockIpc();
    const client = createAppQueryClient();
    client.setQueryData(qk.settings(), fixtureSettings);

    const first = saveSettingsSerialized(client, (current) => ({
      ...current,
      appearance: "dark",
    }));
    const second = saveSettingsSerialized(client, (current) => ({
      ...current,
      provider_id: "codex",
    }));

    await Promise.all([first, second]);

    const saves = getMockIpcCalls().filter((c) => c.cmd === "save_settings");
    expect(saves.length).toBe(2);
    const last = saves.at(-1)?.args as { settings?: typeof fixtureSettings };
    expect(last?.settings?.appearance).toBe("dark");
    expect(last?.settings?.provider_id).toBe("codex");
    expect(last?.settings?.knowledge_roots).toEqual(fixtureSettings.knowledge_roots);
    expect(last?.settings?.workers).toEqual(fixtureSettings.workers);
    expect(last?.settings?.skill_grants).toEqual(fixtureSettings.skill_grants);
  });
});
