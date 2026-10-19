import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Settings } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useSwitchActiveRootMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (root: string) => {
      const settings = await invoke<Settings>("get_settings");
      const next: Settings = {
        ...settings,
        active_root: root,
        knowledge_root: root,
      };
      await invoke("save_settings", { settings: next });
      await invoke("start_folder_watch", { root });
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

export function useActivateKnowledgeRootMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (picked: string) => {
      const settings = await invoke<Settings>("get_settings");
      const roots = settings.knowledge_roots ?? [];
      const exists = roots.some((e) => e.path === picked);
      const nextRoots = exists
        ? roots
        : [
            ...roots,
            {
              path: picked,
              kind: "personal" as const,
              name: picked.replace(/\/+$/, "").split("/").pop() ?? picked,
            },
          ];
      const next: Settings = {
        ...settings,
        knowledge_roots: nextRoots,
        knowledge_root: picked,
        active_root: picked,
      };
      await invoke("init_knowledge_repo", { path: picked });
      await invoke("save_settings", { settings: next });
      await invoke("start_folder_watch", { root: picked });
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}
