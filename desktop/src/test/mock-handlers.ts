import type { InvokeArgs } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import {
  FIXTURE_ROOT_FALL,
  fixtureConceptGraph,
  fixtureCourseMd,
  fixtureCourseOverview,
  fixtureCourses,
  fixtureDigests,
  fixtureKnowledgeSettings,
  fixtureMarkdownSample,
  fixtureQuizProgress,
  fixtureQuizQuestions,
  fixtureSettings,
  fixtureStudyPlanMarkdown,
} from "~/test/fixtures/data";
import type { ChatLine } from "~/domain/chat";
import type { JobEventRow, JobSummary, SearchHit } from "~/domain/types";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";

const ipcLog: string[] = [];
const chatHistoryByKey = new Map<string, ChatLine[]>();
const ipcCalls: { cmd: string; args?: InvokeArgs }[] = [];
const updateJobTimers: ReturnType<typeof setTimeout>[] = [];
let mockEventsEnabled = true;

const mockKnowledgeSearchHits: SearchHit[] = [
  {
    course: "cell-biology",
    path: "cell-biology/digests/2026-09-12-membranes.md",
    kind: "digest",
    title: "Cell membranes",
    snippet: "Phospholipid bilayer and membrane proteins.",
    page_range: "3-5",
    source_path: null,
  },
  {
    course: "cell-biology",
    path: "cell-biology/course.md",
    kind: "course_md",
    title: "Cell Biology",
    snippet: "Course overview and syllabus topics.",
    page_range: null,
    source_path: null,
  },
  {
    course: "organic-chemistry-ii",
    path: "organic-chemistry-ii/digests/2026-10-01-alkanes.md",
    kind: "digest",
    title: "Alkanes",
    snippet: "Conformations and naming of alkanes.",
    page_range: null,
    source_path: null,
  },
  {
    course: "cell-biology",
    path: "cell-biology/study/plan.md",
    kind: "plan",
    title: "Study plan",
    snippet: "Weekly review schedule before the exam.",
    page_range: null,
    source_path: null,
  },
  {
    course: "cell-biology",
    path: "cell-biology/misc/notes.txt",
    kind: "other",
    title: "Misc notes",
    snippet: "Unlisted path opens overview with toast.",
    page_range: null,
    source_path: null,
  },
];

const mockSemanticSearchHits: SearchHit[] = [
  mockKnowledgeSearchHits[2]!,
  mockKnowledgeSearchHits[0]!,
  {
    course: "cell-biology",
    path: "cell-biology/digests/2026-09-12-membranes.md",
    kind: "digest",
    title: "Membrane transport",
    snippet: "Active transport and pumps in the bilayer.",
    page_range: "6-7",
    source_path: null,
  },
  mockKnowledgeSearchHits[3]!,
  mockKnowledgeSearchHits[1]!,
];

function mockSearchHits(cmd: string, payload: Record<string, unknown>): SearchHit[] {
  const query = String(payload.query ?? "").trim();
  if (!query || query.toLowerCase() === "zzz") {
    return [];
  }
  const needle = query.toLowerCase();
  const pool = cmd === "search_semantic" ? mockSemanticSearchHits : mockKnowledgeSearchHits;
  const matched = pool.filter(
    (hit) =>
      hit.title.toLowerCase().includes(needle) ||
      hit.snippet.toLowerCase().includes(needle) ||
      hit.path.toLowerCase().includes(needle) ||
      hit.course.toLowerCase().includes(needle),
  );
  const limit = Number(payload.limit ?? 20);
  return matched.slice(0, limit);
}

export function resetMockHandlerTimers() {
  mockEventsEnabled = false;
  for (const timer of updateJobTimers) {
    clearTimeout(timer);
  }
  updateJobTimers.length = 0;
  mockEventsEnabled = true;
}

export function getMockIpcLog(): string[] {
  return ipcLog;
}

export function getMockIpcCalls(): readonly { cmd: string; args?: InvokeArgs }[] {
  return ipcCalls;
}

export function clearMockIpcLog() {
  ipcLog.length = 0;
  ipcCalls.length = 0;
}

function mockChatHistoryKey(root: string, course: string): string {
  return `${root}\0${course}`;
}

export function resetMockChatHistoryForTests() {
  chatHistoryByKey.clear();
}

export function seedMockChatHistory(root: string, course: string, lines: ChatLine[]) {
  chatHistoryByKey.set(mockChatHistoryKey(root, course), lines.slice());
}

export function appendMockChatLines(payload: Record<string, unknown>) {
  const root = String(payload.root ?? FIXTURE_ROOT_FALL);
  const course = String(payload.course ?? "");
  const key = mockChatHistoryKey(root, course);
  const prev = chatHistoryByKey.get(key) ?? [];
  const lines = Array.isArray(payload.lines) ? (payload.lines as ChatLine[]) : [];
  chatHistoryByKey.set(key, [...prev, ...lines]);
  return null;
}

function scheduleMockEvent(delayMs: number, run: () => void) {
  const timer = window.setTimeout(() => {
    if (!mockEventsEnabled) {
      return;
    }
    run();
  }, delayMs);
  updateJobTimers.push(timer);
  return timer;
}

const mockJobSummaries: JobSummary[] = [
  {
    id: "mock-update-job",
    status: "running",
    trigger_kind: "manual",
    model_id: "grok-4.7",
    started_at: "2026-10-20T11:58:00Z",
    finished_at: null,
    error_summary: null,
    exit_code: null,
  },
  {
    id: "job-failed-1",
    status: "failed",
    trigger_kind: "manual",
    model_id: "grok-4.7",
    started_at: "2026-10-01T10:00:00Z",
    finished_at: "2026-10-01T10:05:00Z",
    error_summary: "Worker timeout",
    exit_code: 1,
  },
  {
    id: "job-ok-1",
    status: "succeeded",
    trigger_kind: "watch",
    model_id: "grok-4.7",
    started_at: "2026-10-02T10:00:00Z",
    finished_at: "2026-10-02T10:20:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-flashcards",
    status: "succeeded",
    trigger_kind: "flashcards",
    model_id: "grok-4.7",
    started_at: "2026-10-03T08:00:00Z",
    finished_at: "2026-10-03T08:12:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-quiz",
    status: "succeeded",
    trigger_kind: "quiz",
    model_id: "grok-4.7",
    started_at: "2026-10-04T09:00:00Z",
    finished_at: "2026-10-04T09:08:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-embed",
    status: "succeeded",
    trigger_kind: "embed",
    model_id: "grok-4.7",
    started_at: "2026-10-05T14:00:00Z",
    finished_at: "2026-10-05T14:30:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-citations",
    status: "succeeded",
    trigger_kind: "citations",
    model_id: "grok-4.7",
    started_at: "2026-10-06T16:00:00Z",
    finished_at: "2026-10-06T16:04:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-cancelled",
    status: "cancelled",
    trigger_kind: "manual",
    model_id: "grok-4.7",
    started_at: "2026-10-07T12:00:00Z",
    finished_at: "2026-10-07T12:01:00Z",
    error_summary: null,
    exit_code: null,
  },
];

function mockJobEventCount(jobId: string): number {
  let hash = 0;
  for (let i = 0; i < jobId.length; i += 1) {
    hash = (hash * 31 + jobId.charCodeAt(i)) >>> 0;
  }
  return 20 + (hash % 181);
}

function mockJobEvents(jobId: string): JobEventRow[] {
  const count = mockJobEventCount(jobId);
  const base = new Date("2026-10-20T10:00:00Z").getTime();
  return Array.from({ length: count }, (_, index) => ({
    line: `[${jobId}] line ${index + 1}: processing chunk ${index + 1}`,
    created_at: new Date(base + index * 1000).toISOString(),
  }));
}

function simulateUpdateJob(root: string) {
  const jobId = "mock-update-job";
  scheduleMockEvent(200, () => {
    if (!mockEventsEnabled) {
      return;
    }
    void emit("arbor://progress", {
      line: JSON.stringify({ type: "run_started", model_id: "grok-4.7" }),
    }).catch(() => undefined);
    void emit("arbor://progress", {
      line: JSON.stringify({
        type: "stage",
        stage: "digest",
        status: "running",
        detail: "page 1",
      }),
    }).catch(() => undefined);
    scheduleMockEvent(2800, () => {
      if (!mockEventsEnabled) {
        return;
      }
      void emit("arbor://progress", {
        line: JSON.stringify({ type: "run_done", processed: 1, failed: 0, skipped: 0 }),
      }).catch(() => undefined);
      void emit("arbor://job-finished", {
        job_id: jobId,
        status: "succeeded",
        summary: null,
        operation: "update",
        root,
      }).catch(() => undefined);
    });
  });
  return jobId;
}

export function createMockHandler(
  overrides: Partial<Record<string, (args?: InvokeArgs) => unknown>> = {},
) {
  return (cmd: string, args?: InvokeArgs): unknown => {
    const payload = (args ?? {}) as Record<string, unknown>;
    ipcLog.push(cmd);
    ipcCalls.push({ cmd, args });
    if (cmd in overrides && overrides[cmd]) {
      return overrides[cmd]!(args);
    }
    switch (cmd) {
      case "get_settings":
        return fixtureSettings;
      case "save_settings":
        return null;
      case "list_courses": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        return fixtureCourses[root] ?? [];
      }
      case "list_digests":
        if (payload.course === "cell-biology") {
          return fixtureDigests;
        }
        return [];
      case "read_markdown": {
        const path = String(payload.relativePath ?? "");
        if (path.endsWith("/course.md")) {
          return fixtureCourseMd;
        }
        if (path.endsWith("study/plan.md")) {
          return fixtureStudyPlanMarkdown;
        }
        if (path.includes("/digests/")) {
          return fixtureMarkdownSample;
        }
        throw new Error(`Missing fixture markdown for ${path}`);
      }
      case "study_progress":
        if (payload.action === "overview") {
          return fixtureCourseOverview;
        }
        return {};
      case "check_auth":
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                authenticated: true,
                reason: "",
                docs_url: "https://example.com/docs",
              }),
            300,
          );
        });
      case "list_models":
        return {
          models: [{ id: "grok-4.7", label: "Grok 4.7" }],
        };
      case "library_show":
        return { present: false };
      case "get_knowledge_settings":
        return fixtureKnowledgeSettings;
      case "save_knowledge_settings":
        return null;
      case "sync_show":
        return { remote: null, shared: false };
      case "list_jobs":
        return mockJobSummaries.slice();
      case "get_job_events":
        return mockJobEvents(String(payload.jobId ?? payload.job_id ?? ""));
      case "read_chat_history": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        return (chatHistoryByKey.get(mockChatHistoryKey(root, course)) ?? []).slice();
      }
      case "start_chat": {
        const channelId = parseMockChannelId(payload.onEvent);
        if (channelId == null) {
          return null;
        }
        const chatCourse = String(payload.course ?? "cell-biology");
        const markdown = "**Mock answer** from streaming.";
        const citations = [
          {
            digest_path: `${chatCourse}/digests/2026-09-12-membranes.md`,
            heading_id: "Membrane structure",
          },
        ];
        let index = 0;
        scheduleMockEvent(10, () => {
          emitToChannel(channelId, { type: "chat_retrieved" }, index++);
        });
        scheduleMockEvent(30, () => {
          emitToChannel(channelId, { type: "chat_delta", delta: "Hello " }, index++);
        });
        scheduleMockEvent(50, () => {
          emitToChannel(channelId, { type: "chat_delta", delta: "world" }, index++);
        });
        scheduleMockEvent(70, () => {
          emitToChannel(channelId, { type: "chat_delta", delta: "!" }, index++);
        });
        scheduleMockEvent(90, () => {
          emitToChannel(
            channelId,
            {
              type: "chat_done",
              markdown,
              supported: true,
              citations,
            },
            index++,
          );
        });
        scheduleMockEvent(110, () => {
          emitToChannel(channelId, { type: "worker_exit", code: 0 }, index++);
        });
        return null;
      }
      case "read_study_json":
        if (payload.file === "flashcards.json") {
          return {
            schema_version: 1,
            course: String(payload.course),
            cards: Array.from({ length: 86 }, (_, i) => ({
              id: `fc-${i + 1}`,
              front: `Card ${i + 1}`,
              back: "Answer",
              tags: [],
              source: { digest: "2026-09-12-membranes", heading: null },
            })),
          };
        }
        if (payload.file === "quiz.json") {
          return {
            schema_version: 1,
            course: String(payload.course),
            questions: fixtureQuizQuestions,
          };
        }
        if (payload.file === "concepts.json") {
          return fixtureConceptGraph;
        }
        if (payload.file === "citations.json") {
          return {
            schema_version: 1,
            course: String(payload.course),
            failures: [],
          };
        }
        return { schema_version: 1, course: String(payload.course ?? ""), nodes: [], edges: [] };
      case "read_quiz_progress":
        return fixtureQuizProgress;
      case "study_artifact_stale":
        return false;
      case "skill_index":
        return { packages: [] };
      case "provider_secret_status":
        return "ready";
      case "search_knowledge":
      case "search_semantic":
        return mockSearchHits(cmd, payload);
      case "join_library":
        return { ok: true };
      case "start_study_job":
        return "mock-study-job";
      case "import_sources": {
        const paths = payload.paths;
        if (Array.isArray(paths)) {
          return paths.map(String);
        }
        return [];
      }
      case "create_course": {
        const name = String(payload.name ?? "new-class");
        return name.trim().toLowerCase().replace(/\s+/g, "-");
      }
      case "init_knowledge_repo":
        return true;
      case "init_arbor_db":
      case "start_folder_watch":
      case "append_card":
        return { id: "fc-appended-1" };
      case "study_plan":
        return null;
      case "append_chat_lines":
        return appendMockChatLines(payload);
      case "clear_chat_history": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        chatHistoryByKey.delete(mockChatHistoryKey(root, course));
        return null;
      }
      case "cancel_update":
      case "plan_update":
        return { pending: [] };
      case "start_update":
        return simulateUpdateJob(String(payload.root ?? FIXTURE_ROOT_FALL));
      case "start_embed_job":
        return "mock-embed-job";
      default:
        return null;
    }
  };
}
