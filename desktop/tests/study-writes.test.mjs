import assert from "node:assert/strict";
import test from "node:test";

import {
  PENDING_STUDY_WRITES_KEY,
  createStudyWriteQueue,
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

  queue.enqueue({ key: "a", root: "/r", course: "Bio", args: {} });
  queue.enqueue({ key: "b", root: "/r", course: "Bio", args: {} });
  queue.enqueue({ key: "c", root: "/r", course: "Bio", args: {} });
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

  queue.enqueue({ key: "one", root: "/r", course: "Bio", args: { action: "grade" } });
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
  queue.enqueue({ key: "x", root: "/r", course: "Bio", args: {} });
  await queue.flush(1000);
  assert.equal(queue.pending(), 0);
});
