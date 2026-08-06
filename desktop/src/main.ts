import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthStatus, Model, Settings, WorkerEvent } from "./types";

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

let knowledgeRoot: string | null = null;
let authed = false;

function logLine(text: string) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function refreshUpdateEnabled() {
  updateBtn.disabled = !(authed && knowledgeRoot);
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
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  await invoke("start_update", { root: knowledgeRoot, model: modelSel.value });
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
    case "lecture_started":
      logLine(`\n• ${ev.lecture_dir} (${ev.source})`);
      break;
    case "stage":
      logLine(`   ${ev.stage}: ${ev.status}${ev.detail ? " — " + ev.detail : ""}`);
      break;
    case "warning":
      logLine(`   ⚠ ${ev.message}`);
      break;
    case "lecture_done":
      logLine(`   ✓ done`);
      break;
    case "lecture_failed":
      logLine(`   ✗ failed at ${ev.stage}: ${ev.message}`);
      break;
    case "cancelled":
      logLine("Cancelled.");
      break;
    case "committed":
      logLine(`Committed ${ev.commit}: ${(ev.lectures ?? []).join(", ")}`);
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
