import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { KnowledgeSettings, Settings } from "~/domain/types";
import { canUseDesktopIpc } from "~/domain/tauri";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export type KnowledgeSettingsPartial = Omit<Partial<KnowledgeSettings>, "auto_generate"> & {
  auto_generate?: Partial<KnowledgeSettings["auto_generate"]>;
};

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
    mutationFn: (settings: Settings) => invoke("save_settings", { settings }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
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
  const save = useSaveSettingsMutation();
  return useMutation({
    mutationFn: async (build: (current: Settings) => Settings) => {
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
      await save.mutateAsync(next);
      return next;
    },
  });
}
