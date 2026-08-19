import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthStatus, JobEventRow, JobSummary, Model, PendingSource, Selection, Settings, UpdatePlan, WorkerEvent } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const rootPathEl = $("root-path") as HTMLSpanElement;
const chooseBtn = $("choose-folder") as HTMLButtonElement;
const openBtn = $("open-folder") as HTMLButtonElement;
const modelSel = $("model") as HTMLSelectElement;
const statusEl = $("codex-status") as HTMLSpanElement;
const docsLink = $("codex-docs") as HTMLAnchorElement;
const updateBtn = $("update") as HTMLButtonElement;
const cancelBtn = $("cancel") as HTMLButtonElement;
const logEl = $("log") as HTMLPreElement;
const reviewEl = $("review") as HTMLElement;
const reviewRowsEl = $("review-rows") as HTMLTableSectionElement;
const confirmBtn = $("confirm-update") as HTMLButtonElement;
const cancelReviewBtn = $("cancel-review") as HTMLButtonElement;
const historyEl = $("history") as HTMLElement;
const historyRowsEl = $("history-rows") as HTMLTableSectionElement;
const historyLogEl = $("history-log") as HTMLPreElement;

let knowledgeRoot: string | null = null;
let authed = false;
let activeJobId: string | null = null;

function logLine(text: string) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function refreshUpdateEnabled() {
  updateBtn.disabled = !(authed && knowledgeRoot);
}

function formatRanges(ranges: [number, number][]): string {
  return ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(", ");
}

function parseRanges(raw: string, pageCount: number): [number, number][] | null {
  const text = raw.trim();
  if (text === "") return null;
  const ranges: [number, number][] = [];
  for (const part of text.split(",")) {
    const bit = part.trim();
    const match = bit.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid range "${bit}". Use 3-5 or 8.`);
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Range ${start}-${end} is outside 1-${pageCount}.`);
    }
    ranges.push([start, end]);
  }
  return ranges;
}

function alignmentNote(p: PendingSource): string | null {
  if (p.alignment_status === "ambiguous") {
    return "Alignment is uncertain. Set ranges or leave blank for the whole file.";
  }
  if (p.alignment_status === "changed" && p.suggested_ranges.length === 0) {
    return "Pages were removed. Leave blank to skip, or set ranges to ingest.";
  }
  return null;
}

function renderReview(pending: PendingSource[]) {
  reviewRowsEl.innerHTML = "";
  for (const p of pending) {
    const row = document.createElement("tr");

    const file = document.createElement("td");
    file.textContent = p.path;

    const pages = document.createElement("td");
    pages.textContent = String(p.page_count);

    const rangeCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "all";
    input.dataset.path = p.path;
    input.dataset.pageCount = String(p.page_count);
    if (p.suggested_ranges.length > 0) {
      input.value = formatRanges(p.suggested_ranges);
    }
    rangeCell.appendChild(input);
    const note = alignmentNote(p);
    if (note) {
      const hint = document.createElement("span");
      hint.className = "note";
      hint.textContent = note;
      rangeCell.appendChild(hint);
    }

    row.append(file, pages, rangeCell);
    reviewRowsEl.appendChild(row);
  }
  reviewEl.hidden = false;
}

function collectSelections(): Selection[] {
  const inputs = Array.from(reviewRowsEl.querySelectorAll("input")) as HTMLInputElement[];
  return inputs.map((input) => ({
    path: input.dataset.path as string,
    ranges: parseRanges(input.value, Number(input.dataset.pageCount)),
  }));
}

async function loadJobHistory() {
  if (!knowledgeRoot) {
    historyEl.hidden = true;
    return;
  }
  try {
    await invoke("init_arbor_db", { root: knowledgeRoot });
    const jobs = await invoke<JobSummary[]>("list_jobs", { root: knowledgeRoot, limit: 15 });
    historyRowsEl.innerHTML = "";
    for (const job of jobs) {
      const row = document.createElement("tr");
      const started = document.createElement("td");
      started.textContent = job.started_at;
      const status = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${job.status}`;
      badge.textContent = job.error_summary ? `${job.status} (${job.error_summary})` : job.status;
      status.appendChild(badge);
      const model = document.createElement("td");
      model.textContent = job.model_id ?? "—";
      const actions = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Log";
      btn.addEventListener("click", () => void showJobLog(job.id));
      actions.appendChild(btn);
      row.append(started, status, model, actions);
      historyRowsEl.appendChild(row);
    }
    historyEl.hidden = jobs.length === 0;
  } catch (e) {
    logLine(`Could not load job history: ${e}`);
  }
}

async function showJobLog(jobId: string) {
  if (!knowledgeRoot) return;
  const events = await invoke<JobEventRow[]>("get_job_events", { root: knowledgeRoot, jobId });
  historyLogEl.hidden = false;
  historyLogEl.textContent = events.map((e) => e.line).join("\n");
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  if (s.knowledge_root) {
    knowledgeRoot = s.knowledge_root;
    rootPathEl.textContent = s.knowledge_root;
    openBtn.disabled = false;
    await loadJobHistory();
  }
  await loadModels(s.model_id);
}

async function persist() {
  const settings: Settings = {
    knowledge_root: knowledgeRoot,
    model_id: modelSel.value || null,
  };
  await invoke("save_settings", { settings });
}

async function loadModels(selected: string | null) {
  const res = await invoke<{ models: Model[] }>("list_models", {
    root: knowledgeRoot ?? undefined,
  });
  modelSel.innerHTML = "";
  for (const m of res.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSel.appendChild(opt);
  }
  if (selected) modelSel.value = selected;
}

let refreshAuthInFlight: Promise<void> | null = null;

async function refreshAuth() {
  if (refreshAuthInFlight) return refreshAuthInFlight;
  refreshAuthInFlight = (async () => {
    statusEl.textContent = "Checking Codex…";
    statusEl.className = "badge";
    docsLink.hidden = true;
    try {
      const a = await invoke<AuthStatus>("check_auth");
      authed = a.authenticated;
      if (a.authenticated) {
        statusEl.textContent = "Codex ready";
        statusEl.className = "badge ok";
      } else {
        statusEl.textContent = `Codex: ${a.reason}`;
        statusEl.className = "badge bad";
        docsLink.href = a.docs_url;
        docsLink.hidden = false;
      }
    } catch (e) {
      authed = false;
      statusEl.textContent = `Codex check failed: ${e}`;
      statusEl.className = "badge bad";
    }
    refreshUpdateEnabled();
  })().finally(() => {
    refreshAuthInFlight = null;
  });
  return refreshAuthInFlight;
}

chooseBtn.addEventListener("click", async () => {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  knowledgeRoot = picked;
  rootPathEl.textContent = picked;
  openBtn.disabled = false;
  try {
    const created = await invoke<boolean>("init_knowledge_repo", { path: picked });
    if (created) logLine(`Initialized git repository in ${picked}`);
  } catch (e) {
    logLine(`Could not initialize git: ${e}`);
  }
  await loadModels(modelSel.value || null);
  await persist();
  await loadJobHistory();
  refreshUpdateEnabled();
});

openBtn.addEventListener("click", async () => {
  if (knowledgeRoot) await invoke("open_folder", { path: knowledgeRoot });
});

modelSel.addEventListener("change", persist);

updateBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  logEl.textContent = "";
  try {
    const plan = await invoke<UpdatePlan>("plan_update", { root: knowledgeRoot });
    if (plan.pending.length === 0) {
      logLine("Nothing to process — everything is up to date.");
      return;
    }
    renderReview(plan.pending);
  } catch (e) {
    logLine(`Could not plan update: ${e}`);
  }
});

confirmBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  let selections: Selection[];
  try {
    selections = collectSelections();
  } catch (e) {
    logLine(`Could not read ranges: ${e}`);
    return;
  }
  reviewEl.hidden = true;
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  try {
    activeJobId = await invoke<string>("start_update", {
      root: knowledgeRoot,
      model: modelSel.value,
      selections,
    });
    logLine(`Job ${activeJobId} started.`);
  } catch (e) {
    logLine(`Update failed to start: ${e}`);
    reviewEl.hidden = false;
    updateBtn.disabled = false;
    cancelBtn.disabled = true;
  }
});

cancelReviewBtn.addEventListener("click", () => {
  reviewEl.hidden = true;
  logLine("Update cancelled before processing.");
});

cancelBtn.addEventListener("click", async () => {
  await invoke("cancel_update");
  logLine("Cancel requested; stopping after the current range or action.");
});

function renderEvent(ev: WorkerEvent) {
  switch (ev.type) {
    case "run_started":
      logLine(`Run started (model ${ev.model_id ?? ""})`);
      break;
    case "nothing_to_process":
      logLine("Nothing to process — everything is up to date.");
      break;
    case "course_started":
      logLine(`\n■ ${ev.course_dir} (${ev.sources} source(s))`);
      break;
    case "source_started":
      logLine(`  • ${ev.source} pages ${formatRanges(ev.ranges ?? []) || "all"}`);
      break;
    case "source_done":
      logLine(`    ✓ ${ev.digest}`);
      break;
    case "source_failed":
      logLine(`    ✗ ${ev.source}: ${ev.message}`);
      break;
    case "source_deleted":
      logLine(`    🗑 removed ${ev.source}`);
      break;
    case "course_synthesis_started":
      logLine(`  Synthesizing course.md from ${ev.digest_count} digest(s)…`);
      break;
    case "course_synthesis_done":
      logLine(`  ✓ course.md updated`);
      break;
    case "course_synthesis_failed":
      logLine(`  ✗ course.md not updated: ${ev.message}`);
      break;
    case "course_done":
      logLine(`  ${ev.course_dir}: ${ev.digests} new digest(s)`);
      break;
    case "stage":
      logLine(`   ${ev.stage}: ${ev.status}${ev.detail ? " — " + ev.detail : ""}`);
      break;
    case "warning":
      logLine(`   ⚠ ${ev.message}`);
      break;
    case "cancelled":
      logLine("Cancelled.");
      break;
    case "committed":
      logLine(`Committed ${ev.commit}: ${(ev.courses ?? []).join(", ")}`);
      break;
    case "run_done":
      logLine(`\nDone. processed=${ev.processed} failed=${ev.failed} skipped=${ev.skipped}`);
      break;
    case "auth_failed":
      logLine(`Codex not authenticated: ${ev.reason}`);
      break;
    case "error":
      logLine(`Error: ${ev.message}`);
      break;
    case "worker_exit":
      updateBtn.disabled = false;
      cancelBtn.disabled = true;
      refreshUpdateEnabled();
      void loadJobHistory();
      activeJobId = null;
      break;
  }
}

listen<{ line: string }>("arbor://progress", (e) => {
  try {
    renderEvent(JSON.parse(e.payload.line) as WorkerEvent);
  } catch {
    logLine(e.payload.line);
  }
});

listen<{ job_id: string }>("arbor://job-finished", () => {
  void loadJobHistory();
});

window.addEventListener("focus", refreshAuth);

(async () => {
  await loadSettings();
  await refreshAuth();
})();
