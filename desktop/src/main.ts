import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthStatus, Model, PendingSource, Selection, Settings, UpdatePlan, WorkerEvent } from "./types";

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

let knowledgeRoot: string | null = null;
let authed = false;

function logLine(text: string) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function refreshUpdateEnabled() {
  updateBtn.disabled = !(authed && knowledgeRoot);
}

function renderReview(pending: PendingSource[]) {
  reviewRowsEl.innerHTML = "";
  for (const p of pending) {
    const row = document.createElement("tr");

    const file = document.createElement("td");
    file.textContent = p.path;

    const pages = document.createElement("td");
    pages.textContent = String(p.page_count);

    const startCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(p.page_count);
    input.placeholder = "all";
    input.dataset.path = p.path;
    if (p.suggested_start_page !== null) input.value = String(p.suggested_start_page);
    startCell.appendChild(input);

    row.append(file, pages, startCell);
    reviewRowsEl.appendChild(row);
  }
  reviewEl.hidden = false;
}

function collectSelections(): Selection[] {
  const inputs = Array.from(reviewRowsEl.querySelectorAll("input")) as HTMLInputElement[];
  return inputs.map((input) => ({
    path: input.dataset.path as string,
    start_page: input.value.trim() === "" ? null : Number(input.value),
  }));
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  if (s.knowledge_root) {
    knowledgeRoot = s.knowledge_root;
    rootPathEl.textContent = s.knowledge_root;
    openBtn.disabled = false;
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

async function refreshAuth() {
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
  const selections = collectSelections();
  reviewEl.hidden = true;
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  try {
    await invoke("start_update", {
      root: knowledgeRoot,
      model: modelSel.value,
      selections,
    });
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
  logLine("Cancel requested; stopping after the current stage…");
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
      logLine(`  • ${ev.source} from page ${ev.start_page}`);
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

window.addEventListener("focus", refreshAuth);

(async () => {
  await loadSettings();
  await refreshAuth();
})();
