import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { flashcardJobArgs } from "~/domain/flashcards";
import { quizJobArgs } from "~/domain/quiz";
import { selectionsFromPending } from "~/domain/update";
import { formatWorkerEvent } from "~/domain/worker-events";
import { effectiveProvider } from "~/domain/library-role";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import type {
  AuthStatus,
  JobFinished,
  KnowledgeSettings,
  PendingSource,
  Settings,
  UpdatePlan,
  WorkerEvent,
} from "~/domain/types";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke, subscribe } from "~/lib/ipc";
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

export type PresentUpdatePlanDeps = {
  getKnowledgeSettings: (root: string) => Promise<KnowledgeSettings>;
  planUpdate: (root: string) => Promise<UpdatePlan>;
  startUpdate: (root: string, input: Record<string, unknown>) => Promise<string>;
  checkAuth: (provider: string) => Promise<AuthStatus>;
  setPendingPlan: (pending: PendingSource[] | null, open: boolean) => void;
  appendJobLine: (line: string) => void;
  providerId: string;
  modelId: string | null;
  reason: "watch" | "import";
  knowledgeSettings?: KnowledgeSettings;
};

export async function presentUpdatePlan(root: string, deps: PresentUpdatePlanDeps) {
  try {
    const ks = deps.knowledgeSettings ?? (await deps.getKnowledgeSettings(root));
    const plan = await deps.planUpdate(root);
    if (plan.pending.length === 0) {
      return;
    }
    deps.appendJobLine(
      deps.reason === "watch"
        ? `Folder watch detected ${plan.pending.length} file(s) to process.`
        : `Added files. ${plan.pending.length} file(s) to process.`,
    );
    if (ks.auto_update) {
      const auth = await deps.checkAuth(deps.providerId);
      if (!auth.authenticated) {
        deps.setPendingPlan(plan.pending, true);
        const label = providerDisplayLabel(deps.providerId);
        deps.appendJobLine(
          `Auto-update waiting for ${label} auth. Review and Confirm when ready. ${signedOutJobMessage(label, auth.reason ?? "")}`,
        );
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
        trigger: deps.reason === "watch" ? "watch" : "manual",
      });
      return;
    }
    deps.setPendingPlan(plan.pending, true);
    deps.appendJobLine("Review the detected files and Confirm when ready.");
  } catch (error) {
    deps.appendJobLine(
      deps.reason === "watch" ? `Watch plan failed: ${error}` : `Plan failed: ${error}`,
    );
  }
}

export type WatchTriggerDeps = Omit<
  PresentUpdatePlanDeps,
  "reason" | "appendJobLine" | "knowledgeSettings"
> & {
  appendJobLine: PresentUpdatePlanDeps["appendJobLine"];
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
  await presentUpdatePlan(root, { ...deps, reason: "watch", knowledgeSettings: ks });
}

export async function presentUpdatePlanAfterImport(root: string) {
  const settings = await invoke<Settings>("get_settings");
  const library = await invoke<{ present?: boolean; provider?: { id: string; model: string } }>(
    "library_show",
    { root },
  );
  const libraryProvider =
    library.present === true && library.provider ? library.provider : null;
  const effective = effectiveProvider({
    root,
    settingsProviderId: settings.provider_id?.trim() || "codex",
    settingsModelId: settings.model_id ?? null,
    overrides: settings.provider_overrides ?? [],
    libraryProvider,
  });
  await presentUpdatePlan(root, {
    reason: "import",
    providerId: effective.providerId,
    modelId: effective.modelId,
    getKnowledgeSettings: (r) => invoke("get_knowledge_settings", { root: r }),
    planUpdate: (r) => invoke("plan_update", { root: r }),
    startUpdate: (r, input) => invoke<string>("start_update", { root: r, ...input }),
    checkAuth: (provider) => fetchAuthStatus(provider, true),
    setPendingPlan: (pending, open) =>
      useUpdatePlanStore.getState().setPendingPlan(pending, open),
    appendJobLine: (line) => useJobStore.getState().append(line),
  });
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

type WorkerEventsBridgeContext = {
  activeRoot: string | null;
  providerId: string;
  modelId: string | null;
  queryClient: QueryClient;
  append: (line: string) => void;
  finish: (payload: JobFinished) => void;
  setStep: (step: string | null) => void;
  startJob: (jobId: string) => void;
};

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
  const ctxRef = useRef<WorkerEventsBridgeContext>({
    activeRoot: null,
    providerId: "codex",
    modelId: null,
    queryClient,
    append,
    finish,
    setStep,
    startJob,
  });

  useEffect(() => {
    ctxRef.current = {
      activeRoot,
      providerId: effective.providerId,
      modelId: effective.modelId,
      queryClient,
      append,
      finish,
      setStep,
      startJob,
    };
  });

  useEffect(() => {
    let pendingLines: string[] = [];
    let pendingStep: string | null | undefined;
    let flushRaf: number | null = null;

    const flushProgressBatch = () => {
      flushRaf = null;
      const ctx = ctxRef.current;
      if (pendingLines.length > 0) {
        useJobStore.getState().appendBatch(pendingLines);
        pendingLines = [];
      }
      if (pendingStep !== undefined) {
        ctx.setStep(pendingStep);
        pendingStep = undefined;
      }
    };

    const queueProgress = (line: string, step: string | null) => {
      pendingLines.push(line);
      pendingStep = step;
      if (flushRaf == null) {
        flushRaf = requestAnimationFrame(flushProgressBatch);
      }
    };

    const disposeProgress = subscribe<{ line: string }>("arbor://progress", (event) => {
      const ctx = ctxRef.current;
      try {
        const parsed = JSON.parse(event.payload.line) as WorkerEvent;
        const lastCourse = useUiStore.getState().lastCourse;
        const course =
          lastCourse && lastCourse.root === ctx.activeRoot ? lastCourse.course : null;
        const formatted = handleWorkerProgressSideEffects(ctx.queryClient, parsed, {
          root: ctx.activeRoot,
          course,
          providerLabel: providerDisplayLabel(ctx.providerId),
        });
        queueProgress(formatted.line, formatted.step);
      } catch {
        queueProgress(event.payload.line, null);
      }
    });

    return () => {
      if (flushRaf != null) {
        cancelAnimationFrame(flushRaf);
      }
      disposeProgress();
    };
  }, []);

  useEffect(() => {
    const disposeFinished = subscribe<JobFinished>("arbor://job-finished", (event) => {
      const ctx = ctxRef.current;
      const updateJobIdBefore = useJobStore.getState().activeUpdateJobId;
      ctx.finish(event.payload);
      const lastCourse = useUiStore.getState().lastCourse;
      const currentCourse =
        lastCourse && lastCourse.root === ctx.activeRoot ? lastCourse.course : null;
      void (async () => {
        jobStateRef.current = await onJobFinished(
          event.payload,
          {
            activeUpdateJobId: updateJobIdBefore,
            currentCourse,
            activeRoot: ctx.activeRoot,
            getKnowledgeSettings: (root) =>
              invoke("get_knowledge_settings", { root }),
            invalidateAfterJob: (root, course) =>
              invalidateAfterJobFinished(ctx.queryClient, root, course),
            startFlashcardsJob: async (force) => {
              if (!ctx.activeRoot || !currentCourse || !ctx.modelId) {
                return;
              }
              const jobId = await invoke<string>(
                "start_study_job",
                flashcardJobArgs(
                  ctx.activeRoot,
                  currentCourse,
                  force,
                  ctx.modelId,
                  ctx.providerId,
                ),
              );
              ctx.startJob(jobId);
            },
            startQuizJob: async (force) => {
              if (!ctx.activeRoot || !currentCourse || !ctx.modelId) {
                return;
              }
              const jobId = await invoke<string>(
                "start_study_job",
                quizJobArgs(
                  ctx.activeRoot,
                  currentCourse,
                  force,
                  ctx.modelId,
                  ctx.providerId,
                ),
              );
              ctx.startJob(jobId);
            },
            startEmbedJob: async (root) => {
              const jobId = await invoke<string>("start_embed_job", { root, force: false });
              ctx.startJob(jobId);
            },
          },
          jobStateRef.current,
        );
      })();
    });

    const disposeFiles = subscribe<{ root: string }>("arbor://files-changed", (event) => {
      const ctx = ctxRef.current;
      handleFilesChanged(ctx.queryClient, event.payload.root, ctx.activeRoot);
      void handleWatchTriggered(event.payload.root, ctx.activeRoot, {
        getKnowledgeSettings: (root) => invoke("get_knowledge_settings", { root }),
        planUpdate: (root) => invoke("plan_update", { root }),
        startUpdate: (root, input) => invoke<string>("start_update", { root, ...input }),
        checkAuth: (provider) => fetchAuthStatus(provider, true),
        setPendingPlan: (pending, open) =>
          useUpdatePlanStore.getState().setPendingPlan(pending, open),
        appendJobLine: (line) => useJobStore.getState().append(line),
        providerId: ctx.providerId,
        modelId: ctx.modelId,
      });
    });

    return () => {
      disposeFinished();
      disposeFiles();
    };
  }, [queryClient]);

  return null;
}
