import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createReview,
  currentCard,
  flashcardJobArgs,
  flipReview,
  incrementSeen,
  nextReview,
  parseFlashcardDeck,
  parseFlashcardProgress,
  previousReview,
  shouldAutoGenerateFlashcards,
  shuffleCards,
} from "./flashcards";
import { renderMarkdown } from "./markdown";
import type {
  AuthStatus,
  DigestInfo,
  FlashcardProgress,
  FlashcardReview,
  JobEventRow,
  JobFinished,
  JobSummary,
  KnowledgeSettings,
  Model,
  PendingSource,
  SearchHit,
  Selection,
  Settings,
  UpdatePlan,
  WorkerEvent,
} from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Place = "welcome" | "course" | "jobs" | "settings";
type Mode = "notes" | "flashcards" | "quiz";

const courseListEl = $("course-list");
const folderHintEl = $("folder-hint");
const chooseBtn = $("choose-folder");
const welcomeChooseBtn = $("welcome-choose");
const courseHeaderEl = $("course-header");
const courseTitleEl = $("course-title");
const modeTabsEl = $("mode-tabs");
const inspectorEl = $("inspector");
const panels = document.querySelectorAll(".content-panel");
const navJobs = $("nav-jobs");
const navSettings = $("nav-settings");
const codexStatusEl = $("codex-status");
const codexLabelEl = $("codex-label");
const docsLink = $("codex-docs") as HTMLAnchorElement;
const digestListEl = $("digest-list");
const courseIndexLink = $("course-index-link");
const readingArticleEl = $("reading-article");
const flashcardsCopyEl = $("flashcards-copy");
const flashcardsEmptyEl = $("flashcards-empty");
const flashcardsDeckEl = $("flashcards-deck");
const generateFlashcardsBtn = $("generate-flashcards") as HTMLButtonElement;
const refreshFlashcardsBtn = $("refresh-flashcards") as HTMLButtonElement;
const flashcardStaleEl = $("flashcard-stale");
const flashcardCountEl = $("flashcard-count");
const flashcardFaceEl = $("flashcard-face");
const flashcardSourceBtn = $("flashcard-source") as HTMLButtonElement;
const flashcardTagsEl = $("flashcard-tags");
const flashcardPrevBtn = $("flashcard-prev");
const flashcardFlipBtn = $("flashcard-flip");
const flashcardNextBtn = $("flashcard-next");
const flashcardShuffleBtn = $("flashcard-shuffle");
const quizCopyEl = $("quiz-copy");
const jobsListEl = $("jobs-list");
const jobsLogEl = $("jobs-log");
const modelSel = $("model") as HTMLSelectElement;
const toggleWatch = $("toggle-watch");
const toggleAuto = $("toggle-auto");
const toggleDelete = $("toggle-delete");
const toggleAutoFlashcards = $("toggle-auto-flashcards");
const reindexBtn = $("reindex") as HTMLButtonElement;
const updateBtn = $("update") as HTMLButtonElement;
const cancelBtn = $("cancel") as HTMLButtonElement;
const logEl = $("log");
const reviewEl = $("review");
const reviewRowsEl = $("review-rows") as HTMLTableSectionElement;
const confirmBtn = $("confirm-update");
const cancelReviewBtn = $("cancel-review");
const inspectorBodyEl = $("inspector-body");
const inspectorToggleBtn = $("inspector-toggle");
const inspectorStatusEl = $("inspector-status");
const searchToggleBtn = $("search-toggle") as HTMLButtonElement;
const searchOverlayEl = $("search-overlay");
const searchInput = $("search-input") as HTMLInputElement;
const searchResultsEl = $("search-results");

let knowledgeRoot: string | null = null;
let authed = false;
let activeUpdateJobId: string | null = null;
let studyJobRunning = false;
let searchTimer: number | null = null;
let currentPlace: Place = "welcome";
let currentCourse: string | null = null;
let currentMode: Mode = "notes";
let courses: string[] = [];
let flashcardReview: FlashcardReview | null = null;
let flashcardProgress: FlashcardProgress = {};
let flashcardCourse: string | null = null;
let progressWrite = Promise.resolve();

function logLine(text: string) {
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
  openInspector();
}

function openInspector() {
  if (!inspectorBodyEl.classList.contains("open")) {
    inspectorBodyEl.classList.add("open");
    inspectorToggleBtn.textContent = "Hide log ▾";
  }
}

function showPanel(name: string) {
  panels.forEach((p) => p.classList.toggle("active", (p as HTMLElement).dataset.panel === name));
}

function setNavActive(place: Place, course?: string) {
  courseListEl.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", place === "course" && btn.getAttribute("data-course") === course);
  });
  navJobs.classList.toggle("active", place === "jobs");
  navSettings.classList.toggle("active", place === "settings");
}

function setCourseView(course: string, mode: Mode = currentMode, notesPath?: string) {
  currentPlace = "course";
  currentCourse = course;
  currentMode = mode;
  courseTitleEl.textContent = course;
  courseHeaderEl.hidden = false;
  inspectorEl.hidden = false;
  flashcardsCopyEl.textContent = `Study decks generated from your ${course} digests. Flip cards, track progress, and shuffle for review.`;
  quizCopyEl.textContent = `Practice questions pulled from your ${course} material. Test yourself before the exam.`;
  modeTabsEl.querySelectorAll(".mode-tab").forEach((t) => {
    t.classList.toggle("active", (t as HTMLElement).dataset.mode === mode);
  });
  showPanel(mode);
  setNavActive("course", course);
  if (mode === "notes") void loadCourseContent(course, notesPath);
  if (mode === "flashcards") void loadFlashcards(course);
  refreshStudyEnabled();
}

function setPlaceView(place: Place) {
  currentPlace = place;
  courseHeaderEl.hidden = place !== "course";
  inspectorEl.hidden = place !== "course";
  if (place === "welcome") {
    showPanel("welcome");
    setNavActive("welcome");
    return;
  }
  if (place === "jobs") {
    showPanel("jobs");
    setNavActive("jobs");
    void loadJobHistory();
    return;
  }
  if (place === "settings") {
    showPanel("settings");
    setNavActive("settings");
    void loadKnowledgeSettingsUi();
    return;
  }
}

function refreshUpdateEnabled() {
  updateBtn.disabled = !(authed && knowledgeRoot && currentPlace === "course");
}

function refreshStudyEnabled() {
  const enabled = Boolean(
    authed &&
      knowledgeRoot &&
      currentCourse &&
      modelSel.value &&
      !studyJobRunning,
  );
  generateFlashcardsBtn.disabled = !enabled;
  refreshFlashcardsBtn.disabled = !enabled;
}

function refreshFolderTools() {
  const ready = Boolean(knowledgeRoot);
  searchToggleBtn.disabled = !ready;
  reindexBtn.disabled = !ready;
  refreshUpdateEnabled();
  refreshStudyEnabled();
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/home\/[^/]+/, "~");
  return home.length > 36 ? "…" + home.slice(-34) : home;
}

async function renderCourseList() {
  courseListEl.innerHTML = "";
  if (!knowledgeRoot) {
    courseListEl.innerHTML = '<p class="nav-empty">No courses yet</p>';
    return;
  }
  try {
    courses = await invoke<string[]>("list_courses", { root: knowledgeRoot });
  } catch {
    courses = [];
  }
  if (courses.length === 0) {
    courseListEl.innerHTML = '<p class="nav-empty">No course folders</p>';
    return;
  }
  for (const course of courses) {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.dataset.place = "course";
    btn.dataset.course = course;
    btn.innerHTML = `<span class="icon">◈</span> ${course}`;
    btn.addEventListener("click", () => setCourseView(course, "notes"));
    courseListEl.appendChild(btn);
  }
}

async function loadDigestPreview(course: string, relativePath: string) {
  if (!knowledgeRoot) return;
  courseIndexLink.classList.toggle("active", relativePath === `${course}/course.md`);
  digestListEl.querySelectorAll(".digest-link").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.path === relativePath);
  });
  try {
    const raw = await invoke<string>("read_markdown", { root: knowledgeRoot, relativePath });
    const { html, pageChip } = renderMarkdown(raw);
    readingArticleEl.innerHTML = pageChip
      ? `<div class="page-chip">Pages ${pageChip}</div>${html}`
      : html;
  } catch (e) {
    readingArticleEl.innerHTML = `<p class="reading-empty">Could not load file: ${e}</p>`;
  }
}

async function loadCourseContent(course: string, initialPath?: string) {
  if (!knowledgeRoot) return;
  digestListEl.innerHTML = "";
  const courseMdPath = `${course}/course.md`;
  courseIndexLink.dataset.path = courseMdPath;
  courseIndexLink.onclick = () => void loadDigestPreview(course, courseMdPath);

  try {
    const digests = await invoke<DigestInfo[]>("list_digests", { root: knowledgeRoot, course });
    for (const d of digests) {
      const btn = document.createElement("button");
      btn.className = "digest-link";
      btn.dataset.path = d.path;
      btn.innerHTML = `<span class="name">${d.name}</span><span class="date">${d.name}</span>`;
      btn.addEventListener("click", () => void loadDigestPreview(course, d.path));
      digestListEl.appendChild(btn);
    }
    const first = initialPath ?? (digests.length > 0 ? digests[0].path : courseMdPath);
    await loadDigestPreview(course, first);
  } catch {
    await loadDigestPreview(course, courseMdPath);
  }
}

function renderCurrentFlashcard() {
  if (!flashcardReview) return;
  const card = currentCard(flashcardReview);
  flashcardCountEl.textContent = `${flashcardReview.index + 1} of ${flashcardReview.cards.length}`;
  flashcardFaceEl.textContent = flashcardReview.flipped ? card.back : card.front;
  flashcardFaceEl.classList.toggle("flipped", flashcardReview.flipped);
  flashcardFlipBtn.textContent = flashcardReview.flipped ? "Show front" : "Flip";
  flashcardSourceBtn.textContent = card.source.heading
    ? `${card.source.digest} · ${card.source.heading}`
    : card.source.digest;
  flashcardTagsEl.textContent = card.tags.join(" · ");
}

async function loadFlashcards(course: string) {
  if (!knowledgeRoot) return;
  const root = knowledgeRoot;
  try {
    const deckValue = await invoke<unknown>("read_study_json", {
      root,
      course,
      file: "flashcards.json",
    });
    const deck = parseFlashcardDeck(deckValue);
    if (deck.course !== course) throw new Error(`Deck course is ${deck.course}`);
    const progressValue = await invoke<unknown>("read_flashcard_progress", {
      root,
      course,
    });
    const stale = await invoke<boolean>("study_artifact_stale", {
      root,
      course,
      skill: "flashcards",
    });
    if (currentCourse !== course) return;
    flashcardReview = createReview(deck);
    flashcardProgress = parseFlashcardProgress(progressValue);
    flashcardCourse = course;
    flashcardsEmptyEl.hidden = true;
    flashcardsDeckEl.hidden = false;
    flashcardStaleEl.hidden = !stale;
    renderCurrentFlashcard();
  } catch {
    if (currentCourse !== course) return;
    flashcardReview = null;
    flashcardProgress = {};
    flashcardCourse = course;
    flashcardsEmptyEl.hidden = false;
    flashcardsDeckEl.hidden = true;
    flashcardsCopyEl.textContent = `No flashcards yet for ${course}. Generate a deck from your digests.`;
  }
  refreshStudyEnabled();
}

function persistFlashcardProgress() {
  if (!knowledgeRoot || !flashcardCourse) return;
  const root = knowledgeRoot;
  const course = flashcardCourse;
  const data = flashcardProgress;
  progressWrite = progressWrite
    .then(() => invoke<void>("write_flashcard_progress", { root, course, data }))
    .catch((error) => logLine(`Could not save flashcard progress: ${error}`));
}

function markCurrentFlashcardSeen() {
  if (!flashcardReview) return;
  flashcardProgress = incrementSeen(
    flashcardProgress,
    currentCard(flashcardReview).id,
  );
  persistFlashcardProgress();
}

async function startFlashcardJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      flashcardJobArgs(knowledgeRoot, currentCourse, force, modelSel.value),
    );
    logLine(`Flashcard job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Flashcard generation failed to start: ${error}`);
  }
}

async function activateKnowledgeRoot(picked: string) {
  knowledgeRoot = picked;
  folderHintEl.textContent = shortenPath(picked);
  chooseBtn.textContent = "Change folder…";
  try {
    const created = await invoke<boolean>("init_knowledge_repo", { path: picked });
    if (created) logLine(`Initialized git repository in ${picked}`);
  } catch (e) {
    logLine(`Could not initialize git: ${e}`);
  }
  await invoke("start_folder_watch", { root: picked });
  await loadModels(modelSel.value || null);
  await persist();
  await renderCourseList();
  await loadJobHistory();
  refreshFolderTools();
  if (courses.length > 0) {
    setCourseView(courses[0], "notes");
  } else {
    setPlaceView("welcome");
    readingArticleEl.innerHTML = '<p class="reading-empty">Add course folders to your Knowledge directory.</p>';
  }
}

async function runSearch(query: string) {
  if (!knowledgeRoot || !query.trim()) {
    searchResultsEl.innerHTML = '<div class="search-empty">Type to search digests</div>';
    return;
  }
  const hits = await invoke<SearchHit[]>("search_knowledge", {
    root: knowledgeRoot,
    query,
    limit: 20,
  });
  searchResultsEl.innerHTML = "";
  if (hits.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-empty">No results</div>';
    return;
  }
  for (const hit of hits) {
    const btn = document.createElement("button");
    btn.className = "search-hit";
    btn.innerHTML = `<div class="title">${hit.title}</div><div class="sub">${hit.course} · ${hit.path}${hit.page_range ? ` · p.${hit.page_range}` : ""}</div><div class="snippet">${hit.snippet}</div>`;
    btn.addEventListener("click", () => {
      searchOverlayEl.classList.remove("open");
      const rel = hit.path.includes("/") ? hit.path : `${hit.course}/${hit.path}`;
      setCourseView(hit.course, "notes", rel);
    });
    searchResultsEl.appendChild(btn);
  }
}

function selectionsFromPending(pending: PendingSource[]): Selection[] {
  return pending.map((p) => ({
    path: p.path,
    ranges: p.suggested_ranges.length > 0 ? p.suggested_ranges : null,
  }));
}

async function startUpdateWithSelections(
  selections: Selection[],
  trigger: "manual" | "watch" = "manual",
) {
  if (!knowledgeRoot || !modelSel.value) return;
  reviewEl.hidden = true;
  updateBtn.disabled = true;
  cancelBtn.disabled = false;
  openInspector();
  try {
    activeUpdateJobId = await invoke<string>("start_update", {
      root: knowledgeRoot,
      model: modelSel.value,
      selections,
      trigger,
    });
    logLine(`Job ${activeUpdateJobId} started.`);
  } catch (e) {
    logLine(`Update failed to start: ${e}`);
    reviewEl.hidden = false;
    updateBtn.disabled = false;
    cancelBtn.disabled = true;
    refreshUpdateEnabled();
  }
}

async function handleWatchTriggered() {
  if (!knowledgeRoot) return;
  const ks = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
  if (!ks.watch_enabled) return;
  try {
    const plan = await invoke<UpdatePlan>("plan_update", { root: knowledgeRoot });
    if (plan.pending.length === 0) return;
    logLine(`Folder watch detected ${plan.pending.length} file(s) to process.`);
    openInspector();
    if (ks.auto_update) {
      await refreshAuth();
      if (!authed) {
        renderReview(plan.pending);
        logLine("Auto-update waiting for Codex auth. Review and Confirm when ready.");
        return;
      }
      await startUpdateWithSelections(selectionsFromPending(plan.pending), "watch");
      return;
    }
    renderReview(plan.pending);
    logLine("Review the detected files and Confirm when ready.");
  } catch (e) {
    logLine(`Watch plan failed: ${e}`);
  }
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
    if (!match) throw new Error(`Invalid range "${bit}". Use 3-5 or 8.`);
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
    if (p.suggested_ranges.length > 0) input.value = formatRanges(p.suggested_ranges);
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
  openInspector();
}

function collectSelections(): Selection[] {
  const inputs = Array.from(reviewRowsEl.querySelectorAll("input")) as HTMLInputElement[];
  return inputs.map((input) => ({
    path: input.dataset.path as string,
    ranges: parseRanges(input.value, Number(input.dataset.pageCount)),
  }));
}

function statusClass(status: string): string {
  if (status === "succeeded") return "status-ok";
  if (status === "running") return "status-running";
  return "status-bad";
}

function updateInspectorStatus(job?: JobSummary) {
  if (!job) {
    inspectorStatusEl.textContent = "";
    return;
  }
  const time = job.finished_at ?? job.started_at;
  const label = job.status === "succeeded" ? "succeeded" : job.status;
  inspectorStatusEl.innerHTML = `Last job: <span class="ok">${label}</span> · ${time}`;
}

async function loadJobHistory() {
  jobsListEl.innerHTML = "";
  jobsLogEl.hidden = true;
  if (!knowledgeRoot) {
    jobsListEl.innerHTML = '<div class="setting-row"><span>No Knowledge folder selected</span></div>';
    return;
  }
  try {
    await invoke("init_arbor_db", { root: knowledgeRoot });
    const jobs = await invoke<JobSummary[]>("list_jobs", { root: knowledgeRoot, limit: 15 });
    if (jobs.length === 0) {
      jobsListEl.innerHTML = '<div class="setting-row"><span>No runs yet</span></div>';
      return;
    }
    updateInspectorStatus(jobs[0]);
    for (const job of jobs) {
      const row = document.createElement("div");
      row.className = "setting-row job-row";
      const label = document.createElement("span");
      label.textContent = job.started_at;
      const status = document.createElement("span");
      status.className = statusClass(job.status);
      status.textContent = job.error_summary ? `${job.status} (${job.error_summary})` : job.status;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Log";
      btn.addEventListener("click", () => void showJobLog(job.id));
      row.append(label, status, btn);
      jobsListEl.appendChild(row);
    }
  } catch (e) {
    jobsListEl.innerHTML = `<div class="setting-row"><span>Could not load jobs: ${e}</span></div>`;
  }
}

async function showJobLog(jobId: string) {
  if (!knowledgeRoot) return;
  const events = await invoke<JobEventRow[]>("get_job_events", { root: knowledgeRoot, jobId });
  jobsLogEl.hidden = false;
  jobsLogEl.textContent = events.map((e) => e.line).join("\n");
}

function setToggle(el: HTMLElement, on: boolean) {
  el.classList.toggle("off", !on);
}

async function loadKnowledgeSettingsUi() {
  if (!knowledgeRoot) return;
  try {
    const ks = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
    setToggle(toggleWatch, ks.watch_enabled);
    setToggle(toggleAuto, ks.auto_update);
    setToggle(toggleDelete, ks.delete_sources_after_digest);
    setToggle(toggleAutoFlashcards, ks.auto_generate.flashcards);
  } catch {
    /* settings file may not exist yet */
  }
}

async function saveKnowledgeSettings(partial: Partial<KnowledgeSettings>) {
  if (!knowledgeRoot) return;
  const current = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
  const next = { ...current, ...partial };
  await invoke("save_knowledge_settings", { root: knowledgeRoot, settings: next });
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  if (s.knowledge_root) {
    knowledgeRoot = s.knowledge_root;
    folderHintEl.textContent = shortenPath(s.knowledge_root);
    chooseBtn.textContent = "Change folder…";
    await invoke("start_folder_watch", { root: s.knowledge_root });
    await renderCourseList();
    await loadJobHistory();
    if (courses.length > 0) {
      setCourseView(courses[0], "notes");
    }
    refreshFolderTools();
  } else {
    setPlaceView("welcome");
  }
  await loadModels(s.model_id);
}

async function persist() {
  await invoke("save_settings", {
    settings: { knowledge_root: knowledgeRoot, model_id: modelSel.value || null } satisfies Settings,
  });
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
    codexLabelEl.textContent = "Checking Codex…";
    codexStatusEl.className = "auth-badge";
    docsLink.hidden = true;
    try {
      const a = await invoke<AuthStatus>("check_auth");
      authed = a.authenticated;
      if (a.authenticated) {
        codexLabelEl.textContent = "Codex connected";
        codexStatusEl.className = "auth-badge";
      } else {
        codexLabelEl.textContent = a.reason;
        codexStatusEl.className = "auth-badge bad";
        docsLink.href = a.docs_url;
        docsLink.hidden = false;
      }
    } catch (e) {
      authed = false;
      codexLabelEl.textContent = `Check failed`;
      codexStatusEl.className = "auth-badge bad";
    }
    refreshUpdateEnabled();
    refreshStudyEnabled();
  })().finally(() => {
    refreshAuthInFlight = null;
  });
  return refreshAuthInFlight;
}

async function pickFolder() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await activateKnowledgeRoot(picked);
  await persist();
}

chooseBtn.addEventListener("click", () => void pickFolder());
welcomeChooseBtn.addEventListener("click", () => void pickFolder());

navJobs.addEventListener("click", () => setPlaceView("jobs"));
navSettings.addEventListener("click", () => setPlaceView("settings"));

modeTabsEl.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest(".mode-tab") as HTMLElement | null;
  if (!tab || !currentCourse) return;
  setCourseView(currentCourse, tab.dataset.mode as Mode);
});

searchToggleBtn.addEventListener("click", () => {
  searchOverlayEl.classList.toggle("open");
  if (searchOverlayEl.classList.contains("open")) {
    searchInput.focus();
    void runSearch(searchInput.value);
  }
});

searchInput.addEventListener("input", () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  const query = searchInput.value;
  searchTimer = window.setTimeout(() => void runSearch(query), 250);
});

document.addEventListener("click", (e) => {
  if (!searchOverlayEl.contains(e.target as Node) && e.target !== searchToggleBtn) {
    searchOverlayEl.classList.remove("open");
  }
});

inspectorToggleBtn.addEventListener("click", () => {
  const open = inspectorBodyEl.classList.toggle("open");
  inspectorToggleBtn.textContent = open ? "Hide log ▾" : "Show log ▴";
});

toggleWatch.addEventListener("click", async () => {
  const on = toggleWatch.classList.contains("off");
  setToggle(toggleWatch, on);
  await saveKnowledgeSettings({ watch_enabled: on });
});

toggleAuto.addEventListener("click", async () => {
  const on = toggleAuto.classList.contains("off");
  setToggle(toggleAuto, on);
  await saveKnowledgeSettings({ auto_update: on });
});

toggleDelete.addEventListener("click", async () => {
  const on = toggleDelete.classList.contains("off");
  setToggle(toggleDelete, on);
  await saveKnowledgeSettings({ delete_sources_after_digest: on });
});

toggleAutoFlashcards.addEventListener("click", async () => {
  const on = toggleAutoFlashcards.classList.contains("off");
  setToggle(toggleAutoFlashcards, on);
  await saveKnowledgeSettings({ auto_generate: { flashcards: on } });
});

reindexBtn.addEventListener("click", async () => {
  if (!knowledgeRoot) return;
  try {
    const result = await invoke<{ documents: number }>("reindex_knowledge", { root: knowledgeRoot });
    logLine(`Reindexed ${result.documents} document(s).`);
    await runSearch(searchInput.value);
  } catch (e) {
    logLine(`Reindex failed: ${e}`);
  }
});

modelSel.addEventListener("change", () => {
  refreshStudyEnabled();
  void persist();
});

generateFlashcardsBtn.addEventListener("click", () => {
  void startFlashcardJob(false);
});

refreshFlashcardsBtn.addEventListener("click", () => {
  void startFlashcardJob(true);
});

flashcardFlipBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
  if (!flashcardReview.flipped) markCurrentFlashcardSeen();
  flashcardReview = flipReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardNextBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
  markCurrentFlashcardSeen();
  flashcardReview = nextReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardPrevBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
  flashcardReview = previousReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardShuffleBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
  flashcardReview = {
    cards: shuffleCards(flashcardReview.cards),
    index: 0,
    flipped: false,
  };
  renderCurrentFlashcard();
});

flashcardSourceBtn.addEventListener("click", () => {
  if (!flashcardReview || !flashcardCourse) return;
  const path = `${flashcardCourse}/${currentCard(flashcardReview).source.digest}`;
  setCourseView(flashcardCourse, "notes", path);
});

updateBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  logEl.textContent = "";
  openInspector();
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
  try {
    await startUpdateWithSelections(collectSelections());
  } catch (e) {
    logLine(`Could not read ranges: ${e}`);
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
      void renderCourseList().then(() => {
        if (currentCourse) void loadCourseContent(currentCourse);
      });
      void runSearch(searchInput.value);
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
      break;
    default:
      logLine(ev.message ? `${ev.type}: ${ev.message}` : ev.type);
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

async function handleJobFinished(finished: JobFinished) {
  const updateJobId = activeUpdateJobId;
  if (finished.job_id === activeUpdateJobId) activeUpdateJobId = null;
  studyJobRunning = false;
  refreshStudyEnabled();
  void loadJobHistory();
  if (currentCourse) void loadFlashcards(currentCourse);

  if (!knowledgeRoot || !currentCourse || updateJobId === null) return;
  const settings = await invoke<KnowledgeSettings>("get_knowledge_settings", {
    root: knowledgeRoot,
  });
  if (
    shouldAutoGenerateFlashcards(
      finished,
      updateJobId,
      settings.auto_generate.flashcards,
    )
  ) {
    await startFlashcardJob(false);
  }
}

listen<JobFinished>("arbor://job-finished", (event) => {
  void handleJobFinished(event.payload);
});

listen<{ root: string }>("arbor://files-changed", (e) => {
  if (knowledgeRoot && e.payload.root === knowledgeRoot) void handleWatchTriggered();
});

window.addEventListener("focus", () => void refreshAuth());

(async () => {
  await loadSettings();
  await refreshAuth();
  refreshFolderTools();
})();
