import assert from "node:assert/strict";
import test from "node:test";

import {
  PENDING_STUDY_WRITES_KEY,
  createStudyWriteQueue,
  isTransientStudyWriteError,
  studyWriteFailingStatus,
} from "../src/study-writes.ts";

function memoryStorage() {
  let value = null;
  return {
    getItem(key) {
      return key === PENDING_STUDY_WRITES_KEY ? value : null;
    },
    setItem(key, next) {
      if (key === PENDING_STUDY_WRITES_KEY) {
        value = next;
      }
    },
    raw() {
      return value;
    },
  };
}

function sampleWrite(key, course = "Bio") {
  return {
    key,
    writeId: `id-${key}`,
    root: "/r",
    course,
    args: { action: "grade", write_id: `id-${key}` },
  };
}

test("study write queue sends in order with retry backoff", async () => {
  const sent = [];
  let failB = true;
  const queue = createStudyWriteQueue({
    send: async (w) => {
      if (w.key === "b" && failB) {
        failB = false;
        throw new Error("fail once");
      }
      sent.push(w.key);
    },
    storage: memoryStorage(),
    onStatus: () => {},
    delays: [5, 5, 5],
  });

  queue.enqueue(sampleWrite("a"));
  queue.enqueue(sampleWrite("b"));
  queue.enqueue(sampleWrite("c"));
  await queue.flush(5000);

  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("study write queue persists and restores pending writes", async () => {
  const storage = memoryStorage();
  const queue = createStudyWriteQueue({
    send: async () => {},
    storage,
    onStatus: () => {},
  });

  queue.enqueue(sampleWrite("one"));
  assert.equal(JSON.parse(storage.getItem(PENDING_STUDY_WRITES_KEY)).length, 1);

  const restored = createStudyWriteQueue({
    send: async () => {},
    storage,
    onStatus: () => {},
  });
  restored.restore();
  assert.equal(restored.pending(), 1);
  await restored.flush(1000);
  assert.equal(restored.pending(), 0);
});

test("studyWriteFailingStatus turns true after 5s with injected clock", () => {
  assert.equal(studyWriteFailingStatus(1, 1000, 5999), false);
  assert.equal(studyWriteFailingStatus(1, 1000, 6000), true);
  assert.equal(studyWriteFailingStatus(0, 1000, 6000), false);
});

test("flush resolves when the queue drains", async () => {
  const queue = createStudyWriteQueue({
    send: async () => {},
    storage: memoryStorage(),
    onStatus: () => {},
  });
  queue.enqueue(sampleWrite("x"));
  await queue.flush(1000);
  assert.equal(queue.pending(), 0);
});

test("poison head dropped after 5 attempts while another course succeeds", async () => {
  const sent = [];
  const dropped = [];
  const queue = createStudyWriteQueue({
    send: async (w) => {
      if (w.course === "Bad") {
        throw new Error("permanent validation failure");
      }
      sent.push(w.course);
    },
    storage: memoryStorage(),
    onStatus: () => {},
    onDropped: (w, error) => dropped.push({ key: w.key, error: String(error) }),
    delays: [1, 1, 1],
  });

  queue.enqueue(sampleWrite("bad", "Bad"));
  queue.enqueue(sampleWrite("good", "Good"));
  await queue.flush(8000);

  assert.equal(dropped.length, 1);
  assert.deepEqual(sent, ["Good"]);
  assert.equal(queue.pending(), 0);
});

test("transient errors are never dropped", async () => {
  let attempts = 0;
  const queue = createStudyWriteQueue({
    send: async () => {
      attempts += 1;
      if (attempts < 8) {
        throw new Error("worker server exited");
      }
    },
    storage: memoryStorage(),
    onStatus: () => {},
    delays: [1, 1, 1],
  });

  queue.enqueue(sampleWrite("retry"));
  await queue.flush(5000);
  assert.equal(attempts, 8);
  assert.equal(queue.pending(), 0);
});

test("drop shortens persisted queue", async () => {
  const storage = memoryStorage();
  const queue = createStudyWriteQueue({
    send: async (w) => {
      if (w.course === "Bad") {
        throw new Error("bad request");
      }
    },
    storage,
    onStatus: () => {},
    delays: [1, 1, 1],
  });
  queue.enqueue(sampleWrite("bad", "Bad"));
  await queue.flush(8000);
  assert.equal(JSON.parse(storage.raw()).length, 0);
});

test("flush clears backoff and sends immediately", async () => {
  const timers = new Map();
  let nextId = 1;
  const sent = [];
  let failOnce = true;
  const queue = createStudyWriteQueue({
    send: async (w) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("worker timed out");
      }
      sent.push(w.key);
    },
    storage: memoryStorage(),
    onStatus: () => {},
    delays: [5000, 5000],
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  });

  queue.enqueue(sampleWrite("fast"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 0);
  assert.equal(timers.size, 1);
  await queue.flush(1000);
  assert.deepEqual(sent, ["fast"]);
});

test("isTransientStudyWriteError classifies worker failures", () => {
  assert.equal(isTransientStudyWriteError(new Error("worker timed out after 30s")), true);
  assert.equal(isTransientStudyWriteError(new Error("invalid card id")), false);
});
