import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { hasTauriInvoke, TAURI_UNAVAILABLE } from "./tauri";
import {
  advanceAfterGrade,
  createReview,
  currentCard,
  flashcardJobArgs,
  flipReview,
  gradeFlashcard,
  nextReview,
  parseFlashcardDeck,
  parseFlashcardProgress,
  previousReview,
  shouldAutoGenerateFlashcards,
  shuffleCards,
} from "./flashcards";
import {
  createReview as createQuizReview,
  currentQuestion,
  nextReview as nextQuizReview,
  parseQuizPack,
  parseQuizProgress,
  previousReview as previousQuizReview,
  quizJobArgs,
  selectChoice,
  shouldAutoGenerateQuiz,
  submitChoice,
} from "./quiz";
import {
  conceptJobArgs,
  diagramJobArgs,
  neighbors,
  nodesForDigest,
  parseConceptGraph,
} from "./concepts";
import {
  citationJobArgs,
  failedIdsFor,
  parseCitationsReport,
} from "./citations";
import { headingId, renderMarkdown } from "./markdown";
import { parseAppearance, resolvedTheme } from "./theme";
import type {
  Appearance,
  AuthStatus,
  ConceptGraph,
  DigestInfo,
  FlashcardProgress,
  FlashcardReview,
  JobEventRow,
  JobFinished,
  JobSummary,
  KnowledgeSettings,
  Mode,
  Model,
  PendingSource,
  QuizProgress,
  QuizReview,
  SearchHit,
  Selection,
  Settings,
  UpdatePlan,
  WorkerEvent,
  CitationsReport,
} from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInvoke(window)) {
    return Promise.reject(new Error(TAURI_UNAVAILABLE));
  }
  return tauriInvoke<T>(cmd, args);
}

function listen<T>(event: string, handler: (event: { payload: T }) => void) {
  if (!hasTauriInvoke(window)) {
    return Promise.reject(new Error(TAURI_UNAVAILABLE));
  }
  return tauriListen<T>(event, handler);
}

function open(opts: Parameters<typeof tauriOpen>[0]) {
  if (!hasTauriInvoke(window)) {
    return Promise.reject(new Error(TAURI_UNAVAILABLE));
  }
  return tauriOpen(opts);
}

type Place = "welcome" | "course" | "jobs" | "settings";

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
const addCourseBtn = $("add-course") as HTMLButtonElement;
const addCourseForm = $("add-course-form") as HTMLFormElement;
const addCourseNameEl = $("add-course-name") as HTMLInputElement;
const addFilesBtn = $("add-files") as HTMLButtonElement;
const appearanceSel = $("appearance") as HTMLSelectElement;
const flashcardsCopyEl = $("flashcards-copy");
const flashcardsEmptyEl = $("flashcards-empty");
const flashcardsDeckEl = $("flashcards-deck");
const generateFlashcardsBtn = $("generate-flashcards") as HTMLButtonElement;
const refreshFlashcardsBtn = $("refresh-flashcards") as HTMLButtonElement;
const flashcardStaleEl = $("flashcard-stale");
const flashcardCountEl = $("flashcard-count");
const flashcardFaceEl = $("flashcard-face");
const flashcardSourceBtn = $("flashcard-source") as HTMLButtonElement;
const flashcardCitationEl = $("flashcard-citation");
const flashcardTagsEl = $("flashcard-tags");
const flashcardPrevBtn = $("flashcard-prev");
const flashcardFlipBtn = $("flashcard-flip");
const flashcardAgainBtn = $("flashcard-again") as HTMLButtonElement;
const flashcardWrongBtn = $("flashcard-wrong") as HTMLButtonElement;
const flashcardMasteredBtn = $("flashcard-mastered") as HTMLButtonElement;
const flashcardNextBtn = $("flashcard-next");
const flashcardShuffleBtn = $("flashcard-shuffle");
const quizCopyEl = $("quiz-copy");
const quizEmptyEl = $("quiz-empty");
const quizPackEl = $("quiz-pack");
const generateQuizBtn = $("generate-quiz") as HTMLButtonElement;
const refreshQuizBtn = $("refresh-quiz") as HTMLButtonElement;
const quizStaleEl = $("quiz-stale");
const quizCountEl = $("quiz-count");
const quizPromptEl = $("quiz-prompt");
const quizChoiceBtns = [0, 1, 2, 3].map(
  (index) => $(`quiz-choice-${index}`) as HTMLButtonElement,
);
const quizSubmitBtn = $("quiz-submit") as HTMLButtonElement;
const quizExplanationEl = $("quiz-explanation");
const quizSourceBtn = $("quiz-source") as HTMLButtonElement;
const quizCitationEl = $("quiz-citation");
const quizPrevBtn = $("quiz-prev");
const quizNextBtn = $("quiz-next");
const conceptsCopyEl = $("concepts-copy");
const conceptsEmptyEl = $("concepts-empty");
const conceptsGraphEl = $("concepts-graph");
const generateConceptsBtn = $("generate-concepts") as HTMLButtonElement;
const generateDiagramsBtn = $("generate-diagrams") as HTMLButtonElement;
const refreshConceptsBtn = $("refresh-concepts") as HTMLButtonElement;
const refreshDiagramsBtn = $("refresh-diagrams") as HTMLButtonElement;
const conceptStaleEl = $("concept-stale");
const conceptCountEl = $("concept-count");
const conceptListEl = $("concept-list");
const conceptNameEl = $("concept-name");
const conceptSummaryEl = $("concept-summary");
const conceptNeighborsEl = $("concept-neighbors");
const conceptSourcesEl = $("concept-sources");
const notesConceptChipsEl = $("notes-concept-chips");
const generateCitationsBtn = $("generate-citations") as HTMLButtonElement;
const jobsListEl = $("jobs-list");
const jobsLogEl = $("jobs-log");
const modelSel = $("model") as HTMLSelectElement;
const toggleWatch = $("toggle-watch");
const toggleAuto = $("toggle-auto");
const toggleEmbed = $("toggle-embed");
const toggleDelete = $("toggle-delete");
const toggleAutoFlashcards = $("toggle-auto-flashcards");
const toggleAutoQuiz = $("toggle-auto-quiz");
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
const searchSemanticInput = $<HTMLInputElement>("search-semantic");
const searchResultsEl = $("search-results");

let knowledgeRoot: string | null = null;
let appearance: Appearance = "system";
let authed = false;
let activeUpdateJobId: string | null = null;
let studyJobRunning = false;
let pendingAutoEmbed = false;
let pendingAutoQuiz = false;
let searchTimer: number | null = null;
let suppressWatchUntil = 0;
let currentPlace: Place = "welcome";
let currentCourse: string | null = null;
let currentMode: Mode = "notes";
let courses: string[] = [];
let flashcardReview: FlashcardReview | null = null;
let flashcardProgress: FlashcardProgress = {};
let flashcardCourse: string | null = null;
let quizReview: QuizReview | null = null;
let quizProgress: QuizProgress = {};
let quizCourse: string | null = null;
let progressWrite = Promise.resolve();
let conceptGraph: ConceptGraph | null = null;
let selectedConceptId: string | null = null;
let currentNotesPath: string | null = null;
let citationsReport: CitationsReport | null = null;

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

function setCourseView(
  course: string,
  mode: Mode = currentMode,
  notesPath?: string,
  heading?: string | null,
) {
  currentPlace = "course";
  currentCourse = course;
  currentMode = mode;
  courseTitleEl.textContent = course;
  courseHeaderEl.hidden = false;
  inspectorEl.hidden = false;
  flashcardsCopyEl.textContent = `Study decks generated from your ${course} digests. Flip cards, track progress, and shuffle for review.`;
  quizCopyEl.textContent = `Practice questions pulled from your ${course} material. Test yourself before the exam.`;
  conceptsCopyEl.textContent = `Concepts linked across your ${course} digests.`;
  modeTabsEl.querySelectorAll(".mode-tab").forEach((t) => {
    t.classList.toggle("active", (t as HTMLElement).dataset.mode === mode);
  });
  showPanel(mode);
  setNavActive("course", course);
  refreshFolderTools();
  if (mode === "notes") void loadCourseContent(course, notesPath, heading);
  if (mode === "flashcards") void loadFlashcards(course);
  if (mode === "quiz") void loadQuiz(course);
  if (mode === "graph") void loadGraph(course);
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
  generateQuizBtn.disabled = !enabled;
  refreshQuizBtn.disabled = !enabled;
  generateConceptsBtn.disabled = !enabled;
  generateDiagramsBtn.disabled = !enabled;
  refreshConceptsBtn.disabled = !enabled;
  refreshDiagramsBtn.disabled = !enabled;
  generateCitationsBtn.disabled = !enabled;
}

function refreshFolderTools() {
  const ready = Boolean(knowledgeRoot);
  searchToggleBtn.disabled = !ready;
  reindexBtn.disabled = !ready;
  addCourseBtn.disabled = !ready;
  addFilesBtn.disabled = !(ready && currentCourse);
  refreshUpdateEnabled();
  refreshStudyEnabled();
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme() {
  const theme = resolvedTheme(appearance, systemPrefersDark());
  document.documentElement.dataset.theme = theme;
  if (appearanceSel.value !== appearance) appearanceSel.value = appearance;
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
    courseListEl.innerHTML = '<p class="nav-empty">No classes yet</p>';
    return;
  }
  for (const course of courses) {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.dataset.place = "course";
    btn.dataset.course = course;
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = "◈";
    btn.append(icon, document.createTextNode(` ${course}`));
    btn.addEventListener("click", () => setCourseView(course, "notes"));
    courseListEl.appendChild(btn);
  }
}

function scrollNotesToHeading(heading: string | null | undefined) {
  const pane = document.querySelector(".reading-pane");
  const id = heading ? headingId(heading) : "";
  const target = id ? readingArticleEl.querySelector(`[id="${id}"]`) : null;
  if (target) {
    target.scrollIntoView({ block: "start" });
    return;
  }
  pane?.scrollTo(0, 0);
}

async function loadDigestPreview(
  course: string,
  relativePath: string,
  heading?: string | null,
) {
  if (!knowledgeRoot) return;
  currentNotesPath = relativePath;
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
    const isCourseIndex = relativePath.endsWith("/course.md");
    readingArticleEl.innerHTML = isCourseIndex
      ? `<p class="reading-empty">No notes yet. Add lecture files, then Update knowledge.</p>`
      : `<p class="reading-empty">Could not load file: ${e}</p>`;
  }
  await renderNotesConceptChips(course, relativePath);
  scrollNotesToHeading(heading);
}

async function loadCourseContent(
  course: string,
  initialPath?: string,
  heading?: string | null,
) {
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
      const titleEl = document.createElement("span");
      titleEl.className = "name";
      titleEl.textContent = d.title;
      const dateEl = document.createElement("span");
      dateEl.className = "date";
      dateEl.textContent = d.date;
      btn.append(titleEl, dateEl);
      btn.addEventListener("click", () => void loadDigestPreview(course, d.path));
      digestListEl.appendChild(btn);
    }
    const first = initialPath ?? (digests.length > 0 ? digests[0].path : courseMdPath);
    await loadDigestPreview(course, first, heading);
  } catch {
    await loadDigestPreview(course, courseMdPath, heading);
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
  const failed = failedIdsFor(citationsReport, "study/flashcards.json");
  flashcardCitationEl.hidden = !failed.has(card.id);
  flashcardCitationEl.title = citationsReport?.failures.find(
    (failure) => failure.path === "study/flashcards.json" && failure.id === card.id,
  )?.reason ?? "";
  const gradesHidden = !flashcardReview.flipped;
  flashcardAgainBtn.hidden = gradesHidden;
  flashcardWrongBtn.hidden = gradesHidden;
  flashcardMasteredBtn.hidden = gradesHidden;
}

async function loadFlashcards(course: string) {
  if (!knowledgeRoot) return;
  const root = knowledgeRoot;
  await loadCitations(course);
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

function gradeCurrentFlashcard(grade: "again" | "wrong" | "mastered") {
  if (!flashcardReview || !flashcardReview.flipped) return;
  flashcardProgress = gradeFlashcard(
    flashcardProgress,
    currentCard(flashcardReview).id,
    grade,
  );
  persistFlashcardProgress();
  flashcardReview = advanceAfterGrade(flashcardReview);
  renderCurrentFlashcard();
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

function renderCurrentQuiz() {
  if (!quizReview) return;
  const question = currentQuestion(quizReview);
  quizCountEl.textContent = `${quizReview.index + 1} of ${quizReview.questions.length}`;
  quizPromptEl.textContent = question.prompt;
  quizChoiceBtns.forEach((button, index) => {
    button.textContent = question.choices[index];
    button.classList.toggle("selected", quizReview?.selected === index);
    button.classList.toggle(
      "correct",
      Boolean(quizReview?.submitted && index === question.answer_index),
    );
    button.classList.toggle(
      "wrong",
      Boolean(
        quizReview?.submitted &&
          quizReview.selected === index &&
          index !== question.answer_index,
      ),
    );
  });
  quizExplanationEl.hidden = !quizReview.submitted;
  quizExplanationEl.textContent = quizReview.submitted ? question.explanation : "";
  quizSourceBtn.textContent = question.source.heading
    ? `${question.source.digest} · ${question.source.heading}`
    : question.source.digest;
  quizSubmitBtn.disabled = quizReview.submitted || quizReview.selected === null;
  const failed = failedIdsFor(citationsReport, "study/quiz.json");
  quizCitationEl.hidden = !failed.has(question.id);
  quizCitationEl.title = citationsReport?.failures.find(
    (failure) => failure.path === "study/quiz.json" && failure.id === question.id,
  )?.reason ?? "";
}

async function loadQuiz(course: string) {
  if (!knowledgeRoot) return;
  const root = knowledgeRoot;
  await loadCitations(course);
  try {
    const packValue = await invoke<unknown>("read_study_json", {
      root,
      course,
      file: "quiz.json",
    });
    const pack = parseQuizPack(packValue);
    if (pack.course !== course) throw new Error(`Pack course is ${pack.course}`);
    const progressValue = await invoke<unknown>("read_quiz_progress", {
      root,
      course,
    });
    const stale = await invoke<boolean>("study_artifact_stale", {
      root,
      course,
      skill: "quiz",
    });
    if (currentCourse !== course) return;
    quizReview = createQuizReview(pack);
    quizProgress = parseQuizProgress(progressValue);
    quizCourse = course;
    quizEmptyEl.hidden = true;
    quizPackEl.hidden = false;
    quizStaleEl.hidden = !stale;
    renderCurrentQuiz();
  } catch {
    if (currentCourse !== course) return;
    quizReview = null;
    quizProgress = {};
    quizCourse = course;
    quizEmptyEl.hidden = false;
    quizPackEl.hidden = true;
    quizCopyEl.textContent = `No quiz yet for ${course}. Generate questions from your digests.`;
  }
  refreshStudyEnabled();
}

async function readConceptGraph(course: string): Promise<ConceptGraph | null> {
  if (!knowledgeRoot) return null;
  try {
    const value = await invoke<unknown>("read_study_json", {
      root: knowledgeRoot,
      course,
      file: "concepts.json",
    });
    return parseConceptGraph(value);
  } catch {
    return null;
  }
}

async function renderNotesConceptChips(course: string, relativePath: string) {
  notesConceptChipsEl.innerHTML = "";
  const graph = await readConceptGraph(course);
  if (!graph) {
    notesConceptChipsEl.hidden = true;
    return;
  }
  const related = nodesForDigest(graph, relativePath);
  if (related.length === 0) {
    notesConceptChipsEl.hidden = true;
    return;
  }
  notesConceptChipsEl.hidden = false;
  for (const node of related) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = node.kind === "figure" ? "source-chip figure-chip" : "source-chip";
    btn.textContent = node.name;
    btn.addEventListener("click", () => {
      selectedConceptId = node.id;
      setCourseView(course, "graph");
    });
    notesConceptChipsEl.appendChild(btn);
  }
}

function renderConceptGraph() {
  if (!conceptGraph || !selectedConceptId) return;
  const selected =
    conceptGraph.nodes.find((node) => node.id === selectedConceptId) ??
    conceptGraph.nodes[0];
  selectedConceptId = selected.id;
  conceptCountEl.textContent = `${conceptGraph.nodes.length} concepts`;
  conceptListEl.innerHTML = "";
  for (const node of conceptGraph.nodes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      node.kind === "figure" ? "concept-list-item figure" : "concept-list-item";
    btn.classList.toggle("active", node.id === selected.id);
    const conceptFailed = failedIdsFor(citationsReport, "study/concepts.json");
    btn.textContent = node.kind === "figure" ? `Figure · ${node.name}` : node.name;
    if (conceptFailed.has(node.id)) btn.classList.add("unverified");
    btn.addEventListener("click", () => {
      selectedConceptId = node.id;
      renderConceptGraph();
    });
    conceptListEl.appendChild(btn);
  }
  conceptNameEl.textContent =
    selected.kind === "figure" ? `Figure · ${selected.name}` : selected.name;
  conceptSummaryEl.textContent = selected.summary;
  conceptNeighborsEl.innerHTML = "";
  for (const neighbor of neighbors(conceptGraph, selected.id)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "concept-neighbor";
    btn.textContent = `${neighbor.name} · ${neighbor.relation}`;
    btn.addEventListener("click", () => {
      selectedConceptId = neighbor.id;
      renderConceptGraph();
    });
    conceptNeighborsEl.appendChild(btn);
  }
  conceptSourcesEl.innerHTML = "";
  for (const source of selected.sources) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "source-chip";
    btn.textContent = source.heading
      ? `${source.digest} · ${source.heading}`
      : source.digest;
    btn.addEventListener("click", () => {
      if (!currentCourse) return;
      setCourseView(
        currentCourse,
        "notes",
        `${currentCourse}/${source.digest}`,
        source.heading,
      );
    });
    conceptSourcesEl.appendChild(btn);
  }
}

async function loadGraph(course: string) {
  const root = knowledgeRoot;
  if (!root) return;
  await loadCitations(course);
  try {
    const graph = await readConceptGraph(course);
    if (!graph) throw new Error("no concept graph");
    if (graph.course !== course) throw new Error(`Graph course is ${graph.course}`);
    const stale = await invoke<boolean>("study_artifact_stale", {
      root,
      course,
      skill: "concepts",
    });
    if (currentCourse !== course) return;
    conceptGraph = graph;
    if (
      !selectedConceptId ||
      !graph.nodes.some((node) => node.id === selectedConceptId)
    ) {
      selectedConceptId = graph.nodes[0].id;
    }
    conceptsEmptyEl.hidden = true;
    conceptsGraphEl.hidden = false;
    conceptStaleEl.hidden = !stale;
    renderConceptGraph();
  } catch {
    if (currentCourse !== course) return;
    conceptGraph = null;
    conceptsEmptyEl.hidden = false;
    conceptsGraphEl.hidden = true;
    conceptsCopyEl.textContent = `No concept graph yet for ${course}. Generate concepts from your digests.`;
  }
  refreshStudyEnabled();
}

function persistQuizProgress() {
  if (!knowledgeRoot || !quizCourse) return;
  const root = knowledgeRoot;
  const course = quizCourse;
  const data = quizProgress;
  progressWrite = progressWrite
    .then(() => invoke<void>("write_quiz_progress", { root, course, data }))
    .catch((error) => logLine(`Could not save quiz progress: ${error}`));
}

async function startQuizJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      quizJobArgs(knowledgeRoot, currentCourse, force, modelSel.value),
    );
    logLine(`Quiz job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Quiz generation failed to start: ${error}`);
  }
}

async function startConceptJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      conceptJobArgs(knowledgeRoot, currentCourse, force, modelSel.value),
    );
    logLine(`Concept job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Concept generation failed to start: ${error}`);
  }
}

async function startDiagramJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      diagramJobArgs(knowledgeRoot, currentCourse, force, modelSel.value),
    );
    logLine(`Diagram job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Diagram generation failed to start: ${error}`);
  }
}

async function loadCitations(course: string) {
  if (!knowledgeRoot) {
    citationsReport = null;
    return;
  }
  try {
    const value = await invoke<unknown>("read_study_json", {
      root: knowledgeRoot,
      course,
      file: "citations.json",
    });
    citationsReport = parseCitationsReport(value);
  } catch {
    citationsReport = null;
  }
}

async function startCitationJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (!authed) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      citationJobArgs(knowledgeRoot, currentCourse, force, modelSel.value),
    );
    logLine(`Citations job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Citation check failed to start: ${error}`);
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
    readingArticleEl.innerHTML = '<p class="reading-empty">Add a class with +, then add lecture files to it.</p>';
  }
}

async function runSearch(query: string) {
  if (!knowledgeRoot || !query.trim()) {
    searchResultsEl.innerHTML = '<div class="search-empty">Type to search digests</div>';
    return;
  }
  const command = searchSemanticInput.checked
    ? "search_semantic"
    : "search_knowledge";
  const hits = await invoke<SearchHit[]>(command, {
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

async function presentUpdatePlan(reason: "watch" | "import") {
  if (!knowledgeRoot) return;
  const ks = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
  try {
    const plan = await invoke<UpdatePlan>("plan_update", { root: knowledgeRoot });
    if (plan.pending.length === 0) return;
    logLine(
      reason === "watch"
        ? `Folder watch detected ${plan.pending.length} file(s) to process.`
        : `Added files. ${plan.pending.length} file(s) to process.`,
    );
    openInspector();
    if (ks.auto_update) {
      await refreshAuth();
      if (!authed) {
        renderReview(plan.pending);
        logLine("Auto-update waiting for Codex auth. Review and Confirm when ready.");
        return;
      }
      await startUpdateWithSelections(
        selectionsFromPending(plan.pending),
        reason === "watch" ? "watch" : "manual",
      );
      return;
    }
    renderReview(plan.pending);
    logLine("Review the detected files and Confirm when ready.");
  } catch (e) {
    logLine(reason === "watch" ? `Watch plan failed: ${e}` : `Plan failed: ${e}`);
  }
}

async function handleWatchTriggered() {
  if (!knowledgeRoot) return;
  if (Date.now() < suppressWatchUntil) return;
  const ks = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
  if (!ks.watch_enabled) return;
  await presentUpdatePlan("watch");
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
    setToggle(toggleEmbed, ks.auto_embed);
    setToggle(toggleDelete, ks.delete_sources_after_digest);
    setToggle(toggleAutoFlashcards, ks.auto_generate.flashcards);
    setToggle(toggleAutoQuiz, ks.auto_generate.quiz);
  } catch {
    /* settings file may not exist yet */
  }
}

async function saveKnowledgeSettings(
  partial: Omit<Partial<KnowledgeSettings>, "auto_generate"> & {
    auto_generate?: Partial<KnowledgeSettings["auto_generate"]>;
  },
) {
  if (!knowledgeRoot) return;
  const current = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
  const next: KnowledgeSettings = {
    ...current,
    ...partial,
    auto_generate: {
      ...current.auto_generate,
      ...(partial.auto_generate ?? {}),
    },
  };
  await invoke("save_knowledge_settings", { root: knowledgeRoot, settings: next });
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  appearance = s.appearance ?? "system";
  appearanceSel.value = appearance;
  applyTheme();
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
  try {
    await loadModels(s.model_id);
  } catch (error) {
    modelSel.innerHTML = "";
    logLine(`Could not load models: ${error}`);
  }
}

async function persist() {
  await invoke("save_settings", {
    settings: {
      knowledge_root: knowledgeRoot,
      model_id: modelSel.value || null,
      appearance,
    } satisfies Settings,
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
      const detail = String(e).trim();
      codexLabelEl.textContent = detail || "Check failed";
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
  try {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    await activateKnowledgeRoot(picked);
    await persist();
  } catch (error) {
    logLine(`Could not choose folder: ${error}`);
  }
}

async function createCourseFromForm() {
  if (!knowledgeRoot) return;
  const name = addCourseNameEl.value.trim();
  if (!name) {
    addCourseNameEl.focus();
    return;
  }
  try {
    const course = await invoke<string>("create_course", { root: knowledgeRoot, name });
    addCourseForm.hidden = true;
    addCourseNameEl.value = "";
    await renderCourseList();
    setCourseView(course, "notes");
  } catch (error) {
    addCourseNameEl.setCustomValidity(String(error));
    addCourseNameEl.reportValidity();
    addCourseNameEl.setCustomValidity("");
  }
}

async function importLectureFiles() {
  if (!knowledgeRoot || !currentCourse) return;
  const picked = await open({
    multiple: true,
    filters: [{ name: "Lecture files", extensions: ["pdf", "pptx", "docx"] }],
  });
  const paths = typeof picked === "string" ? [picked] : picked;
  if (!paths || paths.length === 0) return;
  try {
    const imported = await invoke<string[]>("import_sources", {
      root: knowledgeRoot,
      course: currentCourse,
      paths,
    });
    logLine(
      imported.length === 1
        ? `Added ${imported[0]} to ${currentCourse}.`
        : `Added ${imported.length} files to ${currentCourse}.`,
    );
    inspectorEl.hidden = false;
    suppressWatchUntil = Date.now() + 4000;
    await presentUpdatePlan("import");
  } catch (error) {
    logLine(`Could not add files: ${error}`);
    inspectorEl.hidden = false;
  }
}

chooseBtn.addEventListener("click", () => void pickFolder());
welcomeChooseBtn.addEventListener("click", () => void pickFolder());

appearanceSel.addEventListener("change", () => {
  const next = parseAppearance(appearanceSel.value);
  if (!next) return;
  appearance = next;
  applyTheme();
  void persist();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (appearance === "system") applyTheme();
});

addCourseBtn.addEventListener("click", () => {
  if (addCourseBtn.disabled) return;
  addCourseForm.hidden = !addCourseForm.hidden;
  if (!addCourseForm.hidden) {
    addCourseNameEl.value = "";
    addCourseNameEl.focus();
  }
});

addCourseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createCourseFromForm();
});

addCourseNameEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    addCourseForm.hidden = true;
  }
});

addFilesBtn.addEventListener("click", () => void importLectureFiles());

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

searchSemanticInput.addEventListener("change", () => {
  void runSearch(searchInput.value);
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

toggleEmbed.addEventListener("click", async () => {
  const on = toggleEmbed.classList.contains("off");
  setToggle(toggleEmbed, on);
  await saveKnowledgeSettings({ auto_embed: on });
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

toggleAutoQuiz.addEventListener("click", async () => {
  const on = toggleAutoQuiz.classList.contains("off");
  setToggle(toggleAutoQuiz, on);
  await saveKnowledgeSettings({ auto_generate: { quiz: on } });
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

generateQuizBtn.addEventListener("click", () => {
  void startQuizJob(false);
});

refreshQuizBtn.addEventListener("click", () => {
  void startQuizJob(true);
});

generateConceptsBtn.addEventListener("click", () => {
  void startConceptJob(false);
});

refreshConceptsBtn.addEventListener("click", () => {
  void startConceptJob(true);
});

generateDiagramsBtn.addEventListener("click", () => {
  void startDiagramJob(false);
});

refreshDiagramsBtn.addEventListener("click", () => {
  void startDiagramJob(true);
});

generateCitationsBtn.addEventListener("click", () => {
  void startCitationJob(true);
});

flashcardFlipBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
  flashcardReview = flipReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardAgainBtn.addEventListener("click", () => {
  gradeCurrentFlashcard("again");
});

flashcardWrongBtn.addEventListener("click", () => {
  gradeCurrentFlashcard("wrong");
});

flashcardMasteredBtn.addEventListener("click", () => {
  gradeCurrentFlashcard("mastered");
});

flashcardNextBtn.addEventListener("click", () => {
  if (!flashcardReview) return;
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
  const card = currentCard(flashcardReview);
  setCourseView(
    flashcardCourse,
    "notes",
    `${flashcardCourse}/${card.source.digest}`,
    card.source.heading,
  );
});

quizChoiceBtns.forEach((button) => {
  button.addEventListener("click", () => {
    if (!quizReview) return;
    const index = Number(button.dataset.index);
    quizReview = selectChoice(quizReview, index);
    renderCurrentQuiz();
  });
});

quizSubmitBtn.addEventListener("click", () => {
  if (!quizReview || quizReview.selected === null) return;
  const result = submitChoice(quizReview, quizReview.selected, quizProgress);
  quizReview = result.review;
  quizProgress = result.progress;
  persistQuizProgress();
  renderCurrentQuiz();
});

quizNextBtn.addEventListener("click", () => {
  if (!quizReview) return;
  quizReview = nextQuizReview(quizReview);
  renderCurrentQuiz();
});

quizPrevBtn.addEventListener("click", () => {
  if (!quizReview) return;
  quizReview = previousQuizReview(quizReview);
  renderCurrentQuiz();
});

quizSourceBtn.addEventListener("click", () => {
  if (!quizReview || !quizCourse) return;
  const question = currentQuestion(quizReview);
  setCourseView(
    quizCourse,
    "notes",
    `${quizCourse}/${question.source.digest}`,
    question.source.heading,
  );
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
    case "embed_started":
      logLine("Embedding digests…");
      break;
    case "embed_done":
      logLine(
        `Embedded ${ev.embedded ?? 0} digest(s) into ${ev.chunks ?? 0} chunk(s); skipped ${ev.skipped ?? 0}.`,
      );
      void runSearch(searchInput.value);
      break;
    case "embed_failed":
      logLine(`Embedding failed: ${ev.message}`);
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
    case "skill_started":
      logLine(`Study ${ev.skill ?? "skill"} started`);
      break;
    case "skill_progress":
      logLine(
        `Study ${ev.skill ?? "skill"} retry ${ev.attempt ?? "?"}/${ev.attempts ?? "?"}${ev.message ? `: ${ev.message}` : ""}`,
      );
      break;
    case "skill_done":
      logLine(`Study ${ev.skill ?? "skill"} wrote ${ev.file ?? "artifact"}`);
      break;
    case "skill_failed":
      logLine(`Study ${ev.skill ?? "skill"} failed${ev.message ? `: ${ev.message}` : ""}`);
      break;
    case "skill_stale_skipped":
      logLine(`Study ${ev.skill ?? "skill"} unchanged`);
      break;
    case "citation_failed":
      logLine(
        `Citation failed ${ev.path ?? "artifact"} ${ev.id ?? ""}: ${ev.reason ?? ""}`,
      );
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

function subscribeWorkerEvents() {
  void listen<{ line: string }>("arbor://progress", (e) => {
    try {
      renderEvent(JSON.parse(e.payload.line) as WorkerEvent);
    } catch {
      logLine(e.payload.line);
    }
  });
  void listen<JobFinished>("arbor://job-finished", (event) => {
    void handleJobFinished(event.payload);
  });
  void listen<{ root: string }>("arbor://files-changed", (e) => {
    if (knowledgeRoot && e.payload.root === knowledgeRoot) void handleWatchTriggered();
  });
}

async function startEmbedJob(root: string) {
  try {
    const jobId = await invoke<string>("start_embed_job", {
      root,
      force: false,
    });
    logLine(`Embedding job ${jobId} started.`);
  } catch (error) {
    logLine(`Embedding failed to start: ${error}`);
  }
}

async function handleJobFinished(finished: JobFinished) {
  const updateJobId = activeUpdateJobId;
  if (finished.job_id === activeUpdateJobId) activeUpdateJobId = null;
  studyJobRunning = false;
  refreshStudyEnabled();
  void loadJobHistory();
  if (currentCourse) {
    void loadFlashcards(currentCourse);
    void loadQuiz(currentCourse);
    void loadCitations(currentCourse);
    if (currentMode === "graph") void loadGraph(currentCourse);
    if (currentMode === "notes" || currentNotesPath) {
      void loadCourseContent(currentCourse, currentNotesPath ?? undefined);
    }
  }

  if (finished.status !== "succeeded") {
    if (finished.operation === "generate") {
      pendingAutoQuiz = false;
      pendingAutoEmbed = false;
    }
    return;
  }
  if (!knowledgeRoot || (finished.root && finished.root !== knowledgeRoot)) return;

  const settings = await invoke<KnowledgeSettings>("get_knowledge_settings", {
    root: knowledgeRoot,
  });
  if (updateJobId !== null && finished.job_id === updateJobId) {
    pendingAutoQuiz = shouldAutoGenerateQuiz(
      finished,
      updateJobId,
      settings.auto_generate.quiz,
    );
    pendingAutoEmbed = settings.auto_embed;
  }

  if (
    currentCourse &&
    shouldAutoGenerateFlashcards(
      finished,
      updateJobId,
      settings.auto_generate.flashcards,
    )
  ) {
    await startFlashcardJob(false);
    return;
  }

  if (pendingAutoQuiz && currentCourse) {
    pendingAutoQuiz = false;
    await startQuizJob(false);
    return;
  }

  if (pendingAutoEmbed) {
    pendingAutoEmbed = false;
    await startEmbedJob(knowledgeRoot);
  }
}

function showDesktopOnlyMessage() {
  const copy = document.querySelector("#panel-welcome .welcome p");
  if (copy) {
    copy.textContent =
      "This is the Vite dev server. Open the Arbor desktop window; a browser tab cannot talk to the worker.";
  }
  logLine(TAURI_UNAVAILABLE);
}

(async () => {
  if (!hasTauriInvoke(window)) {
    showDesktopOnlyMessage();
    return;
  }
  window.addEventListener("focus", () => void refreshAuth());
  subscribeWorkerEvents();
  try {
    await loadSettings();
  } catch (error) {
    logLine(`Could not load settings: ${error}`);
  }
  await refreshAuth();
  refreshFolderTools();
})();
