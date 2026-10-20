import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Settings } from "~/domain/types";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { invoke } from "~/lib/ipc";
import { flushStudyWritesForRootSwitch } from "~/lib/study-writes";
import { qk } from "~/lib/queries/keys";
import { resetJobStoreForRootSwitch } from "~/stores/job-store";

export function useSwitchActiveRootMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (root: string) => {
      const settings = await invoke<Settings>("get_settings");
      if (pickActiveRoot(settings) === root) {
        return;
      }
      await flushStudyWritesForRootSwitch(3000);
      resetJobStoreForRootSwitch();
      const next: Settings = {
        ...settings,
        active_root: root,
        knowledge_root: root,
      };
      await invoke("save_settings", { settings: next });
      // TODO(PR 12): rerun in-flight search when the active root changes.
      await invoke("start_folder_watch", { root });
      // TODO(PR 11): clear chat transcript state when the active root changes.
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
    },
  });
}

export function useActivateKnowledgeRootMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (picked: string) => {
      await flushStudyWritesForRootSwitch(3000);
      resetJobStoreForRootSwitch();
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
      let repoCreated = false;
      let initRepoError: string | null = null;
      try {
        repoCreated = await invoke<boolean>("init_knowledge_repo", { path: picked });
      } catch (error) {
        initRepoError = error instanceof Error ? error.message : String(error);
      }
      await invoke("save_settings", { settings: next });
      await invoke("init_arbor_db", { root: picked });
      await invoke("start_folder_watch", { root: picked });
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
      return { root: picked, repoCreated, initRepoError };
    },
  });
}
