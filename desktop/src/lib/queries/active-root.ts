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
 *
 * A switch whose backend call never answers must not hold the ones behind it for the rest of the
 * session, so each is bounded: past {@link SWITCH_TIMEOUT_MS} it fails (the caller's error toast)
 * and the queue moves on. The late answer, if one ever comes, finds the switch abandoned and stops
 * before it changes anything.
 */
let switchChain: Promise<unknown> = Promise.resolve();
/** How many switches are queued or running. */
let queuedSwitches = 0;
/** The library the newest queued switch is for; `null` once every switch has landed. */
let lastRequestedRoot: string | null = null;
const pendingListeners = new Set<() => void>();

/** How long one switch may take, flushing study writes included, before the queue gives up on it. */
const SWITCH_TIMEOUT_MS = 15_000;
let switchTimeoutMs = SWITCH_TIMEOUT_MS;
/** Bumped by the test reset: a switch from before it must not touch the queue's counters. */
let queueEpoch = 0;

/** One queued switch. `abandoned` once it timed out (or the tests reset the queue): it does nothing more. */
type SwitchRun = { abandoned: boolean; epoch: number };
const liveRuns = new Set<SwitchRun>();

/** Test hook: how long a switch may take before it is given up on; `null` restores the default. */
export function setActiveRootSwitchTimeoutForTests(ms: number | null) {
  switchTimeoutMs = ms ?? SWITCH_TIMEOUT_MS;
}

/**
 * Test hook: forget every queued switch and abandon the ones still running, so one that is in
 * flight when a test ends neither holds the next test's switches back nor saves into its mocks.
 */
export function resetActiveRootSwitchQueueForTests() {
  queueEpoch += 1;
  for (const run of liveRuns) {
    run.abandoned = true;
  }
  liveRuns.clear();
  switchChain = Promise.resolve();
  queuedSwitches = 0;
  lastRequestedRoot = null;
  switchTimeoutMs = SWITCH_TIMEOUT_MS;
  notifyPendingSwitch();
}

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

/** `work`'s result, or a rejection with `message` once `ms` have passed without one. */
function boundedBy<T>(work: Promise<T>, ms: number, message: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function switchActiveRoot(queryClient: QueryClient, root: string, run: SwitchRun) {
  // Checked after every await, before the next step changes anything.
  const stillWanted = () => {
    if (run.abandoned) {
      throw new Error("Library switch abandoned");
    }
  };
  stillWanted();
  const settings = await invoke<Settings>("get_settings");
  stillWanted();
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
  stillWanted();
  resetJobStoreForRootSwitch();
  const next: Settings = {
    ...settings,
    active_root: root,
    knowledge_root: root,
  };
  await saveSettingsSerialized(queryClient, () => {
    stillWanted();
    return next;
  });
  stillWanted();
  await invoke("start_folder_watch", { root });
  stillWanted();
  // TODO(PR 11): clear chat transcript state when the active root changes.
  await queryClient.invalidateQueries({ queryKey: qk.settings() });
}

function enqueueSwitch(queryClient: QueryClient, root: string): Promise<void> {
  const run: SwitchRun = { abandoned: false, epoch: queueEpoch };
  liveRuns.add(run);
  queuedSwitches += 1;
  lastRequestedRoot = root;
  notifyPendingSwitch();
  const queued = switchChain.then(async () => {
    const limit = switchTimeoutMs;
    const timedOut = "Switching library timed out: the app did not get an answer in time. Try again.";
    try {
      await boundedBy(switchActiveRoot(queryClient, root, run), limit, timedOut, () => {
        run.abandoned = true;
      });
    } catch (error) {
      // The save updates the cache before the backend has it, and a failed save is never rolled
      // back: refetch, so the cache says the library the backend is really on before the caller
      // decides what to show. A refetch that never answers must not hold the queue either.
      await boundedBy(queryClient.invalidateQueries({ queryKey: qk.settings() }), limit, timedOut).catch(
        () => undefined,
      );
      throw error;
    } finally {
      liveRuns.delete(run);
      // A switch from before a test reset has no count of its own to give back.
      if (run.epoch === queueEpoch) {
        // Before the caller's promise settles, so whatever it does next sees no switch pending.
        queuedSwitches -= 1;
        if (queuedSwitches === 0) {
          lastRequestedRoot = null;
        }
        notifyPendingSwitch();
      }
    }
  });
  // A failed switch must not stop the ones queued behind it.
  switchChain = queued.catch(() => undefined);
  return queued;
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
