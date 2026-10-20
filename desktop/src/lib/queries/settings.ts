import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { KnowledgeSettings, Settings } from "~/domain/types";
import { canUseDesktopIpc } from "~/domain/tauri";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

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
    mutationFn: (settings: KnowledgeSettings) =>
      invoke("save_knowledge_settings", { root: root!, settings }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.knowledgeSettings(root) });
      }
    },
  });
}
