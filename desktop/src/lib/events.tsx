import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { formatWorkerEvent } from "~/domain/worker-events";
import type { JobFinished, WorkerEvent } from "~/domain/types";
import { invoke, listen } from "~/lib/ipc";
import { onJobFinished } from "~/lib/job-finished";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { useJobStore } from "~/stores/job-store";

let suppressWatchUntil = 0;

export function suppressWatch(ms: number) {
  suppressWatchUntil = Date.now() + ms;
}

export function getSuppressWatchUntilForTests() {
  return suppressWatchUntil;
}

function invalidateCourseStudyKeys(
  queryClient: ReturnType<typeof useQueryClient>,
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
}

export function invalidateAfterJobFinished(
  queryClient: ReturnType<typeof useQueryClient>,
  root: string,
  course: string | null,
) {
  void queryClient.invalidateQueries({ queryKey: qk.jobs(root) });
  if (course) {
    invalidateCourseStudyKeys(queryClient, root, course);
  }
}

export function handleFilesChanged(
  queryClient: ReturnType<typeof useQueryClient>,
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
}

export function WorkerEventsBridge() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const activeRoot = settings.data?.active_root ?? settings.data?.knowledge_root ?? null;
  const append = useJobStore((s) => s.append);
  const finish = useJobStore((s) => s.finish);
  const setStep = useJobStore((s) => s.setStep);
  const jobStateRef = useRef({ pendingAutoEmbed: false, pendingAutoQuiz: false });
  const [, bump] = useState(0);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;
    let unlistenFiles: (() => void) | undefined;

    void listen<{ line: string }>("arbor://progress", (event) => {
      try {
        const parsed = JSON.parse(event.payload.line) as WorkerEvent;
        const formatted = formatWorkerEvent(parsed);
        append(formatted.line);
        setStep(formatted.step);
      } catch {
        append(event.payload.line);
      }
    }).then((fn) => {
      unlistenProgress = fn;
    });

    void listen<JobFinished>("arbor://job-finished", (event) => {
      finish(event.payload);
      void (async () => {
        jobStateRef.current = await onJobFinished(
          event.payload,
          {
            activeUpdateJobId: useJobStore.getState().activeUpdateJobId,
            currentCourse: null,
            activeRoot,
            getKnowledgeSettings: (root) =>
              invoke("get_knowledge_settings", { root }),
            invalidateAfterJob: (root, course) =>
              invalidateAfterJobFinished(queryClient, root, course),
            startFlashcardsJob: async () => {
              bump((n) => n + 1);
            },
            startQuizJob: async () => {
              bump((n) => n + 1);
            },
            startEmbedJob: async (root) => {
              await invoke("start_embed_job", { root, force: false });
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
    }).then((fn) => {
      unlistenFiles = fn;
    });

    return () => {
      unlistenProgress?.();
      unlistenFinished?.();
      unlistenFiles?.();
    };
  }, [activeRoot, append, finish, queryClient, setStep]);

  return null;
}
