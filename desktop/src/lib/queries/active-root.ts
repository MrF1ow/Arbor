import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { Settings } from "~/domain/types";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { invoke } from "~/lib/ipc";
import { flushStudyWritesForRootSwitch } from "~/lib/study-writes";
import { qk } from "~/lib/queries/keys";
import { saveSettingsSerialized } from "~/lib/queries/settings";
import { resetJobStoreForRootSwitch } from "~/stores/job-store";

/**
 * Library switches run one at a time, in the order they were asked for.
 *
 * A switch reads the backend's settings to see whether the library is already active, and the
 * backend only has a switch once its save has landed. Two switches that overlap (browser Back and
 * then a quick Forward) would otherwise read settings the first has not saved yet, see the
 * library as already active, and do nothing: the active library ends up the first one's while the
 * URL names the second's. Chaining them makes each read settings only after the one before it has
 * saved and refreshed them.
 */
let switchChain: Promise<unknown> = Promise.resolve();
/** How many switches are queued or running. */
let queuedSwitches = 0;
/** The library the newest queued switch is for; `null` once every switch has landed. */
let lastRequestedRoot: string | null = null;
const pendingListeners = new Set<() => void>();

function notifyPendingSwitch() {
  for (const listener of pendingListeners) {
    listener();
  }
}

function subscribePendingSwitch(listener: () => void) {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

function readPendingSwitch() {
  return lastRequestedRoot;
}

async function switchActiveRoot(queryClient: QueryClient, root: string) {
  const settings = await invoke<Settings>("get_settings");
  if (pickActiveRoot(settings) === root) {
    // Already the backend's library. The cache may still say another one (an earlier switch's save
    // failed after its optimistic update): make it agree, or a page waiting for this library to be
    // active would wait forever.
    if (pickActiveRoot(queryClient.getQueryData<Settings>(qk.settings())) !== root) {
      queryClient.setQueryData(qk.settings(), settings);
    }
    return;
  }
  await flushStudyWritesForRootSwitch(3000);
  resetJobStoreForRootSwitch();
  const next: Settings = {
    ...settings,
    active_root: root,
    knowledge_root: root,
  };
  await saveSettingsSerialized(queryClient, () => next);
  await invoke("start_folder_watch", { root });
  // TODO(PR 11): clear chat transcript state when the active root changes.
  await queryClient.invalidateQueries({ queryKey: qk.settings() });
}

function enqueueSwitch(queryClient: QueryClient, root: string): Promise<void> {
  queuedSwitches += 1;
  lastRequestedRoot = root;
  notifyPendingSwitch();
  const run = switchChain.then(async () => {
    try {
      await switchActiveRoot(queryClient, root);
    } catch (error) {
      // The save updates the cache before the backend has it, and a failed save is never rolled
      // back: refetch, so the cache says the library the backend is really on before the caller
      // decides what to show.
      await queryClient.invalidateQueries({ queryKey: qk.settings() }).catch(() => undefined);
      throw error;
    } finally {
      // Before the caller's promise settles, so whatever it does next sees no switch pending.
      queuedSwitches -= 1;
      if (queuedSwitches === 0) {
        lastRequestedRoot = null;
      }
      notifyPendingSwitch();
    }
  });
  // A failed switch must not stop the ones queued behind it.
  switchChain = run.catch(() => undefined);
  return run;
}

/**
 * Resolves once no library switch is queued or running (switches queued meanwhile included). A
 * caller that reacts to a failed switch waits for this first: a switch queued behind the failed one
 * (the sidebar's library header) decides where the app ends up, not the failure.
 */
export async function whenNoActiveRootSwitchPending(): Promise<void> {
  while (queuedSwitches > 0) {
    await switchChain;
  }
}

/**
 * The library the newest queued or running switch is for, or `null` when none is. Where the
 * library will end up, whatever the active one says right now: a decision about whether to switch
 * compares against this first, and a page must not render for a library while a switch is pending.
 */
export function usePendingActiveRootSwitch(): string | null {
  return useSyncExternalStore(subscribePendingSwitch, readPendingSwitch, readPendingSwitch);
}

export function useSwitchActiveRootMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (root: string) => enqueueSwitch(queryClient, root),
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
