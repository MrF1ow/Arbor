import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { KnowledgeSettings, SyncConflictSession, SyncShowResult, SyncWorkerResult } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useSyncState(root: string | null) {
  return useQuery({
    queryKey: qk.sync(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<SyncShowResult>("sync_show", { root: root! }),
  });
}

export function useSyncConflict(root: string | null) {
  return useQuery({
    queryKey: qk.syncConflict(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<SyncConflictSession>("read_sync_conflict", { root: root! }),
  });
}

export function useSyncSetRemoteMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (remote: string) =>
      invoke<{ remote: string }>("sync_set_remote", { root: root!, remote }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
      }
    },
  });
}

export function useSyncSetSharedMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shared: boolean) =>
      invoke("sync_set_shared", { root: root!, shared }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
      }
    },
  });
}

export function useSyncNowMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncWorkerResult>("sync_now", { root: root! }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
        void queryClient.invalidateQueries({ queryKey: qk.library(root) });
        void queryClient.invalidateQueries({ queryKey: qk.courses(root) });
      }
    },
  });
}

export function useSyncContinueMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncWorkerResult>("sync_continue", { root: root! }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
        void queryClient.invalidateQueries({ queryKey: qk.syncConflict(root) });
      }
    },
  });
}

export function useSyncResolveMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invoke("sync_resolve", { root: root!, ...input }),
    onSuccess: () => {
      if (root) {
        void queryClient.invalidateQueries({ queryKey: qk.syncConflict(root) });
      }
    },
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
