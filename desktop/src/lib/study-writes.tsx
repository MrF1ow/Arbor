import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect } from "react";
import { toast } from "sonner";

import { createStudyWriteQueue, type StudyWrite } from "~/domain/study-writes";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";
import { useStudyWritesStore } from "~/stores/study-writes-store";

type StudyWriteQueue = ReturnType<typeof createStudyWriteQueue>;

const StudyWritesContext = createContext<StudyWriteQueue | null>(null);

let moduleStudyWriteQueue: StudyWriteQueue | null = null;
let moduleQueueClient: QueryClient | null = null;
let moduleQueueRestored = false;

function studyWriteStatusLabel(pending: number, failing: boolean): string | null {
  if (!failing || pending === 0) {
    return null;
  }
  return pending === 1 ? "1 unsaved · Retry" : `${pending} unsaved · Retry`;
}

function ensureStudyWriteQueue(
  queryClient: QueryClient,
  setStatus: (status: { pending: number; failing: boolean }) => void,
): StudyWriteQueue {
  if (moduleStudyWriteQueue && moduleQueueClient === queryClient) {
    return moduleStudyWriteQueue;
  }
  moduleQueueClient = queryClient;
  moduleStudyWriteQueue = createStudyWriteQueue({
    send: async (w: StudyWrite) => {
      await invoke("study_progress", w.args);
    },
    storage: window.localStorage,
    onStatus: setStatus,
    onSent: (w) => {
      void queryClient.invalidateQueries({
        queryKey: qk.courseOverview(w.root, w.course),
      });
      const action = w.args.action;
      if (action === "quiz") {
        void queryClient.invalidateQueries({
          queryKey: qk.quizProgress(w.root, w.course),
        });
      }
    },
    onDropped: (_w, error) => {
      const reason = String(error instanceof Error ? error.message : error);
      toast.error(`A grade couldn't be saved: ${reason}`);
    },
  });
  return moduleStudyWriteQueue;
}

export function resetStudyWriteQueueForTests() {
  moduleStudyWriteQueue = null;
  moduleQueueClient = null;
  moduleQueueRestored = false;
}

export async function flushStudyWritesForRootSwitch(timeoutMs = 3000): Promise<void> {
  await flushStudyWrites(timeoutMs);
}

export async function flushStudyWrites(timeoutMs = 3000): Promise<void> {
  if (!moduleStudyWriteQueue) {
    return;
  }
  await moduleStudyWriteQueue.flush(timeoutMs);
}

export function StudyWritesProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const setStatus = useStudyWritesStore((s) => s.setStatus);
  const queue = ensureStudyWriteQueue(queryClient, setStatus);

  useEffect(() => {
    if (moduleQueueRestored) {
      return;
    }
    moduleQueueRestored = true;
    queue.restore();
  }, [queue]);

  return (
    <StudyWritesContext.Provider value={queue}>{children}</StudyWritesContext.Provider>
  );
}

function useStudyWriteQueue() {
  const queue = useContext(StudyWritesContext);
  if (!queue) {
    throw new Error("useStudyWriteQueue requires StudyWritesProvider");
  }
  return queue;
}

export function useEnqueueStudyWrite() {
  const queue = useStudyWriteQueue();
  return (write: Omit<StudyWrite, "writeId">) => {
    const writeId = crypto.randomUUID();
    queue.enqueue({
      ...write,
      writeId,
      args: { ...write.args, writeId },
    });
  };
}

export function useStudyWriteStatus() {
  const pending = useStudyWritesStore((s) => s.pending);
  const failing = useStudyWritesStore((s) => s.failing);
  const queue = useStudyWriteQueue();
  const label = studyWriteStatusLabel(pending, failing);
  return {
    pending,
    failing,
    label,
    retry: () => {
      void queue.flush(3000);
    },
  };
}

export { studyWriteStatusLabel };
