import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SyncConflictSession, SyncShowResult, SyncWorkerResult } from "~/domain/types";
import { reloadLibraryAfterSync } from "~/lib/library-reload";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useSyncUiStore } from "~/stores/sync-ui-store";

export function useSyncState(root: string | null) {
  return useQuery({
    queryKey: qk.sync(root ?? ""),
    enabled: Boolean(root),
    queryFn: () => invoke<SyncShowResult>("sync_show", { root: root! }),
  });
}

export function useSyncConflict(root: string | null) {
  const syncConflictOpen = useSyncUiStore((s) => s.syncConflictOpen);
  return useQuery({
    queryKey: qk.syncConflict(root ?? ""),
    enabled: Boolean(root) && syncConflictOpen,
    queryFn: () => invoke<SyncConflictSession>("read_sync_conflict", { root: root! }),
  });
}

export function useSyncSetRemoteMutation(root: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      invoke<{ remote: string }>("sync_set_remote", { root: root!, url }),
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

export function useSyncNowMutation(root: string | null, course: string | null = null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncWorkerResult>("sync_now", { root: root! }),
    onSuccess: (result) => {
      if (!root) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
      if (!result.ok && result.action === "conflict") {
        useSyncUiStore.getState().setSyncConflictOpen(true);
        void queryClient.invalidateQueries({ queryKey: qk.syncConflict(root) });
        return;
      }
      if (result.ok && result.head_changed) {
        reloadLibraryAfterSync(queryClient, root, course);
      }
    },
  });
}

export function useSyncContinueMutation(root: string | null, course: string | null = null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<SyncWorkerResult>("sync_continue", { root: root! }),
    onSuccess: (result) => {
      if (!root) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: qk.sync(root) });
      void queryClient.invalidateQueries({ queryKey: qk.syncConflict(root) });
      if (!result.ok && result.action === "conflict") {
        useSyncUiStore.getState().setSyncConflictOpen(true);
        return;
      }
      if (result.ok && result.head_changed) {
        reloadLibraryAfterSync(queryClient, root, course);
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
