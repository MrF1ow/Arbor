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
} from "../src/domain/chat.ts";

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
  assert.equal(unsupportedBanner(undefined), "Not supported by this course");
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
  assert.match(html, /&lt;script/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /onerror/);
});

test("sendChatMessage resets chatInFlight when pending append fails on worker_exit", async () => {
  const source = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function sendChatMessage");
  const end = source.indexOf("\nasync function refreshFolderTools", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const exitIndex = body.indexOf('type === "worker_exit"');
  assert.ok(exitIndex >= 0, "worker_exit handler must exist in sendChatMessage");
  const handler = body.slice(exitIndex, exitIndex + 600);
  assert.match(handler, /pendingAppend[\s\S]*\.catch\(/);
  assert.match(handler, /pendingAppend[\s\S]*\.finally\(/);
  assert.match(handler, /chatInFlight = false/);
  assert.match(handler, /logLine\(`Could not append chat lines:/);
});

test("clear history confirms before deleting chat jsonl", async () => {
  const source = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  const start = source.indexOf('chatClearBtn.addEventListener("click"');
  assert.ok(start >= 0, "chat clear handler must exist");
  const end = source.indexOf("generateStudyArtifactBtn.addEventListener", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const confirmIndex = body.indexOf("await confirm(");
  const clearIndex = body.indexOf("clear_chat_history");
  assert.ok(confirmIndex >= 0, "clear history must call confirm");
  assert.ok(clearIndex > confirmIndex, "confirm must run before clear_chat_history");
  assert.match(body, /if \(!ok\) return/);
});

test("sendChatMessage snapshots worker history before appending the user line", async () => {
  const source = await readFile(new URL("../src/legacy/main.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function sendChatMessage");
  const end = source.indexOf("\nasync function refreshFolderTools", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const historyIndex = body.indexOf("workerHistory(chatLines)");
  const userAppendIndex = body.indexOf("appendChatLines", historyIndex);
  assert.ok(historyIndex >= 0, "workerHistory(chatLines) must exist in sendChatMessage");
  assert.ok(userAppendIndex > historyIndex, "appendChatLines must follow history snapshot");
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

test("chat Ask mode button is active by default in HTML", async () => {
  const html = await readFile(new URL("../legacy.html", import.meta.url), "utf8");
  const askMatch = html.match(/<button[^>]*id="chat-mode-ask"[^>]*>/);
  assert.ok(askMatch, "chat-mode-ask must exist");
  assert.match(askMatch[0], /\bactive\b/, "Ask button must include active class");
});

test("chat answers use UI font, not read serif", async () => {
  const css = await readFile(new URL("../src/legacy/styles.css", import.meta.url), "utf8");
  const blockMatch = css.match(
    /\.chat-turn\.chat-assistant \.chat-answer\s*\{[^}]+\}/,
  );
  assert.ok(blockMatch, "chat-answer rule must exist");
  assert.match(blockMatch[0], /var\(--font-ui\)/);
  assert.doesNotMatch(blockMatch[0], /var\(--font-read\)/);
});

test("chat tab and panel ids exist after graph tab", async () => {
  const html = await readFile(new URL("../legacy.html", import.meta.url), "utf8");
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
