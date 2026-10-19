import type { InvokeArgs } from "@tauri-apps/api/core";

import {
  FIXTURE_ROOT_FALL,
  fixtureCourseOverview,
  fixtureCourses,
  fixtureDigests,
  fixtureKnowledgeSettings,
  fixtureMarkdownSample,
  fixtureSettings,
} from "~/test/fixtures/data";

const ipcLog: string[] = [];

export function getMockIpcLog(): string[] {
  return ipcLog;
}

export function clearMockIpcLog() {
  ipcLog.length = 0;
}

export function createMockHandler(
  overrides: Partial<Record<string, (args?: InvokeArgs) => unknown>> = {},
) {
  return (cmd: string, args?: InvokeArgs): unknown => {
    const payload = (args ?? {}) as Record<string, unknown>;
    ipcLog.push(cmd);
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
      case "read_markdown":
        return fixtureMarkdownSample;
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
        return [
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
            trigger_kind: "manual",
            model_id: "grok-4.7",
            started_at: "2026-10-02T10:00:00Z",
            finished_at: "2026-10-02T10:20:00Z",
            error_summary: null,
            exit_code: 0,
          },
        ];
      case "read_chat_history":
        return [{ role: "assistant", content: "Hello from mock chat." }];
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
            questions: [],
          };
        }
        return { schema_version: 1, course: String(payload.course ?? ""), nodes: [], edges: [] };
      case "read_quiz_progress":
        return { "q-1": { seen: 10, correct: 7, wrong: 3 } };
      case "study_artifact_stale":
        return false;
      case "skill_index":
        return { packages: [] };
      case "provider_secret_status":
        return "ready";
      case "init_knowledge_repo":
      case "init_arbor_db":
      case "start_folder_watch":
      case "append_card":
      case "append_chat_lines":
      case "clear_chat_history":
      case "cancel_update":
      case "plan_update":
        return { pending: [] };
      case "start_update":
      case "start_embed_job":
        return "mock-job-id";
      default:
        return null;
    }
  };
}
