import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import type { KnowledgeSettings, Settings } from "~/domain/types";
import { canUseDesktopIpc } from "~/domain/tauri";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export type KnowledgeSettingsPartial = Omit<Partial<KnowledgeSettings>, "auto_generate"> & {
  auto_generate?: Partial<KnowledgeSettings["auto_generate"]>;
};

let saveSettingsChain: Promise<unknown> = Promise.resolve();

export function resetSaveSettingsChainForTests() {
  saveSettingsChain = Promise.resolve();
}

export async function saveSettingsSerialized(
  queryClient: QueryClient,
  build: (current: Settings) => Settings,
): Promise<Settings> {
  const run = saveSettingsChain.then(async () => {
    let current = queryClient.getQueryData<Settings>(qk.settings());
    if (!current) {
      current = await queryClient.fetchQuery({
        queryKey: qk.settings(),
        queryFn: () => invoke<Settings>("get_settings"),
      });
    }
    if (!current) {
      throw new Error("Settings not loaded");
    }
    const next = build(current);
    queryClient.setQueryData(qk.settings(), next);
    await invoke("save_settings", { settings: next });
    return next;
  });
  saveSettingsChain = run.catch(() => undefined);
  return run;
}

export function mergeKnowledgeSettings(
  current: KnowledgeSettings,
  partial: KnowledgeSettingsPartial,
): KnowledgeSettings {
  return {
    ...current,
    ...partial,
    auto_generate: {
      ...current.auto_generate,
      ...(partial.auto_generate ?? {}),
    },
  };
}

export function useSettings() {
  return useQuery({
    queryKey: qk.settings(),
    queryFn: () => invoke<Settings>("get_settings"),
    enabled: canUseDesktopIpc(),
  });
}

export function useSaveSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) =>
      saveSettingsSerialized(queryClient, () => settings),
  });
}

export function useKnowledgeSettings(root: string | null) {
  return useQuery({
    queryKey: qk.knowledgeSettings(root ?? ""),
    enabled: Boolean(root),
    queryFn: () =>
      invoke<KnowledgeSettings>("get_knowledge_settings", { root: root! }),
  });
}

export function useSaveKnowledgeSettingsMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partial: KnowledgeSettingsPartial) => {
      const current = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: root! });
      const next = mergeKnowledgeSettings(current, partial);
      await invoke("save_knowledge_settings", { root: root!, settings: next });
      return next;
    },
    onSuccess: (next) => {
      if (root) {
        queryClient.setQueryData(qk.knowledgeSettings(root), next);
      }
    },
  });
}

export function usePersistSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (build: (current: Settings) => Settings) =>
      saveSettingsSerialized(queryClient, build),
  });
}
