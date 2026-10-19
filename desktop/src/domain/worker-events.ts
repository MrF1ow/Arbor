import type { WorkerEvent } from "~/domain/types";
import { formatRanges } from "~/domain/update";

export { formatRanges };

export type FormattedWorkerEvent = {
  line: string;
  step: string | null;
  status: "idle" | "running" | "failed" | "done";
};

export function formatWorkerEvent(ev: WorkerEvent, providerLabel = "Provider"): FormattedWorkerEvent {
  let line: string;
  let step: string | null = null;
  let status: FormattedWorkerEvent["status"] = "running";

  switch (ev.type) {
    case "run_started":
      line = `Run started (model ${ev.model_id ?? ""})`;
      step = "run";
      break;
    case "nothing_to_process":
      line = "Nothing to process — everything is up to date.";
      status = "done";
      break;
    case "course_started":
      line = `\n■ ${ev.course_dir ?? ""} (${ev.sources ?? 0} source(s))`;
      step = ev.course_dir ?? null;
      break;
    case "source_started":
      line = `  • ${ev.source ?? ""} pages ${formatRanges(ev.ranges ?? []) || "all"}`;
      break;
    case "source_done":
      line = `    ✓ ${ev.digest ?? ""}`;
      break;
    case "source_failed":
      line = `    ✗ ${ev.source ?? ""}: ${ev.message ?? ""}`;
      status = "failed";
      break;
    case "source_deleted":
      line = `    🗑 removed ${ev.source ?? ""}`;
      break;
    case "course_synthesis_started":
      line = `  Synthesizing course.md from ${ev.digest_count ?? 0} digest(s)…`;
      break;
    case "course_synthesis_done":
      line = "  ✓ course.md updated";
      break;
    case "course_synthesis_failed":
      line = `  ✗ course.md not updated: ${ev.message ?? ""}`;
      status = "failed";
      break;
    case "course_done":
      line = `  ${ev.course_dir ?? ""}: ${ev.digests ?? 0} new digest(s)`;
      break;
    case "embed_started":
      line = "Embedding digests…";
      step = "embed";
      break;
    case "embed_done":
      line = `Embedded ${ev.embedded ?? 0} digest(s) into ${ev.chunks ?? 0} chunk(s); skipped ${ev.skipped ?? 0}.`;
      status = "done";
      break;
    case "embed_failed":
      line = `Embedding failed: ${ev.message ?? ""}`;
      status = "failed";
      break;
    case "stage":
      line = `   ${ev.stage ?? ""}: ${ev.status ?? ""}${ev.detail ? ` — ${ev.detail}` : ""}`;
      step = ev.stage ?? null;
      break;
    case "warning":
      line = `   ⚠ ${ev.message ?? ""}`;
      break;
    case "cancelled":
      line = "Cancelled.";
      status = "done";
      break;
    case "committed":
      line = `Committed ${ev.commit ?? ""}: ${(ev.courses ?? []).join(", ")}`;
      status = "done";
      break;
    case "sync_done":
      line = `Synced (${ev.action ?? "ok"})${ev.commit ? `: ${ev.commit}` : ""}`;
      status = "done";
      break;
    case "run_done":
      line = `\nDone. processed=${ev.processed ?? 0} failed=${ev.failed ?? 0} skipped=${ev.skipped ?? 0}`;
      status = "done";
      break;
    case "auth_failed":
      line = `${providerLabel} is not authenticated: ${ev.reason ?? ""}`;
      status = "failed";
      break;
    case "error":
      line = `Error: ${ev.message ?? ""}`;
      status = "failed";
      break;
    case "skill_started":
      line = `Study ${ev.skill ?? "skill"} started`;
      step = ev.skill ?? null;
      break;
    case "skill_progress":
      line = `Study ${ev.skill ?? "skill"} retry ${ev.attempt ?? "?"}/${ev.attempts ?? "?"}${ev.message ? `: ${ev.message}` : ""}`;
      break;
    case "skill_done":
      line = `Study ${ev.skill ?? "skill"} wrote ${ev.file ?? "artifact"}`;
      break;
    case "skill_failed":
      line = `Study ${ev.skill ?? "skill"} failed${ev.message ? `: ${ev.message}` : ""}`;
      status = "failed";
      break;
    case "skill_stale_skipped":
      line = `Study ${ev.skill ?? "skill"} unchanged`;
      break;
    case "citation_failed":
      line = `Citation failed ${ev.path ?? "artifact"} ${ev.id ?? ""}: ${ev.reason ?? ""}`;
      status = "failed";
      break;
    case "sync_conflict":
      line = `Sync conflict: ${ev.message ?? ""}`;
      status = "failed";
      break;
    case "worker_exit":
      line = "Worker exited";
      status = "done";
      break;
    default:
      line = ev.message ? `${ev.type}: ${ev.message}` : ev.type;
      break;
  }

  return { line, step, status };
}
