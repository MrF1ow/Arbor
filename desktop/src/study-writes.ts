export type StudyWrite = {
  key: string;
  writeId: string;
  root: string;
  course: string;
  args: Record<string, unknown>;
};

export const PENDING_STUDY_WRITES_KEY = "arbor.pendingStudyWrites";

const DEFAULT_DELAYS = [1000, 5000, 30000];
const FAILING_AFTER_MS = 5000;
const MAX_NON_TRANSIENT_ATTEMPTS = 5;

export function studyWriteLaneKey(w: Pick<StudyWrite, "root" | "course">): string {
  return `${w.root}|${w.course}`;
}

export function isTransientStudyWriteError(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : error).toLowerCase();
  if (msg.includes("timed out")) return true;
  if (msg.includes("worker server")) return true;
  if (msg.includes("failed to launch")) return true;
  if (msg.includes("worker exited")) return true;
  if (msg.includes("pool shut down")) return true;
  if (msg.includes("network")) return true;
  if (msg.includes("econnrefused")) return true;
  if (msg.includes("econnreset")) return true;
  if (msg.includes("enotfound")) return true;
  if (msg.includes("connection refused")) return true;
  if (msg.includes("connection reset")) return true;
  if (msg.includes("broken pipe")) return true;
  if (msg.includes("i/o error")) return true;
  if (msg.includes("io error")) return true;
  return false;
}

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
  onDropped?: (w: StudyWrite, error: unknown) => void;
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
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));

  function loadStored(): StudyWrite[] {
    const raw = deps.storage.getItem(PENDING_STUDY_WRITES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as StudyWrite[];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item.key === "string" &&
            typeof item.root === "string" &&
            typeof item.course === "string" &&
            item.args &&
            typeof item.args === "object",
        )
        .map((item) => {
          const writeId =
            typeof item.writeId === "string" && item.writeId
              ? item.writeId
              : globalThis.crypto.randomUUID();
          // Tauri maps camelCase invoke keys to the snake_case Rust parameter.
          return { ...item, writeId, args: { ...item.args, writeId } };
        });
    } catch {
      return [];
    }
  }

  // Load persisted writes now, so an enqueue before restore() can't
  // overwrite them in storage. restore() starts sending them.
  let queue: StudyWrite[] = loadStored();
  const drainingLanes = new Set<string>();
  const laneFailSince = new Map<string, number>();
  const laneWait = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; cancel: () => void }
  >();
  const flushWaiters: Array<() => void> = [];

  function persist() {
    deps.storage.setItem(PENDING_STUDY_WRITES_KEY, JSON.stringify(queue));
  }

  function earliestLaneFailSince(): number | null {
    let earliest: number | null = null;
    for (const lane of activeLanes()) {
      const head = headForLane(lane);
      if (!head) continue;
      const since = laneFailSince.get(lane);
      if (since === undefined) continue;
      if (earliest === null || since < earliest) {
        earliest = since;
      }
    }
    return earliest;
  }

  function activeLanes(): Set<string> {
    const lanes = new Set<string>();
    for (const item of queue) {
      lanes.add(studyWriteLaneKey(item));
    }
    return lanes;
  }

  function emitStatus() {
    const pending = queue.length;
    const failing = studyWriteFailingStatus(
      pending,
      earliestLaneFailSince(),
      now(),
    );
    deps.onStatus({ pending, failing });
  }

  function notifyFlushWaiters() {
    if (queue.length === 0 && drainingLanes.size === 0) {
      for (const wake of flushWaiters.splice(0)) {
        wake();
      }
    }
  }

  function delayForAttempt(attempt: number): number {
    const index = Math.min(attempt, delays.length - 1);
    return delays[index] ?? 30000;
  }

  function clearLaneWait(lane: string) {
    const pending = laneWait.get(lane);
    if (pending) {
      clearTimer(pending.timer);
      pending.cancel();
      laneWait.delete(lane);
    }
  }

  function waitMs(lane: string, ms: number): Promise<void> {
    clearLaneWait(lane);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        laneWait.delete(lane);
        resolve();
      };
      const timer = setTimer(finish, ms);
      laneWait.set(lane, { timer, cancel: finish });
    });
  }

  function headForLane(lane: string): StudyWrite | undefined {
    return queue.find((item) => studyWriteLaneKey(item) === lane);
  }

  function removeWrite(target: StudyWrite) {
    const index = queue.indexOf(target);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  }

  function dropHead(lane: string, head: StudyWrite, error: unknown) {
    removeWrite(head);
    laneFailSince.delete(lane);
    persist();
    emitStatus();
    deps.onDropped?.(head, error);
    notifyFlushWaiters();
  }

  async function drainLane(lane: string): Promise<void> {
    if (drainingLanes.has(lane)) {
      return;
    }
    drainingLanes.add(lane);
    try {
      while (true) {
        const head = headForLane(lane);
        if (!head) {
          laneFailSince.delete(lane);
          break;
        }
        let attempt = 0;
        let sent = false;
        while (!sent) {
          try {
            await deps.send(head);
            sent = true;
            laneFailSince.delete(lane);
            removeWrite(head);
            persist();
            emitStatus();
            deps.onSent?.(head);
            notifyFlushWaiters();
          } catch (error) {
            if (laneFailSince.get(lane) === undefined) {
              laneFailSince.set(lane, now());
            }
            emitStatus();
            const transient = isTransientStudyWriteError(error);
            attempt += 1;
            if (!transient && attempt >= MAX_NON_TRANSIENT_ATTEMPTS) {
              dropHead(lane, head, error);
              sent = true;
              break;
            }
            const backoff = delayForAttempt(attempt - 1);
            await waitMs(lane, backoff);
          }
        }
      }
    } finally {
      drainingLanes.delete(lane);
      clearLaneWait(lane);
      emitStatus();
      notifyFlushWaiters();
    }
  }

  function startDrainAll() {
    for (const lane of activeLanes()) {
      void drainLane(lane);
    }
  }

  function flushAllLanesNow() {
    for (const lane of activeLanes()) {
      clearLaneWait(lane);
    }
    startDrainAll();
  }

  return {
    enqueue(w: StudyWrite) {
      queue.push(w);
      persist();
      emitStatus();
      startDrainAll();
    },
    flush(timeoutMs = 3000) {
      flushAllLanesNow();
      return new Promise<void>((resolve) => {
        const finish = () => {
          const idx = flushWaiters.indexOf(wake);
          if (idx >= 0) {
            flushWaiters.splice(idx, 1);
          }
          resolve();
        };
        const wake = () => finish();
        if (queue.length === 0 && drainingLanes.size === 0) {
          resolve();
          return;
        }
        flushWaiters.push(wake);
        startDrainAll();
        if (timeoutMs > 0) {
          setTimer(finish, timeoutMs);
        }
      });
    },
    restore() {
      // Pick up anything another session persisted since construction.
      const known = new Set(queue.map((item) => item.writeId));
      const extra = loadStored().filter((item) => !known.has(item.writeId));
      queue = [...extra, ...queue];
      persist();
      emitStatus();
      if (queue.length > 0) {
        startDrainAll();
      }
    },
    pending() {
      return queue.length;
    },
  };
}
