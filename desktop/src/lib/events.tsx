import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { flashcardJobArgs } from "~/domain/flashcards";
import { quizJobArgs } from "~/domain/quiz";
import { selectionsFromPending } from "~/domain/update";
import { formatWorkerEvent } from "~/domain/worker-events";
import { PROVIDER_FALLBACK } from "~/domain/provider";
import type {
  JobFinished,
  KnowledgeSettings,
  PendingSource,
  UpdatePlan,
  WorkerEvent,
} from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke, listen } from "~/lib/ipc";
import { onJobFinished } from "~/lib/job-finished";
import { reloadLibraryAfterSync } from "~/lib/library-reload";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useJobStore } from "~/stores/job-store";
import { useSyncUiStore } from "~/stores/sync-ui-store";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

let suppressWatchUntil = 0;

export function suppressWatch(ms: number) {
  suppressWatchUntil = Date.now() + ms;
}

export function getSuppressWatchUntilForTests() {
  return suppressWatchUntil;
}

export function resetSuppressWatchForTests() {
  suppressWatchUntil = 0;
}

const STUDY_SKILLS = ["flashcards", "quiz", "concepts", "diagrams", "citations"] as const;

function invalidateCourseStudyKeys(
  queryClient: QueryClient,
  root: string,
  course: string,
) {
  void queryClient.invalidateQueries({ queryKey: qk.digests(root, course) });
  void queryClient.invalidateQueries({ queryKey: qk.courseOverview(root, course) });
  void queryClient.invalidateQueries({ queryKey: qk.studyJson(root, course, "flashcards.json") });
  void queryClient.invalidateQueries({ queryKey: qk.studyJson(root, course, "quiz.json") });
  void queryClient.invalidateQueries({ queryKey: qk.studyJson(root, course, "concepts.json") });
  void queryClient.invalidateQueries({ queryKey: qk.studyJson(root, course, "citations.json") });
  void queryClient.invalidateQueries({ queryKey: qk.quizProgress(root, course) });
  void queryClient.invalidateQueries({ queryKey: qk.studyPlan(root, course) });
  void queryClient.invalidateQueries({ queryKey: ["markdown", root] });
  for (const skill of STUDY_SKILLS) {
    void queryClient.invalidateQueries({ queryKey: qk.studyArtifactStale(root, course, skill) });
  }
}

export function invalidateAfterJobFinished(
  queryClient: QueryClient,
  root: string,
  course: string | null,
) {
  void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
  if (course) {
    invalidateCourseStudyKeys(queryClient, root, course);
  }
}

export function handleFilesChanged(
  queryClient: QueryClient,
  root: string,
  activeRoot: string | null,
) {
  if (!activeRoot || root !== activeRoot) {
    return;
  }
  if (Date.now() < suppressWatchUntil) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: qk.library(root) });
  void queryClient.invalidateQueries({ queryKey: qk.courses(root) });
  void queryClient.invalidateQueries({ queryKey: ["digests", root] });
  void queryClient.invalidateQueries({ queryKey: ["courseOverview", root] });
}

function providerDisplayLabel(providerId: string): string {
  const row = PROVIDER_FALLBACK.find((p) => p.id === providerId);
  return row?.label ?? providerId;
}

export type WatchTriggerDeps = {
  queryClient: QueryClient;
  getKnowledgeSettings: (root: string) => Promise<KnowledgeSettings>;
  planUpdate: (root: string) => Promise<UpdatePlan>;
  startUpdate: (root: string, input: Record<string, unknown>) => Promise<string>;
  checkAuth: (provider: string) => Promise<{ authenticated: boolean }>;
  setPendingPlan: (pending: PendingSource[] | null, open: boolean) => void;
  providerId: string;
  modelId: string | null;
};

export async function handleWatchTriggered(root: string, activeRoot: string | null, deps: WatchTriggerDeps) {
  if (!activeRoot || root !== activeRoot) {
    return;
  }
  if (Date.now() < suppressWatchUntil) {
    return;
  }
  const ks = await deps.getKnowledgeSettings(root);
  if (!ks.watch_enabled) {
    return;
  }
  const plan = await deps.planUpdate(root);
  if (plan.pending.length === 0) {
    return;
  }
  if (ks.auto_update) {
    const auth = await deps.checkAuth(deps.providerId);
    if (!auth.authenticated) {
      deps.setPendingPlan(plan.pending, true);
      return;
    }
    if (!deps.modelId) {
      deps.setPendingPlan(plan.pending, true);
      return;
    }
    await deps.startUpdate(root, {
      model: deps.modelId,
      provider: deps.providerId,
      selections: selectionsFromPending(plan.pending),
      trigger: "watch",
    });
    return;
  }
  deps.setPendingPlan(plan.pending, true);
}

export function handleWorkerProgressSideEffects(
  queryClient: QueryClient,
  ev: WorkerEvent,
  ctx: {
    root: string | null;
    course: string | null;
    providerLabel: string;
  },
) {
  switch (ev.type) {
    case "committed":
    case "sync_done":
      if (ctx.root) {
        reloadLibraryAfterSync(queryClient, ctx.root, ctx.course);
      }
      break;
    case "worker_exit":
      if (ctx.root) {
        void queryClient.invalidateQueries({ queryKey: qk.jobs(ctx.root) });
      }
      break;
    case "sync_conflict":
      if (ctx.root) {
        useSyncUiStore.getState().setSyncConflictOpen(true);
        void queryClient.invalidateQueries({ queryKey: qk.syncConflict(ctx.root) });
      }
      break;
    case "embed_done":
      if (ctx.root) {
        void queryClient.invalidateQueries({ queryKey: ["search", ctx.root] });
      }
      break;
    default:
      break;
  }
  return formatWorkerEvent(ev, ctx.providerLabel);
}

export function WorkerEventsBridge() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const activeRoot = settings.data?.active_root ?? settings.data?.knowledge_root ?? null;
  const effective = useEffectiveProvider(activeRoot);
  const append = useJobStore((s) => s.append);
  const finish = useJobStore((s) => s.finish);
  const startJob = useJobStore((s) => s.start);
  const setStep = useJobStore((s) => s.setStep);
  const jobStateRef = useRef({ pendingAutoEmbed: false, pendingAutoQuiz: false });

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    let unlistenFiles: (() => void) | undefined;

    void listen<{ line: string }>("arbor://progress", (event) => {
      try {
        const parsed = JSON.parse(event.payload.line) as WorkerEvent;
        const lastCourse = useUiStore.getState().lastCourse;
        const course =
          lastCourse && lastCourse.root === activeRoot ? lastCourse.course : null;
        const formatted = handleWorkerProgressSideEffects(queryClient, parsed, {
          root: activeRoot,
          course,
          providerLabel: providerDisplayLabel(effective.providerId),
        });
        append(formatted.line);
        setStep(formatted.step);
      } catch {
        append(event.payload.line);
      }
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void listen<JobFinished>("arbor://job-finished", (event) => {
      const updateJobIdBefore = useJobStore.getState().activeUpdateJobId;
      finish(event.payload);
      const lastCourse = useUiStore.getState().lastCourse;
      const currentCourse =
        lastCourse && lastCourse.root === activeRoot ? lastCourse.course : null;
      void (async () => {
        jobStateRef.current = await onJobFinished(
          event.payload,
          {
            activeUpdateJobId: updateJobIdBefore,
            currentCourse,
            activeRoot,
            getKnowledgeSettings: (root) =>
              invoke("get_knowledge_settings", { root }),
            invalidateAfterJob: (root, course) =>
              invalidateAfterJobFinished(queryClient, root, course),
            startFlashcardsJob: async (force) => {
              if (!activeRoot || !currentCourse || !effective.modelId) {
                return;
              }
              const jobId = await invoke<string>(
                "start_study_job",
                flashcardJobArgs(
                  activeRoot,
                  currentCourse,
                  force,
                  effective.modelId,
                  effective.providerId,
                ),
              );
              startJob(jobId);
            },
            startQuizJob: async (force) => {
              if (!activeRoot || !currentCourse || !effective.modelId) {
                return;
              }
              const jobId = await invoke<string>(
                "start_study_job",
                quizJobArgs(
                  activeRoot,
                  currentCourse,
                  force,
                  effective.modelId,
                  effective.providerId,
                ),
              );
              startJob(jobId);
            },
            startEmbedJob: async (root) => {
              const jobId = await invoke<string>("start_embed_job", { root, force: false });
              startJob(jobId);
            },
          },
          jobStateRef.current,
        );
      })();
    }).then((fn) => {
      unlistenFinished = fn;
    });

    void listen<{ root: string }>("arbor://files-changed", (event) => {
      handleFilesChanged(queryClient, event.payload.root, activeRoot);
      void handleWatchTriggered(event.payload.root, activeRoot, {
        queryClient,
        getKnowledgeSettings: (root) => invoke("get_knowledge_settings", { root }),
        planUpdate: (root) => invoke("plan_update", { root }),
        startUpdate: (root, input) => invoke<string>("start_update", { root, ...input }),
        checkAuth: (provider) => fetchAuthStatus(provider, false),
        setPendingPlan: (pending, open) =>
          useUpdatePlanStore.getState().setPendingPlan(pending, open),
        providerId: effective.providerId,
        modelId: effective.modelId,
      });
    }).then((fn) => {
      unlistenFiles = fn;
    });

    return () => {
      unlistenProgress?.();
      unlistenFinished?.();
      unlistenFiles?.();
    };
  }, [
    activeRoot,
    append,
    effective.modelId,
    effective.providerId,
    finish,
    queryClient,
    setStep,
    startJob,
  ]);

  return null;
}
