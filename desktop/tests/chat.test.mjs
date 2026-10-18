import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSessionLine,
  buildUserLine,
  chatNotePath,
  citationLabel,
  phaseLabel,
  renderAnswerHtml,
  unsupportedBanner,
  visibleTranscript,
  workerHistory,
} from "../src/chat.ts";

test("visibleTranscript drops lines before the last session boundary", () => {
  const lines = [
    buildUserLine("ask", "old"),
    buildSessionLine(),
    buildUserLine("ask", "new"),
  ];
  const visible = visibleTranscript(lines);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].content, "new");
});

test("workerHistory maps visible user and assistant lines oldest first", () => {
  const lines = [
    { role: "user", mode: "ask", content: "one", ts: "t1" },
    { role: "assistant", mode: "ask", content: "two", supported: true, citations: [] },
    buildSessionLine(),
    { role: "user", mode: "ask", content: "three", ts: "t2" },
  ];
  assert.deepEqual(workerHistory(lines), [
    { role: "user", content: "three" },
  ]);
});

test("chatNotePath opens course overview and digests without double prefix", () => {
  assert.equal(chatNotePath("Biology", "Biology/course.md"), "Biology/course.md");
  assert.equal(
    chatNotePath("Biology", "Biology/digests/lecture.md"),
    "Biology/digests/lecture.md",
  );
});

test("citationLabel formats digest basename heading and page range", () => {
  const label = citationLabel({
    digest_path: "Biology/digests/lecture.md",
    heading_id: "glycolysis",
    page_range: "1-4",
  });
  assert.equal(label, "lecture.md · glycolysis · p. 1-4");
});

test("unsupported banner string is exact", () => {
  assert.equal(unsupportedBanner(false), "Not supported by this course");
  assert.equal(unsupportedBanner(true), null);
});

test("phase labels for retrieve and answer phases", () => {
  assert.equal(phaseLabel("chat_retrieved"), "Answering");
  assert.equal(phaseLabel("chat_done"), "Done");
  assert.equal(phaseLabel("chat_delta"), null);
});

test("renderAnswerHtml escapes script and onerror payloads", () => {
  const html = renderAnswerHtml(
    '<script>alert(1)</script>\n<img src=x onerror=alert(1)>',
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
});

test("CSP string in tauri.conf.json is unchanged", async () => {
  const conf = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  assert.equal(
    conf.app.security.csp,
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
});

test("chat tab and panel ids exist after graph tab", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const graphIndex = html.indexOf('data-mode="graph"');
  const chatIndex = html.indexOf('data-mode="chat"');
  assert.ok(graphIndex >= 0 && chatIndex > graphIndex, "Chat tab must follow Graph");
  for (const id of [
    "chat-course",
    "chat-root",
    "chat-mode-ask",
    "chat-mode-explain",
    "chat-mode-quiz",
    "chat-new",
    "chat-clear",
    "chat-log",
    "chat-status",
    "chat-input",
    "chat-send",
    "chat-artifact",
    "generate-study-artifact",
    "panel-chat",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});
