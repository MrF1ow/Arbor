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
import type { CourseMetaMap } from "~/domain/course-icons";
import type { ChatLine } from "~/domain/chat";
import { titleFromUserMessage } from "~/domain/chat";
import type { ChatMode } from "~/domain/chat";
import type { ChatThreadMeta } from "~/lib/queries/chat";
import type {
  JobEventRow,
  JobSummary,
  LibraryShowResult,
  SearchHit,
  SyncConflictSession,
  SyncShowResult,
} from "~/domain/types";
import {
  fixtureLibraryShowOwner,
  fixtureSkillPackages,
  fixtureSyncConflictSession,
} from "~/test/fixtures/settings-sharing";
import { emitToChannel, parseMockChannelId } from "~/test/emit-to-channel";

let mockSettingsState = structuredClone(fixtureSettings);
let mockCourseMetaState: CourseMetaMap = {
  "cell-biology": { icon: "microscope", color: "olive" },
  "organic-chemistry-ii": { icon: "flask-conical", color: "clay" },
};
let mockKnowledgeSettingsState = structuredClone(fixtureKnowledgeSettings);
const mockProviderSecretReady = new Set<string>(["openai_api", "anthropic_api"]);
let mockLibraryShowState: LibraryShowResult = { present: false };
let mockSyncShowState: SyncShowResult = { remote: null, shared: false, remote_note: null };
let mockSyncConflictState: SyncConflictSession = structuredClone(fixtureSyncConflictSession);
let mockSkillPackagesState = structuredClone(fixtureSkillPackages);
const mockInstalledSkillIds = new Set<string>(["installed-skill"]);
let mockSyncNowResult: {
  ok: boolean;
  action: string;
  head_changed?: boolean;
  files?: string[];
} = { ok: true, action: "integrated", head_changed: false };

const ipcLog: string[] = [];
type MockThreadBucket = {
  threads: ChatThreadMeta[];
  linesByThread: Map<string, ChatLine[]>;
};

const mockThreadsByKey = new Map<string, MockThreadBucket>();
const mockThreadsSeedDisabled = new Set<string>();
let mockThreadCounter = 0;
const ipcCalls: { cmd: string; args?: InvokeArgs }[] = [];
const updateJobTimers: ReturnType<typeof setTimeout>[] = [];
let mockEventsEnabled = true;
let mockUpdateJobRunning = false;

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
  mockUpdateJobRunning = false;
  mockEventsEnabled = true;
  resetMockSettingsForTests();
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

export function resetMockSettingsForTests() {
  mockSettingsState = structuredClone(fixtureSettings);
  mockKnowledgeSettingsState = structuredClone(fixtureKnowledgeSettings);
  mockProviderSecretReady.clear();
  mockProviderSecretReady.add("openai_api");
  mockProviderSecretReady.add("anthropic_api");
  mockLibraryShowState = { present: false };
  mockCourseMetaState = {
    "cell-biology": { icon: "microscope", color: "olive" },
    "organic-chemistry-ii": { icon: "flask-conical", color: "clay" },
  };
  mockSyncShowState = { remote: null, shared: false, remote_note: null };
  mockSyncConflictState = structuredClone(fixtureSyncConflictSession);
  mockSkillPackagesState = structuredClone(fixtureSkillPackages);
  mockInstalledSkillIds.clear();
  mockInstalledSkillIds.add("installed-skill");
  mockSyncNowResult = { ok: true, action: "integrated", head_changed: false };
}

export function seedMockLibraryShow(state: LibraryShowResult) {
  mockLibraryShowState = structuredClone(state);
}

export function seedMockSyncShow(state: SyncShowResult) {
  mockSyncShowState = structuredClone(state);
}

export function seedMockSyncConflict(session: SyncConflictSession) {
  mockSyncConflictState = structuredClone(session);
}

export function seedMockSyncNowResult(result: typeof mockSyncNowResult) {
  mockSyncNowResult = structuredClone(result);
}

function mockThreadsKey(root: string, course: string): string {
  return `${root}\0${course}`;
}

const CHAT_THREAD_ID_RE = /^t-\d{8}T\d{6}Z-[0-9a-f]{6}$/;

function assertMockThreadId(thread: string) {
  if (!CHAT_THREAD_ID_RE.test(thread)) {
    throw new Error("Invalid thread id");
  }
}

function assertMockChatMode(mode: string) {
  if (mode !== "ask" && mode !== "explain") {
    throw new Error(`Invalid chat mode: ${mode}`);
  }
}

function assertMockChatLineRoles(lines: ChatLine[]) {
  for (const line of lines) {
    if (line.role !== "user" && line.role !== "assistant") {
      throw new Error(`Invalid chat line role: ${line.role}`);
    }
  }
}

function sortMockThreads(rows: ChatThreadMeta[]): ChatThreadMeta[] {
  return rows.slice().sort((a, b) => {
    const byUpdated = b.updated_at.localeCompare(a.updated_at);
    if (byUpdated !== 0) {
      return byUpdated;
    }
    const byCreated = b.created_at.localeCompare(a.created_at);
    if (byCreated !== 0) {
      return byCreated;
    }
    return b.id.localeCompare(a.id);
  });
}

function newMockThreadId(iso: string): string {
  mockThreadCounter += 1;
  const compact = iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").slice(0, 16);
  return `t-${compact}-${mockThreadCounter.toString(16).padStart(6, "0")}`;
}

function getMockThreadBucket(root: string, course: string): MockThreadBucket {
  const key = mockThreadsKey(root, course);
  let bucket = mockThreadsByKey.get(key);
  if (!bucket) {
    bucket = { threads: [], linesByThread: new Map() };
    mockThreadsByKey.set(key, bucket);
  }
  return bucket;
}

function seedDefaultCellBiologyThreads(root: string, course: string) {
  const key = mockThreadsKey(root, course);
  if (mockThreadsSeedDisabled.has(key)) {
    return;
  }
  if (course !== "cell-biology" || root !== FIXTURE_ROOT_FALL) {
    return;
  }
  const bucket = getMockThreadBucket(root, course);
  if (bucket.threads.length > 0) {
    return;
  }
  const specs: Array<{ meta: Omit<ChatThreadMeta, "id">; lines: ChatLine[] }> = [
    {
      meta: {
        title: "Membrane structure review",
        mode: "ask",
        created_at: "2026-10-18T10:00:00Z",
        updated_at: "2026-10-18T10:05:00Z",
      },
      lines: [
        {
          ts: "2026-10-18T10:00:00Z",
          role: "user",
          mode: "ask",
          content: "Membrane structure review",
        },
        {
          ts: "2026-10-18T10:05:00Z",
          role: "assistant",
          mode: "ask",
          content: "Phospholipid bilayer overview.",
          supported: true,
          citations: [],
        },
      ],
    },
    {
      meta: {
        title: "ATP and energy currency",
        mode: "ask",
        created_at: "2026-10-19T14:00:00Z",
        updated_at: "2026-10-19T14:02:00Z",
      },
      lines: [
        {
          ts: "2026-10-19T14:00:00Z",
          role: "user",
          mode: "ask",
          content: "What is ATP?",
        },
        {
          ts: "2026-10-19T14:02:00Z",
          role: "assistant",
          mode: "ask",
          content: "ATP stores energy for cellular work.",
          supported: true,
          citations: [],
        },
      ],
    },
    {
      meta: {
        title: "Explain the cytoskeleton",
        mode: "explain",
        created_at: "2026-10-20T16:00:00Z",
        updated_at: "2026-10-20T16:03:00Z",
      },
      lines: [
        {
          ts: "2026-10-20T16:00:00Z",
          role: "user",
          mode: "explain",
          content: "Explain the cytoskeleton",
        },
        {
          ts: "2026-10-20T16:03:00Z",
          role: "assistant",
          mode: "explain",
          content:
            "1. Microfilaments provide shape\n2. Microtubules move organelles\n3. Intermediate filaments add strength",
          supported: true,
          citations: [],
        },
      ],
    },
  ];
  for (const spec of specs) {
    const id = newMockThreadId(spec.meta.created_at);
    bucket.threads.push({ id, ...spec.meta });
    bucket.linesByThread.set(id, spec.lines.slice());
  }
}

export function resetMockChatHistoryForTests() {
  mockThreadsByKey.clear();
  mockThreadsSeedDisabled.clear();
  mockThreadCounter = 0;
  seedDefaultCellBiologyThreads(FIXTURE_ROOT_FALL, "cell-biology");
}

export function seedMockChatHistory(root: string, course: string, lines: ChatLine[]) {
  const bucket = getMockThreadBucket(root, course);
  bucket.threads.length = 0;
  bucket.linesByThread.clear();
  const now = new Date().toISOString();
  const firstUser = lines.find((line) => line.role === "user");
  const title = firstUser?.content ? titleFromUserMessage(firstUser.content) : "Seeded chat";
  const id = newMockThreadId(now);
  bucket.threads.push({
    id,
    title,
    mode: firstUser?.mode === "explain" ? "explain" : "ask",
    created_at: now,
    updated_at: now,
  });
  bucket.linesByThread.set(id, lines.slice());
}

export function seedMockChatThread(
  root: string,
  course: string,
  meta: ChatThreadMeta,
  lines: ChatLine[],
) {
  const bucket = getMockThreadBucket(root, course);
  const existing = bucket.threads.findIndex((t) => t.id === meta.id);
  if (existing >= 0) {
    bucket.threads[existing] = meta;
  } else {
    bucket.threads.push(meta);
  }
  bucket.linesByThread.set(meta.id, lines.slice());
}

function handleMockListChatThreads(payload: Record<string, unknown>) {
  const root = String(payload.root ?? FIXTURE_ROOT_FALL);
  const course = String(payload.course ?? "");
  seedDefaultCellBiologyThreads(root, course);
  const bucket = getMockThreadBucket(root, course);
  return sortMockThreads(bucket.threads);
}

function handleMockCreateChatThread(payload: Record<string, unknown>) {
  const root = String(payload.root ?? FIXTURE_ROOT_FALL);
  const course = String(payload.course ?? "");
  const modeRaw = String(payload.mode ?? "ask");
  assertMockChatMode(modeRaw);
  const mode: ChatMode = modeRaw === "explain" ? "explain" : "ask";
  const now = new Date().toISOString();
  const meta: ChatThreadMeta = {
    id: newMockThreadId(now),
    title: "New chat",
    mode,
    created_at: now,
    updated_at: now,
  };
  const bucket = getMockThreadBucket(root, course);
  bucket.threads.push(meta);
  bucket.linesByThread.set(meta.id, []);
  return meta;
}

function handleMockReadChatThread(payload: Record<string, unknown>) {
  const root = String(payload.root ?? FIXTURE_ROOT_FALL);
  const course = String(payload.course ?? "");
  const thread = String(payload.thread ?? "");
  assertMockThreadId(thread);
  seedDefaultCellBiologyThreads(root, course);
  const bucket = getMockThreadBucket(root, course);
  return (bucket.linesByThread.get(thread) ?? []).slice();
}

function handleMockAppendChatThreadLines(payload: Record<string, unknown>) {
  const root = String(payload.root ?? FIXTURE_ROOT_FALL);
  const course = String(payload.course ?? "");
  const thread = String(payload.thread ?? "");
  assertMockThreadId(thread);
  const lines = Array.isArray(payload.lines) ? (payload.lines as ChatLine[]) : [];
  assertMockChatLineRoles(lines);
  const bucket = getMockThreadBucket(root, course);
  const index = bucket.threads.findIndex((entry) => entry.id === thread);
  if (index < 0) {
    throw new Error("Thread not found");
  }
  const prev = bucket.linesByThread.get(thread) ?? [];
  bucket.linesByThread.set(thread, [...prev, ...lines]);
  const entry = { ...bucket.threads[index]! };
  for (const line of lines) {
    if (entry.title === "New chat" && line.role === "user") {
      entry.title = titleFromUserMessage(line.content ?? "");
    }
  }
  entry.updated_at = new Date().toISOString();
  bucket.threads[index] = entry;
  return entry;
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

const mockJobSummariesBase: JobSummary[] = [
  {
    id: "mock-update-job",
    status: "succeeded",
    trigger_kind: "manual",
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-19T11:58:00Z",
    finished_at: "2026-10-19T12:05:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-failed-1",
    status: "failed",
    trigger_kind: "manual",
    skill: null,
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
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-02T10:00:00Z",
    finished_at: "2026-10-02T10:20:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-flashcards",
    status: "succeeded",
    trigger_kind: "study",
    skill: "flashcards",
    model_id: "grok-4.7",
    started_at: "2026-10-03T08:00:00Z",
    finished_at: "2026-10-03T08:12:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-quiz",
    status: "succeeded",
    trigger_kind: "study",
    skill: "quiz",
    model_id: "grok-4.7",
    started_at: "2026-10-04T09:00:00Z",
    finished_at: "2026-10-04T09:08:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-embed",
    status: "succeeded",
    trigger_kind: "manual",
    skill: "embed",
    model_id: "grok-4.7",
    started_at: "2026-10-05T14:00:00Z",
    finished_at: "2026-10-05T14:30:00Z",
    error_summary: null,
    exit_code: 0,
  },
  {
    id: "job-citations",
    status: "succeeded",
    trigger_kind: "study",
    skill: "citations",
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
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-07T12:00:00Z",
    finished_at: "2026-10-07T12:01:00Z",
    error_summary: null,
    exit_code: null,
  },
];

function mockJobSummariesList(): JobSummary[] {
  if (!mockUpdateJobRunning) {
    return mockJobSummariesBase.slice();
  }
  const running: JobSummary = {
    id: "mock-update-job",
    status: "running",
    trigger_kind: "manual",
    skill: null,
    model_id: "grok-4.7",
    started_at: "2026-10-20T11:58:00Z",
    finished_at: null,
    error_summary: null,
    exit_code: null,
  };
  const rest = mockJobSummariesBase.filter((job) => job.id !== "mock-update-job");
  return [running, ...rest];
}

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
  mockUpdateJobRunning = true;
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
      mockUpdateJobRunning = false;
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
        return structuredClone(mockSettingsState);
      case "save_settings": {
        const next = (payload.settings ?? payload) as typeof fixtureSettings;
        mockSettingsState = structuredClone(next);
        return null;
      }
      case "list_courses": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        return fixtureCourses[root] ?? [];
      }
      case "read_course_meta":
        return { ...mockCourseMetaState };
      case "set_course_meta": {
        const course = String(payload.course ?? "");
        const icon = payload.icon as string | null | undefined;
        const color = payload.color as string | null | undefined;
        const next = { ...mockCourseMetaState };
        const entry = { ...(next[course] ?? {}) };
        if (icon === null) {
          delete entry.icon;
        } else if (typeof icon === "string") {
          entry.icon = icon;
        }
        if (color === null) {
          delete entry.color;
        } else if (typeof color === "string") {
          entry.color = color;
        }
        if (!entry.icon && !entry.color) {
          delete next[course];
        } else {
          next[course] = entry;
        }
        mockCourseMetaState = next;
        return { ...mockCourseMetaState };
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
        return structuredClone(mockLibraryShowState);
      case "get_knowledge_settings":
        return structuredClone(mockKnowledgeSettingsState);
      case "save_knowledge_settings": {
        const next = (payload.settings ?? payload) as typeof fixtureKnowledgeSettings;
        mockKnowledgeSettingsState = structuredClone(next);
        return null;
      }
      case "sync_show":
        return structuredClone(mockSyncShowState);
      case "sync_set_remote": {
        const url = String(payload.url ?? "").trim();
        mockSyncShowState = {
          ...mockSyncShowState,
          remote: url,
          remote_note: `Saved remote ${url}`,
        };
        return { remote: url };
      }
      case "sync_set_shared": {
        const shared = Boolean(payload.shared);
        mockSyncShowState = { ...mockSyncShowState, shared };
        return null;
      }
      case "sync_now":
        return structuredClone(mockSyncNowResult);
      case "sync_continue":
        return { ok: true, action: "integrated", head_changed: true };
      case "read_sync_conflict":
        return structuredClone(mockSyncConflictState);
      case "sync_resolve": {
        const path = String(payload.path ?? "");
        const side = String(payload.side ?? "");
        mockSyncConflictState = {
          ...mockSyncConflictState,
          files: mockSyncConflictState.files.map((file) => {
            if (file.path !== path) {
              return file;
            }
            if (side === "edit") {
              return {
                ...file,
                choice: "edit",
                edit_content: String(payload.content ?? ""),
              };
            }
            return { ...file, choice: side };
          }),
        };
        return null;
      }
      case "create_shared_library": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const rawName = payload.name;
        const name =
          rawName == null || String(rawName).trim() === ""
            ? "Shared library"
            : String(rawName).trim();
        mockLibraryShowState = {
          ...fixtureLibraryShowOwner,
          name,
        } as LibraryShowResult;
        mockSettingsState = {
          ...mockSettingsState,
          knowledge_roots: (mockSettingsState.knowledge_roots ?? []).map((entry) =>
            entry.path === root ? { ...entry, kind: "shared", name } : entry,
          ),
        };
        return { name };
      }
      case "library_set_members": {
        const members = payload.members;
        const currentLibrary = mockLibraryShowState;
        if (currentLibrary.present === true && Array.isArray(members)) {
          mockLibraryShowState = {
            ...currentLibrary,
            members: members as Extract<LibraryShowResult, { present: true }>["members"],
          };
        }
        return null;
      }
      case "library_set_provider": {
        const currentLibrary = mockLibraryShowState;
        if (currentLibrary.present !== true) {
          return null;
        }
        if (payload.clear === true) {
          mockLibraryShowState = { ...currentLibrary, provider: null };
        } else {
          mockLibraryShowState = {
            ...currentLibrary,
            provider: {
              id: String(payload.id ?? ""),
              model: String(payload.model ?? ""),
            },
          };
        }
        return null;
      }
      case "join_library": {
        const dest = String(payload.dest ?? "/mock/knowledge/joined");
        const name = "Joined library";
        mockLibraryShowState = { ...fixtureLibraryShowOwner, name } as LibraryShowResult;
        return { path: dest, name, kind: "shared" };
      }
      case "test_worker_connection":
        return "arbor-worker 5.18.0 (mock)";
      case "list_jobs":
        return mockJobSummariesList();
      case "get_job_events":
        return mockJobEvents(String(payload.jobId ?? payload.job_id ?? ""));
      case "list_chat_threads":
        return handleMockListChatThreads(payload);
      case "create_chat_thread":
        return handleMockCreateChatThread(payload);
      case "read_chat_thread":
        return handleMockReadChatThread(payload);
      case "append_chat_thread_lines":
        return handleMockAppendChatThreadLines(payload);
      case "rename_chat_thread": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        const thread = String(payload.thread ?? "");
        assertMockThreadId(thread);
        const title = String(payload.title ?? "").trim();
        if (title.length < 1 || title.length > 120) {
          throw new Error("Title must be 1–120 characters");
        }
        const bucket = getMockThreadBucket(root, course);
        const index = bucket.threads.findIndex((entry) => entry.id === thread);
        if (index < 0) {
          throw new Error("Thread not found");
        }
        const updated = {
          ...bucket.threads[index]!,
          title,
          updated_at: new Date().toISOString(),
        };
        bucket.threads[index] = updated;
        return updated;
      }
      case "set_chat_thread_mode": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        const thread = String(payload.thread ?? "");
        assertMockThreadId(thread);
        const modeRaw = String(payload.mode ?? "ask");
        assertMockChatMode(modeRaw);
        const mode: ChatMode = modeRaw === "explain" ? "explain" : "ask";
        const bucket = getMockThreadBucket(root, course);
        const index = bucket.threads.findIndex((entry) => entry.id === thread);
        if (index < 0) {
          throw new Error("Thread not found");
        }
        const updated: ChatThreadMeta = {
          ...bucket.threads[index]!,
          mode,
          updated_at: new Date().toISOString(),
        };
        bucket.threads[index] = updated;
        return updated;
      }
      case "delete_chat_thread": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        const thread = String(payload.thread ?? "");
        assertMockThreadId(thread);
        const bucket = getMockThreadBucket(root, course);
        bucket.threads = bucket.threads.filter((entry) => entry.id !== thread);
        bucket.linesByThread.delete(thread);
        return null;
      }
      case "delete_all_chat_threads": {
        const root = String(payload.root ?? FIXTURE_ROOT_FALL);
        const course = String(payload.course ?? "");
        const key = mockThreadsKey(root, course);
        mockThreadsByKey.delete(key);
        mockThreadsSeedDisabled.add(key);
        return null;
      }
      case "start_dictation":
        return null;
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
        return {
          packages: mockSkillPackagesState.map((pkg) => ({
            ...pkg,
            installed: mockInstalledSkillIds.has(pkg.id),
          })),
        };
      case "skill_install": {
        const id = String(payload.id ?? "");
        mockInstalledSkillIds.add(id);
        return { commit: "mock-commit" };
      }
      case "skill_uninstall": {
        const id = String(payload.id ?? "");
        mockInstalledSkillIds.delete(id);
        return null;
      }
      case "skill_run":
        return null;
      case "provider_secret_status": {
        const providerId = String(payload.providerId ?? payload.provider_id ?? "");
        return mockProviderSecretReady.has(providerId) ? "ready" : "key missing";
      }
      case "set_provider_secret": {
        const providerId = String(payload.providerId ?? payload.provider_id ?? "");
        mockProviderSecretReady.add(providerId);
        return null;
      }
      case "clear_provider_secret": {
        const providerId = String(payload.providerId ?? payload.provider_id ?? "");
        mockProviderSecretReady.delete(providerId);
        return null;
      }
      case "reindex_knowledge":
        return { documents: 12 };
      case "search_knowledge":
      case "search_semantic":
        return mockSearchHits(cmd, payload);
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
