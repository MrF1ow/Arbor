export type StudyWrite = {
  key: string;
  root: string;
  course: string;
  args: Record<string, unknown>;
};

export const PENDING_STUDY_WRITES_KEY = "arbor.pendingStudyWrites";

const DEFAULT_DELAYS = [1000, 5000, 30000];
const FAILING_AFTER_MS = 5000;

export function studyWriteFailingStatus(
  pending: number,
  headFailSince: number | null,
  now: number,
): boolean {
  return (
    pending > 0 &&
    headFailSince !== null &&
    now - headFailSince >= FAILING_AFTER_MS
  );
}

export function createStudyWriteQueue(deps: {
  send: (w: StudyWrite) => Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem">;
  onStatus: (s: { pending: number; failing: boolean }) => void;
  onSent?: (w: StudyWrite) => void;
  delays?: number[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}): {
  enqueue(w: StudyWrite): void;
  flush(timeoutMs?: number): Promise<void>;
  restore(): void;
  pending(): number;
} {
  const delays = deps.delays ?? DEFAULT_DELAYS;
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));

  let queue: StudyWrite[] = [];
  let draining = false;
  let headFailSince: number | null = null;
  const flushWaiters: Array<() => void> = [];

  function persist() {
    deps.storage.setItem(PENDING_STUDY_WRITES_KEY, JSON.stringify(queue));
  }

  function emitStatus() {
    const pending = queue.length;
    const failing = studyWriteFailingStatus(pending, headFailSince, now());
    deps.onStatus({ pending, failing });
  }

  function notifyFlushWaiters() {
    if (queue.length === 0 && !draining) {
      for (const wake of flushWaiters.splice(0)) {
        wake();
      }
    }
  }

  function delayForAttempt(attempt: number): number {
    const index = Math.min(attempt, delays.length - 1);
    return delays[index] ?? 30000;
  }

  function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimer(() => resolve(), ms);
    });
  }

  async function drain(): Promise<void> {
    if (draining) {
      return;
    }
    draining = true;
    try {
      while (queue.length > 0) {
        const head = queue[0];
        let attempt = 0;
        let sent = false;
        while (!sent) {
          try {
            await deps.send(head);
            sent = true;
            headFailSince = null;
            queue.shift();
            persist();
            emitStatus();
            deps.onSent?.(head);
            notifyFlushWaiters();
          } catch {
            if (headFailSince === null) {
              headFailSince = now();
            }
            emitStatus();
            const backoff = delayForAttempt(attempt);
            attempt += 1;
            await waitMs(backoff);
          }
        }
      }
    } finally {
      draining = false;
      notifyFlushWaiters();
    }
  }

  return {
    enqueue(w: StudyWrite) {
      queue.push(w);
      persist();
      emitStatus();
      void drain();
    },
    flush(timeoutMs = 3000) {
      return new Promise<void>((resolve) => {
        const finish = () => {
          const idx = flushWaiters.indexOf(wake);
          if (idx >= 0) {
            flushWaiters.splice(idx, 1);
          }
          resolve();
        };
        const wake = () => finish();
        if (queue.length === 0 && !draining) {
          resolve();
          return;
        }
        flushWaiters.push(wake);
        void drain();
        if (timeoutMs > 0) {
          setTimer(finish, timeoutMs);
        }
      });
    },
    restore() {
      const raw = deps.storage.getItem(PENDING_STUDY_WRITES_KEY);
      if (!raw) {
        queue = [];
        emitStatus();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as StudyWrite[];
        if (Array.isArray(parsed)) {
          queue = parsed.filter(
            (item) =>
              item &&
              typeof item.key === "string" &&
              typeof item.root === "string" &&
              typeof item.course === "string" &&
              item.args &&
              typeof item.args === "object",
          );
        }
      } catch {
        queue = [];
      }
      persist();
      emitStatus();
      if (queue.length > 0) {
        void drain();
      }
    },
    pending() {
      return queue.length;
    },
  };
}
