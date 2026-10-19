import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { confirm as tauriConfirm, open as tauriOpen } from "@tauri-apps/plugin-dialog";

import { hasTauriInvoke, TAURI_UNAVAILABLE } from "~/domain/tauri";

/** IPC commands the 6.0 UI may invoke (5.1.0 inventory; `list_providers` excluded). */
export type Command =
  | "append_card"
  | "append_chat_lines"
  | "cancel_update"
  | "check_auth"
  | "clear_chat_history"
  | "clear_provider_secret"
  | "create_course"
  | "create_shared_library"
  | "get_job_events"
  | "get_knowledge_settings"
  | "get_settings"
  | "import_sources"
  | "init_arbor_db"
  | "init_knowledge_repo"
  | "join_library"
  | "library_set_members"
  | "library_set_provider"
  | "library_show"
  | "list_courses"
  | "list_digests"
  | "list_jobs"
  | "list_models"
  | "plan_update"
  | "provider_secret_status"
  | "read_chat_history"
  | "read_markdown"
  | "read_quiz_progress"
  | "read_study_json"
  | "read_sync_conflict"
  | "reindex_knowledge"
  | "save_knowledge_settings"
  | "search_knowledge"
  | "search_semantic"
  | "save_settings"
  | "set_provider_secret"
  | "skill_index"
  | "skill_install"
  | "skill_run"
  | "skill_uninstall"
  | "start_chat"
  | "start_embed_job"
  | "start_folder_watch"
  | "start_study_job"
  | "start_update"
  | "study_artifact_stale"
  | "study_plan"
  | "study_progress"
  | "sync_continue"
  | "sync_now"
  | "sync_resolve"
  | "sync_set_remote"
  | "sync_set_shared"
  | "sync_show"
  | "test_worker_connection";

function rejectUnavailable(): Promise<never> {
  return Promise.reject(new Error(TAURI_UNAVAILABLE));
}

function normalizeInvokeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

export async function invoke<T>(cmd: Command, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInvoke(globalThis)) {
    return rejectUnavailable();
  }
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    throw normalizeInvokeError(error);
  }
}

export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!hasTauriInvoke(globalThis)) {
    return rejectUnavailable();
  }
  return tauriListen<T>(event, handler);
}

/** Cancellation-safe Tauri event subscription; returns a synchronous disposer. */
export function subscribe<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(event, handler).then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function openDialog(opts: Parameters<typeof tauriOpen>[0]): Promise<string | string[] | null> {
  if (!hasTauriInvoke(globalThis)) {
    return rejectUnavailable();
  }
  return tauriOpen(opts);
}

export function confirmDialog(
  message: string,
  options?: string | Parameters<typeof tauriConfirm>[1],
): Promise<boolean> {
  if (!hasTauriInvoke(globalThis)) {
    return rejectUnavailable();
  }
  return tauriConfirm(message, options);
}

export const ipc = {
  invoke,
  listen,
  subscribe,
  openDialog,
  confirmDialog,
};
