import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import {
  confirm as tauriConfirm,
  open as tauriOpen,
} from "@tauri-apps/plugin-dialog";
import { hasTauriInvoke, TAURI_UNAVAILABLE } from "./tauri";
import {
  advanceAfterGrade,
  applyGradeToDueIds,
  cardsForIds,
  createReview,
  currentCard,
  dropCurrentCard,
  flashcardJobArgs,
  flipReview,
  nextReview,
  parseFlashcardDeck,
  previousReview,
  requeueCurrentCard,
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
  sessionScore,
  shouldAutoGenerateQuiz,
  submitChoice,
} from "./quiz";
import {
  conceptJobArgs,
  diagramJobArgs,
  neighbors,
  nodesForDigest,
  notePathForStudyDigest,
  parseConceptGraph,
} from "./concepts";
import {
  citationJobArgs,
  failedIdsFor,
  parseCitationsReport,
} from "./citations";
import {
  buildAssistantLine,
  buildSessionLine,
  buildUserLine,
  chatNotePath,
  citationLabel,
  renderAnswerHtml,
  type ChatCitation,
  type ChatLine,
  type ChatMode,
  unsupportedBanner,
  visibleTranscript,
  workerHistory,
} from "./chat";
import { headingId, renderMarkdown } from "./markdown";
import { renderSearchHit } from "./search-hit";
import { pickerProviders, providerBadge, signedOutJobMessage } from "./provider";
import { parseAppearance, resolvedTheme } from "./theme";
import type {
  Appearance,
  AuthStatus,
  ConceptGraph,
  DigestInfo,
  FlashcardDeck,
  FlashcardReview,
  JobEventRow,
  JobFinished,
  JobSummary,
  KnowledgeSettings,
  SyncConflictFile,
  SyncConflictSession,
  SyncShowResult,
  SyncWorkerResult,
  Mode,
  Model,
  ProviderInfo,
  PendingSource,
  QuizProgress,
  QuizReview,
  SearchHit,
  Selection,
  KnowledgeRootEntry,
  KnowledgeKind,
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

function confirm(message: string, options?: string | Parameters<typeof tauriConfirm>[1]) {
  if (!hasTauriInvoke(window)) {
    return Promise.reject(new Error(TAURI_UNAVAILABLE));
  }
  return tauriConfirm(message, options);
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
const providerStatusEl = $("provider-status");
const providerLabelEl = $("provider-label");
const docsLink = $("provider-docs") as HTMLAnchorElement;
const digestListEl = $("digest-list");
const courseIndexLink = $("course-index-link");
const readingArticleEl = $("reading-article");
const addCourseBtn = $("add-course") as HTMLButtonElement;
const addCourseForm = $("add-course-form") as HTMLFormElement;
const addCourseNameEl = $("add-course-name") as HTMLInputElement;
const addCourseErrorEl = $("add-course-error");
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
const flashcardDueBtn = $("flashcard-due") as HTMLButtonElement;
const flashcardAllBtn = $("flashcard-all") as HTMLButtonElement;
const weakTopicsEl = $("weak-topics");
const weakTopicListEl = $("weak-topic-list");
const studyOverviewEl = $("study-overview");
const studyPlanExamEl = $("study-plan-exam") as HTMLInputElement;
const studyPlanGenerateBtn = $("study-plan-generate") as HTMLButtonElement;
const studyPlanStatusEl = $("study-plan-status");
const studyPlanBodyEl = $("study-plan-body");
const studyRecommendationListEl = $("study-recommendation-list");
const explainWeakestBtn = $("explain-weakest") as HTMLButtonElement;
const notesActionsEl = $("notes-actions");
const makeCardBtn = $("make-card") as HTMLButtonElement;
const makeCardDialogEl = $("make-card-dialog") as HTMLDialogElement;
const makeCardFrontEl = $("make-card-front") as HTMLTextAreaElement;
const makeCardBackEl = $("make-card-back") as HTMLTextAreaElement;
const makeCardCitationEl = $("make-card-citation");
const makeCardErrorEl = $("make-card-error");
const makeCardCancelBtn = $("make-card-cancel");
const makeCardSaveBtn = $("make-card-save") as HTMLButtonElement;
const quizCopyEl = $("quiz-copy");
const quizEmptyEl = $("quiz-empty");
const quizPackEl = $("quiz-pack");
const generateQuizBtn = $("generate-quiz") as HTMLButtonElement;
const refreshQuizBtn = $("refresh-quiz") as HTMLButtonElement;
const quizStaleEl = $("quiz-stale");
const quizCountEl = $("quiz-count");
const quizScoreEl = $("quiz-score");
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
const chatCourseSel = $("chat-course") as HTMLSelectElement;
const chatRootEl = $("chat-root");
const chatModeAskBtn = $("chat-mode-ask") as HTMLButtonElement;
const chatModeExplainBtn = $("chat-mode-explain") as HTMLButtonElement;
const chatModeQuizBtn = $("chat-mode-quiz") as HTMLButtonElement;
const chatNewBtn = $("chat-new") as HTMLButtonElement;
const chatClearBtn = $("chat-clear") as HTMLButtonElement;
const chatLogEl = $("chat-log");
const chatStatusEl = $("chat-status");
const chatInputEl = $("chat-input") as HTMLTextAreaElement;
const chatSendBtn = $("chat-send") as HTMLButtonElement;
const chatArtifactSel = $("chat-artifact") as HTMLSelectElement;
const generateStudyArtifactBtn = $("generate-study-artifact") as HTMLButtonElement;
const jobsListEl = $("jobs-list");
const jobsLogEl = $("jobs-log");
const providerSel = $("provider") as HTMLSelectElement;
const providerKeyRow = $("provider-key-row");
const providerKeyInput = $("provider-key") as HTMLInputElement;
const providerKeySaveBtn = $("provider-key-save") as HTMLButtonElement;
const providerKeyClearBtn = $("provider-key-clear") as HTMLButtonElement;
const providerKeyStatusEl = $("provider-key-status");
const providerBaseUrlRow = $("provider-base-url-row");
const providerBaseUrlInput = $("provider-base-url") as HTMLInputElement;
const modelSel = $("model") as HTMLSelectElement;
const toggleWatch = $("toggle-watch");
const toggleAuto = $("toggle-auto");
const toggleEmbed = $("toggle-embed");
const toggleDelete = $("toggle-delete");
const toggleAutoFlashcards = $("toggle-auto-flashcards");
const toggleAutoQuiz = $("toggle-auto-quiz");
const syncRemoteInput = $("sync-remote") as HTMLInputElement;
const syncRemoteSaveBtn = $("sync-remote-save") as HTMLButtonElement;
const syncRemoteNoteEl = $("sync-remote-note");
const toggleSyncShared = $("toggle-sync-shared");
const toggleSyncAfter = $("toggle-sync-after");
const syncNowBtn = $("sync-now") as HTMLButtonElement;
const createSharedLibraryBtn = $("create-shared-library") as HTMLButtonElement;
const joinLibraryBtn = $("join-library") as HTMLButtonElement;
const libraryCreateDialogEl = $("library-create-dialog") as HTMLDialogElement;
const libraryCreateNameEl = $("library-create-name") as HTMLInputElement;
const libraryCreateErrorEl = $("library-create-error");
const libraryCreateConfirmBtn = $("library-create-confirm") as HTMLButtonElement;
const libraryCreateCancelBtn = $("library-create-cancel") as HTMLButtonElement;
const libraryJoinDialogEl = $("library-join-dialog") as HTMLDialogElement;
const libraryJoinUrlEl = $("library-join-url") as HTMLInputElement;
const libraryJoinDestEl = $("library-join-dest") as HTMLInputElement;
const libraryJoinPickBtn = $("library-join-pick") as HTMLButtonElement;
const libraryJoinErrorEl = $("library-join-error");
const libraryJoinConfirmBtn = $("library-join-confirm") as HTMLButtonElement;
const libraryJoinCancelBtn = $("library-join-cancel") as HTMLButtonElement;
const syncStatusEl = $("sync-status");
const syncConflictDialogEl = $("sync-conflict-dialog") as HTMLDialogElement;
const syncConflictFilesEl = $("sync-conflict-files");
const syncConflictBinaryEl = $("sync-conflict-binary");
const syncConflictTextEl = $("sync-conflict-text");
const syncConflictMineEl = $("sync-conflict-mine");
const syncConflictTheirsEl = $("sync-conflict-theirs");
const syncConflictEditEl = $("sync-conflict-edit") as HTMLTextAreaElement;
const syncConflictErrorEl = $("sync-conflict-error");
const syncConflictUseMineBtn = $("sync-conflict-use-mine") as HTMLButtonElement;
const syncConflictUseTheirsBtn = $("sync-conflict-use-theirs") as HTMLButtonElement;
const syncConflictUseEditBtn = $("sync-conflict-use-edit") as HTMLButtonElement;
const syncConflictContinueBtn = $("sync-conflict-continue") as HTMLButtonElement;
const syncConflictCloseBtn = $("sync-conflict-close") as HTMLButtonElement;
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
let knowledgeRoots: KnowledgeRootEntry[] = [];
let providerId = "codex";
let ollamaBaseUrl = "";
let lmstudioBaseUrl = "";
let appearance: Appearance = "system";
let authed = false;
let authCheckReason = "";
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
let flashcardFullDeck: FlashcardDeck | null = null;
let flashcardDueIds: string[] = [];
let flashcardDeckCount = 0;
let flashcardDeckMode: "due" | "full" = "due";
let flashcardCourse: string | null = null;
let flashcardGradeInFlight = false;
let quizReview: QuizReview | null = null;
let quizProgress: QuizProgress = {};
let chatLines: ChatLine[] = [];
let chatMode: ChatMode = "ask";
let chatInFlight = false;
let chatLiveBubble: HTMLElement | null = null;
let quizCourse: string | null = null;
let progressWrite = Promise.resolve();
let conceptGraph: ConceptGraph | null = null;
let selectedConceptId: string | null = null;
let currentNotesPath: string | null = null;
let citationsReport: CitationsReport | null = null;
let pendingFocusCardId: string | null = null;
let weakestRecommendTopic: { label: string } | null = null;
let makeCardSelectionText = "";
let makeCardHeading: string | null = null;
let makeCardPage: string | null = null;
let makeCardDigest: string | null = null;
type MakeCardDraft = {
  digest: string;
  heading: string | null;
  page: string | null;
};
let makeCardDraft: MakeCardDraft | null = null;
let chatLoadGeneration = 0;

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

function updateFolderChooseLabels() {
  const label =
    knowledgeRoots.length > 0 ? "Add folder…" : "Choose Knowledge folder…";
  chooseBtn.textContent = label;
  welcomeChooseBtn.textContent = label;
}

function setNavActive(place: Place, course?: string) {
  courseListEl.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle(
      "active",
      place === "course" &&
        btn.getAttribute("data-course") === course &&
        btn.getAttribute("data-root") === knowledgeRoot,
    );
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
  if (mode === "chat") void loadChat(course);
  refreshChatCourseOptions();
  if (knowledgeRoot) chatRootEl.textContent = shortenPath(knowledgeRoot);
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
    void refreshSyncUi();
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
  generateStudyArtifactBtn.disabled = !enabled;
}

function refreshChatCourseOptions() {
  const prev = chatCourseSel.value;
  chatCourseSel.innerHTML = "";
  for (const course of courses) {
    const option = document.createElement("option");
    option.value = course;
    option.textContent = course;
    chatCourseSel.appendChild(option);
  }
  if (currentCourse && courses.includes(currentCourse)) {
    chatCourseSel.value = currentCourse;
  } else if (prev && courses.includes(prev)) {
    chatCourseSel.value = prev;
  }
}

function setChatModeButtons(mode: ChatMode) {
  chatMode = mode;
  for (const button of [chatModeAskBtn, chatModeExplainBtn, chatModeQuizBtn]) {
    const active = button.dataset.chatMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function refreshChatControls() {
  const busy = chatInFlight;
  chatSendBtn.disabled = busy;
  chatNewBtn.disabled = busy;
  chatClearBtn.disabled = busy;
  chatCourseSel.disabled = busy;
}

function renderChatTranscript(course: string) {
  chatLogEl.innerHTML = "";
  for (const line of visibleTranscript(chatLines)) {
    const turn = document.createElement("div");
    turn.className = `chat-turn chat-${line.role}`;
    if (line.role === "user") {
      turn.textContent = line.content ?? "";
      chatLogEl.appendChild(turn);
      continue;
    }
    if (line.role === "assistant") {
      const answer = document.createElement("div");
      answer.className = "chat-answer";
      answer.innerHTML = renderAnswerHtml(line.content ?? "");
      turn.appendChild(answer);
      const banner = unsupportedBanner(line.supported);
      if (banner) {
        const bannerEl = document.createElement("div");
        bannerEl.className = "chat-banner";
        bannerEl.textContent = banner;
        turn.appendChild(bannerEl);
      }
      const cites = document.createElement("div");
      cites.className = "chat-citations";
      for (const citation of line.citations ?? []) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "source-chip";
        chip.textContent = citationLabel(citation);
        chip.addEventListener("click", () => {
          setCourseView(
            course,
            "notes",
            chatNotePath(course, citation.digest_path ?? ""),
            citation.heading_id ?? null,
          );
        });
        cites.appendChild(chip);
      }
      turn.appendChild(cites);
      chatLogEl.appendChild(turn);
    }
  }
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

async function loadChat(course: string) {
  if (!knowledgeRoot) return;
  const generation = ++chatLoadGeneration;
  try {
    const rows = await invoke<ChatLine[]>("read_chat_history", {
      root: knowledgeRoot,
      course,
    });
    if (generation !== chatLoadGeneration || currentCourse !== course) return;
    chatLines = rows;
    renderChatTranscript(course);
  } catch (error) {
    if (generation !== chatLoadGeneration || currentCourse !== course) return;
    chatStatusEl.textContent = String(error);
    chatLines = [];
    renderChatTranscript(course);
  }
}

async function appendChatLines(root: string, course: string, lines: ChatLine[]) {
  await invoke("append_chat_lines", {
    root,
    course,
    lines,
  });
  if (currentCourse === course) {
    chatLines.push(...lines);
  }
}

function chatAuthErrorMessage(error: unknown): string {
  const text = String(error);
  if (text.includes("authenticated") || text.includes("auth")) {
    return signedOutJobMessage(currentProviderLabel(), text);
  }
  return text;
}

async function sendChatMessage() {
  const question = chatInputEl.value.trim();
  if (!question || !knowledgeRoot || !currentCourse) return;
  chatLoadGeneration += 1;
  await refreshAuth();
  if (abortIfSignedOut()) {
    chatStatusEl.textContent = signedOutJobMessage(
      currentProviderLabel(),
      authCheckReason,
    );
    return;
  }
  if (!modelSel.value) {
    chatStatusEl.textContent = "Select a model in Settings.";
    return;
  }
  const course = currentCourse;
  const mode = chatMode;
  const root = knowledgeRoot;
  const history = workerHistory(chatLines);

  chatStatusEl.textContent = "Retrieving";
  chatInFlight = true;
  refreshChatControls();
  const userLine = buildUserLine(mode, question);
  let pendingAppend: Promise<void> = Promise.resolve();
  try {
    await appendChatLines(root, course, [userLine]);
    if (currentCourse === course) {
      renderChatTranscript(course);
    }
    chatInputEl.value = "";
    const channel = new Channel<Record<string, unknown>>();
    channel.onmessage = (event) => {
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "chat_retrieved") {
        if (currentCourse === course) {
          chatStatusEl.textContent = "Answering";
        }
        return;
      }
      if (type === "chat_delta") {
        if (currentCourse !== course) return;
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!chatLiveBubble) {
          chatLiveBubble = document.createElement("div");
          chatLiveBubble.className = "chat-turn chat-assistant chat-live";
          chatLogEl.appendChild(chatLiveBubble);
        }
        chatLiveBubble.textContent = (chatLiveBubble.textContent ?? "") + delta;
        chatLogEl.scrollTop = chatLogEl.scrollHeight;
        return;
      }
      if (type === "chat_done") {
        if (chatLiveBubble) {
          chatLiveBubble.remove();
          chatLiveBubble = null;
        }
        const markdown = typeof event.markdown === "string" ? event.markdown : "";
        const supported = event.supported === true;
        const citations = Array.isArray(event.citations)
          ? (event.citations as ChatCitation[])
          : [];
        pendingAppend = (async () => {
          const assistantLine = buildAssistantLine(
            mode,
            markdown,
            supported,
            citations,
          );
          await appendChatLines(root, course, [assistantLine]);
          if (currentCourse === course) {
            renderChatTranscript(course);
            chatStatusEl.textContent = "Done";
          }
        })();
        return;
      }
      if (type === "auth_failed") {
        const reason =
          typeof event.reason === "string"
            ? event.reason
            : authCheckReason;
        if (currentCourse === course) {
          chatStatusEl.textContent = signedOutJobMessage(
            currentProviderLabel(),
            reason,
          );
        }
        return;
      }
      if (type === "error") {
        if (currentCourse === course) {
          chatStatusEl.textContent =
            typeof event.message === "string" ? event.message : "Chat failed.";
        }
        return;
      }
      if (type === "worker_exit") {
        void pendingAppend
          .catch((error) => {
            logLine(`Could not append chat lines: ${error}`);
            if (currentCourse === course) {
              chatStatusEl.textContent = chatAuthErrorMessage(error);
            }
          })
          .finally(() => {
            chatInFlight = false;
            if (chatLiveBubble) {
              chatLiveBubble.remove();
              chatLiveBubble = null;
            }
            refreshChatControls();
          });
      }
    };
    await invoke("start_chat", {
      onEvent: channel,
      root,
      course,
      question,
      mode,
      provider: providerId,
      model: modelSel.value,
      history,
    });
  } catch (error) {
    chatInFlight = false;
    refreshChatControls();
    chatStatusEl.textContent = chatAuthErrorMessage(error);
  }
}

function refreshFolderTools() {
  const ready = Boolean(knowledgeRoot);
  searchToggleBtn.disabled = !ready;
  reindexBtn.disabled = !ready;
  addCourseBtn.disabled = !ready;
  addFilesBtn.disabled = !(ready && currentCourse);
  syncRemoteInput.disabled = !ready;
  syncRemoteSaveBtn.disabled = !ready;
  toggleSyncShared.toggleAttribute("disabled", !ready);
  toggleSyncAfter.toggleAttribute("disabled", !ready);
  syncNowBtn.disabled = !ready;
  createSharedLibraryBtn.disabled = !ready;
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

function knowledgePathBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || trimmed;
}

function workspaceRootLabel(entry: KnowledgeRootEntry, all: KnowledgeRootEntry[]): string {
  const dupes = all.filter((e) => e.name === entry.name);
  if (dupes.length <= 1) return entry.name;
  const trimmed = entry.path.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  return parent ? `${entry.name} (${parent})` : entry.name;
}

function clearChatTranscriptForRootSwitch() {
  chatLines = [];
  chatLiveBubble = null;
  chatLogEl.innerHTML = "";
}

async function switchKnowledgeRoot(path: string, course?: string) {
  if (course === undefined && path === knowledgeRoot) {
    return;
  }
  knowledgeRoot = path;
  folderHintEl.textContent = shortenPath(path);
  chatRootEl.textContent = shortenPath(path);
  updateFolderChooseLabels();
  await invoke("start_folder_watch", { root: path });
  await renderCourseList();
  await loadJobHistory();
  if (searchInput.value.trim()) {
    await runSearch(searchInput.value);
  }
  clearChatTranscriptForRootSwitch();
  refreshChatCourseOptions();
  void refreshSyncUi();
  await persist();
  if (course) {
    setCourseView(course, "notes");
  } else if (courses.length > 0) {
    setCourseView(courses[0], "notes");
  } else {
    setPlaceView("welcome");
  }
}

async function renderCourseList() {
  courseListEl.innerHTML = "";
  if (knowledgeRoots.length === 0) {
    courses = [];
    courseListEl.innerHTML = '<p class="nav-empty">No courses yet</p>';
    refreshChatCourseOptions();
    return;
  }
  for (const entry of knowledgeRoots) {
    const rootBtn = document.createElement("button");
    rootBtn.type = "button";
    rootBtn.className = "workspace-root";
    if (entry.path === knowledgeRoot) rootBtn.classList.add("active");
    rootBtn.dataset.root = entry.path;
    const label = workspaceRootLabel(entry, knowledgeRoots);
    rootBtn.textContent = `${label} · ${entry.kind}`;
    rootBtn.title = entry.path;
    rootBtn.addEventListener("click", () => void switchKnowledgeRoot(entry.path));
    courseListEl.appendChild(rootBtn);

    const group = document.createElement("div");
    group.className = "workspace-courses";
    let rootCourses: string[] = [];
    try {
      rootCourses = await invoke<string[]>("list_courses", { root: entry.path });
    } catch {
      rootCourses = [];
    }
    if (entry.path === knowledgeRoot) {
      courses = rootCourses;
    }
    if (rootCourses.length === 0) {
      const empty = document.createElement("p");
      empty.className = "nav-empty";
      empty.textContent = "No classes yet";
      group.appendChild(empty);
    } else {
      for (const course of rootCourses) {
        const btn = document.createElement("button");
        btn.className = "nav-item";
        btn.dataset.place = "course";
        btn.dataset.course = course;
        btn.dataset.root = entry.path;
        const icon = document.createElement("span");
        icon.className = "icon";
        icon.textContent = "◈";
        btn.append(icon, document.createTextNode(` ${course}`));
        btn.addEventListener("click", () => {
          if (entry.path !== knowledgeRoot) {
            void switchKnowledgeRoot(entry.path, course);
          } else {
            setCourseView(course, "notes");
          }
        });
        group.appendChild(btn);
      }
    }
    courseListEl.appendChild(group);
  }
  refreshChatCourseOptions();
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

function isDigestNotesPath(relativePath: string): boolean {
  return relativePath.includes("/digests/") && relativePath.endsWith(".md");
}

function digestPathFromNotes(relativePath: string): string | null {
  const marker = "digests/";
  const index = relativePath.indexOf(marker);
  if (index < 0 || !relativePath.endsWith(".md")) return null;
  return relativePath.slice(index);
}

function collapseSelectionText(text: string, maxLen: number): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length <= maxLen ? collapsed : collapsed.slice(0, maxLen);
}

function headingForSelectionNode(node: Node | null): string | null {
  if (!node) return null;
  let current: Node | null = node;
  while (current && current !== readingArticleEl) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName;
      if (tag === "H1" || tag === "H2" || tag === "H3") {
        const text = current.textContent?.trim() ?? "";
        return text || null;
      }
    }
    current = current.parentNode;
  }
  const article = readingArticleEl;
  let nearest: string | null = null;
  for (const heading of article.querySelectorAll("h1, h2, h3")) {
    if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const text = heading.textContent?.trim() ?? "";
      if (text) nearest = text;
    }
  }
  return nearest;
}

function pageForSelectionNode(node: Node | null): string | null {
  let current: Node | null = node;
  while (current && current !== readingArticleEl) {
    if (current instanceof HTMLElement && current.dataset.arborPage) {
      return current.dataset.arborPage;
    }
    current = current.parentNode;
  }
  return null;
}

function clearMakeCardDraft() {
  makeCardDraft = null;
}

function clearMakeCardSnapshot() {
  makeCardSelectionText = "";
  makeCardHeading = null;
  makeCardPage = null;
  makeCardDigest = null;
}

function makeCardButtonEngaged(): boolean {
  return makeCardBtn.matches(":hover") || makeCardBtn.matches(":active");
}

/** Returns true when the live selection updates the snapshot. */
function tryUpdateMakeCardSnapshotFromSelection(): boolean {
  const path = currentNotesPath;
  if (!path || !isDigestNotesPath(path)) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }
  const anchor = selection.anchorNode;
  if (!anchor || !readingArticleEl.contains(anchor)) {
    return false;
  }
  const text = collapseSelectionText(selection.toString(), 2000).trim();
  if (!text) {
    return false;
  }
  makeCardSelectionText = text;
  makeCardHeading = headingForSelectionNode(selection.anchorNode);
  makeCardPage = pageForSelectionNode(selection.anchorNode);
  makeCardDigest = digestPathFromNotes(path);
  return true;
}

function refreshMakeCardButton() {
  const path = currentNotesPath;
  if (!path || !isDigestNotesPath(path)) {
    if (!makeCardDialogEl.open) {
      clearMakeCardSnapshot();
      clearMakeCardDraft();
    }
    makeCardBtn.disabled = true;
    return;
  }
  if (tryUpdateMakeCardSnapshotFromSelection()) {
    makeCardBtn.disabled = false;
    return;
  }
  if (makeCardButtonEngaged() && makeCardSelectionText) {
    makeCardBtn.disabled = false;
    return;
  }
  if (!makeCardDialogEl.open) {
    clearMakeCardSnapshot();
  }
  makeCardBtn.disabled = true;
}

function updateNotesChrome(relativePath: string) {
  const isCourseOverview = relativePath.endsWith("/course.md");
  studyOverviewEl.hidden = !isCourseOverview;
  if (isCourseOverview) {
    notesActionsEl.hidden = true;
  } else {
    notesActionsEl.hidden = !isDigestNotesPath(relativePath);
  }
  refreshMakeCardButton();
}

async function loadStudyPlan(course: string, relativePath: string) {
  if (!knowledgeRoot) return;
  studyPlanBodyEl.replaceChildren();
  studyPlanStatusEl.textContent = "";
  studyPlanGenerateBtn.textContent = "Generate";
  const planPath = `${course}/study/plan.md`;
  try {
    const raw = await invoke<string>("read_markdown", {
      root: knowledgeRoot,
      relativePath: planPath,
    });
    if (currentNotesPath !== relativePath) return;
    const { html } = renderMarkdown(raw);
    studyPlanBodyEl.innerHTML = html;
    studyPlanGenerateBtn.textContent = "Regenerate";
  } catch {
    if (currentNotesPath !== relativePath) return;
    studyPlanStatusEl.textContent = "No study plan yet.";
  }
}

type StudyRecommendItem = {
  kind: string;
  label: string;
  digest?: string | null;
  heading?: string | null;
};

async function loadStudyRecommendations(course: string, relativePath: string) {
  if (!knowledgeRoot) return;
  studyRecommendationListEl.replaceChildren();
  weakestRecommendTopic = null;
  explainWeakestBtn.disabled = true;
  try {
    const payload = await invoke<{ items: StudyRecommendItem[] }>("study_progress", {
      root: knowledgeRoot,
      course,
      action: "recommend",
    });
    if (currentNotesPath !== relativePath) return;
    if (payload.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "weak-topic-empty";
      empty.textContent = "No recommendations yet.";
      studyRecommendationListEl.append(empty);
      return;
    }
    for (const item of payload.items) {
      if (item.kind === "weakest_topic") {
        weakestRecommendTopic = { label: item.label };
        explainWeakestBtn.disabled = false;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "weak-topic-btn";
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        if (item.kind === "due_cards") {
          setCourseView(course, "flashcards");
          return;
        }
        if (item.kind === "weakest_topic" || item.kind === "unreviewed_digest") {
          const digest = item.digest;
          if (typeof digest === "string" && digest.trim() !== "") {
            setCourseView(
              course,
              "notes",
              notePathForStudyDigest(course, digest),
              item.heading ?? null,
            );
          }
        }
      });
      studyRecommendationListEl.append(btn);
    }
  } catch {
    if (currentNotesPath !== relativePath) return;
    const failed = document.createElement("p");
    failed.className = "weak-topic-empty";
    failed.textContent = "Could not load recommendations.";
    studyRecommendationListEl.append(failed);
  }
}

async function loadDigestPreview(
  course: string,
  relativePath: string,
  heading?: string | null,
) {
  if (!knowledgeRoot) return;
  currentNotesPath = relativePath;
  updateNotesChrome(relativePath);
  courseIndexLink.classList.toggle("active", relativePath === `${course}/course.md`);
  digestListEl.querySelectorAll(".digest-link").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.path === relativePath);
  });
  try {
    const raw = await invoke<string>("read_markdown", { root: knowledgeRoot, relativePath });
    const { html, pageChip, pageChipRange } = renderMarkdown(raw);
    readingArticleEl.innerHTML = html;
    if (pageChip) {
      const chip = document.createElement("div");
      chip.className = "page-chip";
      chip.textContent = `Pages ${pageChip}`;
      if (pageChipRange) {
        chip.dataset.arborPage = pageChipRange;
      }
      readingArticleEl.prepend(chip);
    }
  } catch (e) {
    const isCourseIndex = relativePath.endsWith("/course.md");
    if (isCourseIndex) {
      readingArticleEl.innerHTML = `<p class="reading-empty">No notes yet. Add lecture files, then Update knowledge.</p>`;
    } else {
      const p = document.createElement("p");
      p.className = "reading-empty";
      p.textContent = `Could not load file: ${e}`;
      readingArticleEl.replaceChildren(p);
    }
  }
  readingArticleEl.querySelectorAll("a[data-arbor-digest]").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      const digest = (anchor as HTMLElement).dataset.arborDigest;
      if (!digest || !currentCourse) return;
      void loadDigestPreview(currentCourse, `${currentCourse}/${digest}`);
    });
  });
  await renderNotesConceptChips(course, relativePath);
  const isCourseOverview = relativePath.endsWith("/course.md");
  if (isCourseOverview && knowledgeRoot) {
    void loadStudyPlan(course, relativePath);
    void loadStudyRecommendations(course, relativePath);
  }
  if (!isCourseOverview) {
    weakTopicsEl.hidden = true;
  } else if (knowledgeRoot) {
    weakTopicsEl.hidden = false;
    weakTopicListEl.replaceChildren();
    try {
      const weak = await invoke<{
        topics: Array<{
          label: string;
          digest?: string;
          heading?: string | null;
        }>;
      }>("study_progress", { root: knowledgeRoot, course, action: "weak" });
      if (currentNotesPath !== relativePath) {
        scrollNotesToHeading(heading);
        return;
      }
      if (weak.topics.length === 0) {
        const empty = document.createElement("p");
        empty.className = "weak-topic-empty";
        empty.textContent = "No weak topics yet.";
        weakTopicListEl.append(empty);
      } else {
        for (const topic of weak.topics) {
          if (!topic.digest) continue;
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "weak-topic-btn";
          btn.textContent = topic.label;
          btn.addEventListener("click", () => {
            setCourseView(
              course,
              "notes",
              notePathForStudyDigest(course, topic.digest!),
              topic.heading ?? null,
            );
          });
          li.append(btn);
          weakTopicListEl.append(li);
        }
      }
    } catch (error) {
      logLine(`Could not load weak topics: ${error}`);
      const failed = document.createElement("p");
      failed.className = "weak-topic-empty";
      failed.textContent = "Could not load weak topics.";
      weakTopicListEl.append(failed);
    }
  }
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

function refreshFlashcardDueLabel() {
  flashcardDueBtn.textContent = `Due today (${flashcardDueIds.length})`;
  flashcardAllBtn.textContent = `Full deck (${flashcardDeckCount})`;
}

function setFlashcardDeckToggle(mode: "due" | "full") {
  flashcardDeckMode = mode;
  flashcardDueBtn.setAttribute("aria-pressed", mode === "due" ? "true" : "false");
  flashcardAllBtn.setAttribute("aria-pressed", mode === "full" ? "true" : "false");
}

function flashcardSessionForMode(deck: FlashcardDeck): FlashcardReview {
  if (flashcardDeckMode === "full") {
    return createReview(deck);
  }
  return {
    cards: cardsForIds(deck, flashcardDueIds),
    index: 0,
    flipped: false,
  };
}

function renderCurrentFlashcard() {
  if (!flashcardReview) return;
  if (flashcardReview.cards.length === 0) {
    flashcardCountEl.textContent = "";
    flashcardFaceEl.textContent =
      flashcardDeckMode === "due" ? "No cards due today." : "No cards in deck.";
    flashcardFaceEl.classList.remove("flipped");
    flashcardFlipBtn.textContent = "Flip";
    flashcardSourceBtn.textContent = "";
    flashcardTagsEl.textContent = "";
    flashcardCitationEl.hidden = true;
    flashcardAgainBtn.hidden = true;
    flashcardWrongBtn.hidden = true;
    flashcardMasteredBtn.hidden = true;
    return;
  }
  const card = currentCard(flashcardReview);
  flashcardCountEl.textContent = `${flashcardReview.index + 1} of ${flashcardReview.cards.length}`;
  flashcardFaceEl.textContent = flashcardReview.flipped ? card.back : card.front;
  flashcardFaceEl.classList.toggle("flipped", flashcardReview.flipped);
  flashcardFlipBtn.textContent = flashcardReview.flipped ? "Show front" : "Flip";
  const sourceParts = [card.source.digest];
  if (card.source.heading) {
    sourceParts.push(card.source.heading);
  }
  if (card.source.page) {
    sourceParts.push(`p. ${card.source.page}`);
  }
  flashcardSourceBtn.textContent = sourceParts.join(" · ");
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
  const gradeDisabled = gradesHidden || flashcardGradeInFlight;
  flashcardAgainBtn.disabled = gradeDisabled;
  flashcardWrongBtn.disabled = gradeDisabled;
  flashcardMasteredBtn.disabled = gradeDisabled;
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
    const dueValue = await invoke<{
      due_ids: string[];
      count: number;
      deck_count: number;
    }>("study_progress", { root, course, action: "due" });
    const stale = await invoke<boolean>("study_artifact_stale", {
      root,
      course,
      skill: "flashcards",
    });
    if (currentCourse !== course) return;
    flashcardFullDeck = deck;
    flashcardDueIds = [...dueValue.due_ids];
    flashcardDeckCount = dueValue.deck_count;
    flashcardDeckMode = "due";
    setFlashcardDeckToggle("due");
    refreshFlashcardDueLabel();
    flashcardReview = flashcardSessionForMode(deck);
    flashcardCourse = course;
    flashcardsEmptyEl.hidden = true;
    flashcardsDeckEl.hidden = false;
    flashcardStaleEl.hidden = !stale;
    renderCurrentFlashcard();
    if (pendingFocusCardId && flashcardReview) {
      const focusId = pendingFocusCardId;
      pendingFocusCardId = null;
      const focusIndex = flashcardReview.cards.findIndex((c) => c.id === focusId);
      if (focusIndex >= 0) {
        flashcardReview = { ...flashcardReview, index: focusIndex, flipped: false };
        renderCurrentFlashcard();
      }
    }
  } catch {
    if (currentCourse !== course) return;
    flashcardReview = null;
    flashcardFullDeck = null;
    flashcardDueIds = [];
    flashcardDeckCount = 0;
    flashcardCourse = course;
    flashcardsEmptyEl.hidden = false;
    flashcardsDeckEl.hidden = true;
    flashcardsCopyEl.textContent = `No flashcards yet for ${course}. Generate a deck from your digests.`;
  }
  refreshStudyEnabled();
}

async function gradeCurrentFlashcard(grade: "again" | "wrong" | "mastered") {
  if (!flashcardReview || !flashcardReview.flipped || flashcardReview.cards.length === 0) {
    return;
  }
  if (flashcardGradeInFlight) return;
  if (!knowledgeRoot || !flashcardCourse) return;
  const card = currentCard(flashcardReview);
  flashcardGradeInFlight = true;
  renderCurrentFlashcard();
  let gradeSaved = false;
  try {
    await invoke("study_progress", {
      root: knowledgeRoot,
      course: flashcardCourse,
      action: "grade",
      id: card.id,
      result: grade,
      digest: card.source.digest,
      heading: card.source.heading ?? "",
    });
    gradeSaved = true;
  } catch (error) {
    logLine(`Could not save flashcard grade: ${error}`);
  } finally {
    flashcardGradeInFlight = false;
  }
  if (!gradeSaved) {
    renderCurrentFlashcard();
    return;
  }
  flashcardDueIds = applyGradeToDueIds(flashcardDueIds, card.id, grade);
  refreshFlashcardDueLabel();
  if (flashcardDeckMode === "due") {
    flashcardReview =
      grade === "again"
        ? requeueCurrentCard(flashcardReview)
        : dropCurrentCard(flashcardReview);
  } else if (grade === "again") {
    flashcardReview = requeueCurrentCard(flashcardReview);
  } else {
    flashcardReview = advanceAfterGrade(flashcardReview);
  }
  renderCurrentFlashcard();
}

function abortIfSignedOut(): boolean {
  if (authed) return false;
  logLine(signedOutJobMessage(currentProviderLabel(), authCheckReason));
  return true;
}

async function startFlashcardJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (abortIfSignedOut()) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      flashcardJobArgs(knowledgeRoot, currentCourse, force, modelSel.value, providerId),
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
  const score = sessionScore(quizReview);
  quizScoreEl.textContent = `${score.correct} / ${score.total} correct`;
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
        notePathForStudyDigest(currentCourse, source.digest),
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

async function startQuizJob(force: boolean) {
  if (!knowledgeRoot || !currentCourse || !modelSel.value) return;
  await refreshAuth();
  if (abortIfSignedOut()) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      quizJobArgs(knowledgeRoot, currentCourse, force, modelSel.value, providerId),
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
  if (abortIfSignedOut()) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      conceptJobArgs(knowledgeRoot, currentCourse, force, modelSel.value, providerId),
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
  if (abortIfSignedOut()) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      diagramJobArgs(knowledgeRoot, currentCourse, force, modelSel.value, providerId),
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
  if (abortIfSignedOut()) return;
  studyJobRunning = true;
  refreshStudyEnabled();
  try {
    const jobId = await invoke<string>(
      "start_study_job",
      citationJobArgs(knowledgeRoot, currentCourse, force, modelSel.value, providerId),
    );
    logLine(`Citations job ${jobId} started.`);
  } catch (error) {
    studyJobRunning = false;
    refreshStudyEnabled();
    logLine(`Citation check failed to start: ${error}`);
  }
}

async function activateKnowledgeRoot(picked: string) {
  if (!knowledgeRoots.some((e) => e.path === picked)) {
    knowledgeRoots.push({
      path: picked,
      kind: "personal",
      name: knowledgePathBasename(picked),
    });
  }
  try {
    const created = await invoke<boolean>("init_knowledge_repo", { path: picked });
    if (created) logLine(`Initialized git repository in ${picked}`);
  } catch (e) {
    logLine(`Could not initialize git: ${e}`);
  }
  await loadProviders(providerId);
  await loadModels(modelSel.value || null);
  await switchKnowledgeRoot(picked);
  refreshFolderTools();
}

async function refreshSyncUi() {
  if (!knowledgeRoot) {
    syncRemoteInput.value = "";
    syncRemoteNoteEl.textContent = "";
    syncStatusEl.textContent = "";
    setToggle(toggleSyncShared, false);
    setToggle(toggleSyncAfter, false);
    return;
  }
  try {
    const show = await invoke<SyncShowResult>("sync_show", { root: knowledgeRoot });
    syncRemoteInput.value = show.remote ?? "";
    syncRemoteNoteEl.textContent = show.remote_note ?? "";
    setToggle(toggleSyncShared, show.shared);
    const ks = await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot });
    setToggle(toggleSyncAfter, ks.sync_after_commit);
  } catch {
    /* sync config may be unreadable before init */
  }
}

let syncConflictSelectedPath: string | null = null;

function renderSyncConflictFileDetail(entry: SyncConflictFile) {
  syncConflictErrorEl.textContent = "";
  if (entry.binary) {
    syncConflictBinaryEl.hidden = false;
    syncConflictTextEl.hidden = true;
    return;
  }
  syncConflictBinaryEl.hidden = true;
  syncConflictTextEl.hidden = false;
  syncConflictMineEl.textContent = entry.mine ?? "";
  syncConflictTheirsEl.textContent = entry.theirs ?? "";
  const draft =
    entry.choice === "edit" && entry.edit_content != null
      ? entry.edit_content
      : entry.mine ?? "";
  syncConflictEditEl.value = draft;
}

function renderSyncConflictSession(session: SyncConflictSession, focusPath?: string) {
  syncConflictFilesEl.innerHTML = "";
  const files = session.files ?? [];
  if (files.length === 0) {
    syncConflictBinaryEl.hidden = true;
    syncConflictTextEl.hidden = true;
    return;
  }
  let selected = focusPath && files.some((f) => f.path === focusPath) ? focusPath : files[0].path;
  syncConflictSelectedPath = selected;
  for (const entry of files) {
    const btn = document.createElement("button");
    btn.type = "button";
    const resolved =
      entry.choice === "mine" || entry.choice === "theirs" || entry.choice === "edit";
    btn.textContent = resolved ? `${entry.path} (resolved)` : entry.path;
    btn.classList.toggle("selected", entry.path === selected);
    btn.classList.toggle("resolved", resolved);
    btn.addEventListener("click", () => {
      syncConflictSelectedPath = entry.path;
      for (const child of syncConflictFilesEl.querySelectorAll("button")) {
        child.classList.toggle("selected", child === btn);
      }
      renderSyncConflictFileDetail(entry);
    });
    syncConflictFilesEl.appendChild(btn);
  }
  const active = files.find((f) => f.path === selected) ?? files[0];
  renderSyncConflictFileDetail(active);
}

async function openSyncConflictDialog(focusPath?: string) {
  if (!knowledgeRoot) return;
  syncConflictErrorEl.textContent = "";
  try {
    const session = await invoke<SyncConflictSession>("read_sync_conflict", {
      root: knowledgeRoot,
    });
    renderSyncConflictSession(session, focusPath);
    syncConflictDialogEl.showModal();
  } catch (error) {
    syncStatusEl.textContent = String(error);
  }
}

async function reloadSyncConflictDialog() {
  if (!knowledgeRoot) return;
  const session = await invoke<SyncConflictSession>("read_sync_conflict", {
    root: knowledgeRoot,
  });
  renderSyncConflictSession(session, syncConflictSelectedPath ?? undefined);
}

function reloadLibraryAfterSync() {
  void renderCourseList().then(() => {
    if (currentCourse) void loadCourseContent(currentCourse);
  });
  void runSearch(searchInput.value);
}

async function runSyncNow() {
  if (!knowledgeRoot) return;
  syncStatusEl.textContent = "";
  try {
    const result = await invoke<SyncWorkerResult>("sync_now", { root: knowledgeRoot });
    if (!result.ok && result.action === "conflict") {
      const first = result.files?.[0];
      await openSyncConflictDialog(first);
      return;
    }
    if (result.ok) {
      syncStatusEl.textContent = `Synced (${result.action}).`;
      if (result.head_changed) reloadLibraryAfterSync();
    }
  } catch (error) {
    syncStatusEl.textContent = String(error);
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
    const btn = renderSearchHit(hit);
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
      provider: providerId,
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

async function presentUpdatePlan(
  reason: "watch" | "import",
  settings?: KnowledgeSettings,
) {
  if (!knowledgeRoot) return;
  try {
    const ks =
      settings ??
      (await invoke<KnowledgeSettings>("get_knowledge_settings", { root: knowledgeRoot }));
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
        logLine(
          `Auto-update waiting for ${currentProviderLabel()} auth. Review and Confirm when ready. ${signedOutJobMessage(currentProviderLabel(), authCheckReason)}`,
        );
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
  await presentUpdatePlan("watch", ks);
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
  const status = document.createElement("span");
  status.className = "ok";
  status.textContent = label;
  inspectorStatusEl.replaceChildren("Last job: ", status, ` · ${time}`);
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
    const row = document.createElement("div");
    row.className = "setting-row";
    const span = document.createElement("span");
    span.textContent = `Could not load jobs: ${e}`;
    row.appendChild(span);
    jobsListEl.replaceChildren(row);
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
    setToggle(toggleSyncAfter, ks.sync_after_commit);
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

const PROVIDER_FALLBACK = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok" },
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "openai_api", label: "OpenAI API" },
  { id: "anthropic_api", label: "Anthropic API" },
];

function syncProviderBaseUrlFromInput() {
  const value = providerBaseUrlInput.value.trim();
  if (providerId === "ollama") {
    ollamaBaseUrl = value;
  } else if (providerId === "lmstudio") {
    lmstudioBaseUrl = value;
  }
}

function refreshProviderExtraRows() {
  const showKey = providerId === "openai_api" || providerId === "anthropic_api";
  const showBase = providerId === "ollama" || providerId === "lmstudio";
  providerKeyRow.hidden = !showKey;
  providerBaseUrlRow.hidden = !showBase;
  if (providerId === "ollama") {
    providerBaseUrlInput.placeholder = "http://127.0.0.1:11434";
    providerBaseUrlInput.value = ollamaBaseUrl;
  } else if (providerId === "lmstudio") {
    providerBaseUrlInput.placeholder = "http://127.0.0.1:1234/v1";
    providerBaseUrlInput.value = lmstudioBaseUrl;
  }
}

async function refreshProviderKeyStatus() {
  if (providerId !== "openai_api" && providerId !== "anthropic_api") {
    providerKeyStatusEl.textContent = "";
    return;
  }
  try {
    const status = await invoke<string>("provider_secret_status", { providerId });
    providerKeyStatusEl.textContent = status === "ready" ? "ready" : "key missing";
  } catch {
    providerKeyStatusEl.textContent = "key missing";
  }
}

function currentProviderLabel(): string {
  const opt = providerSel.selectedOptions[0];
  return opt?.textContent?.trim() || providerId;
}

function selectedModelLabel(): string {
  const opt = modelSel.selectedOptions[0];
  return opt?.textContent?.trim() || modelSel.value || "";
}

async function loadProviders(selectedId: string) {
  let rows: { id: string; label: string }[];
  try {
    const list = await invoke<ProviderInfo[]>("list_providers", {
      root: knowledgeRoot ?? undefined,
    });
    rows = pickerProviders(list.map((p) => ({ id: p.id, label: p.label })));
  } catch {
    rows = PROVIDER_FALLBACK;
  }
  providerSel.innerHTML = "";
  for (const p of rows) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    providerSel.appendChild(opt);
  }
  const id = rows.some((r) => r.id === selectedId) ? selectedId : (rows[0]?.id ?? "codex");
  providerSel.value = id;
  providerId = id;
}

async function loadSettings() {
  const s = await invoke<Settings>("get_settings");
  providerId = s.provider_id?.trim() || "codex";
  ollamaBaseUrl = s.ollama_base_url?.trim() ?? "";
  lmstudioBaseUrl = s.lmstudio_base_url?.trim() ?? "";
  appearance = s.appearance ?? "system";
  appearanceSel.value = appearance;
  applyTheme();
  try {
    await loadProviders(providerId);
  } catch (error) {
    logLine(`Could not load providers: ${error}`);
  }
  knowledgeRoots = Array.isArray(s.knowledge_roots) ? [...s.knowledge_roots] : [];
  const activePath = s.active_root ?? s.knowledge_root;
  if (activePath) {
    knowledgeRoot = activePath;
    folderHintEl.textContent = shortenPath(activePath);
    updateFolderChooseLabels();
    await invoke("start_folder_watch", { root: activePath });
    await renderCourseList();
    await loadJobHistory();
    if (courses.length > 0) {
      setCourseView(courses[0], "notes");
    }
    refreshFolderTools();
    void refreshSyncUi();
  } else {
    knowledgeRoot = null;
    setPlaceView("welcome");
  }
  try {
    await loadModels(s.model_id);
  } catch (error) {
    modelSel.innerHTML = "";
    logLine(`Could not load models: ${error}`);
  }
  refreshProviderExtraRows();
  await refreshProviderKeyStatus();
}

async function persist() {
  syncProviderBaseUrlFromInput();
  await invoke("save_settings", {
    settings: {
      knowledge_roots: knowledgeRoots,
      active_root: knowledgeRoot,
      knowledge_root: knowledgeRoot,
      model_id: modelSel.value || null,
      provider_id: providerId,
      appearance,
      ollama_base_url: ollamaBaseUrl.trim() || null,
      lmstudio_base_url: lmstudioBaseUrl.trim() || null,
    } satisfies Settings,
  });
}

async function loadModels(selected: string | null) {
  const res = await invoke<{ models: Model[] }>("list_models", {
    root: knowledgeRoot ?? undefined,
    provider: providerId,
  });
  modelSel.innerHTML = "";
  for (const m of res.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSel.appendChild(opt);
  }
  if (selected && res.models.some((m) => m.id === selected)) {
    modelSel.value = selected;
  } else if (res.models.length > 0) {
    modelSel.value = res.models[0].id;
  }
}

let refreshAuthInFlight: Promise<void> | null = null;

async function refreshAuth() {
  if (refreshAuthInFlight) return refreshAuthInFlight;
  const label = currentProviderLabel();
  refreshAuthInFlight = (async () => {
    providerLabelEl.textContent = `Checking ${label}…`;
    providerStatusEl.className = "auth-badge";
    docsLink.hidden = true;
    const modelLabel = selectedModelLabel();
    try {
      const a = await invoke<AuthStatus>("check_auth", { provider: providerId });
      authed = a.authenticated;
      if (a.authenticated) {
        authCheckReason = "";
        providerLabelEl.textContent = providerBadge(label, modelLabel, true, a.reason);
        providerStatusEl.className = "auth-badge";
        docsLink.hidden = true;
      } else {
        authCheckReason = a.reason;
        providerLabelEl.textContent = providerBadge(label, modelLabel, false, a.reason);
        providerStatusEl.className = "auth-badge bad";
        docsLink.href = a.docs_url;
        docsLink.textContent = `Set up ${label}`;
        docsLink.hidden = false;
      }
    } catch {
      authed = false;
      if (!authCheckReason.trim()) {
        authCheckReason = "auth check failed";
      }
      providerLabelEl.textContent = providerBadge(label, modelLabel, false, authCheckReason);
      providerStatusEl.className = "auth-badge bad";
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
    addCourseErrorEl.textContent = "";
    addCourseErrorEl.hidden = true;
    addCourseForm.hidden = true;
    addCourseNameEl.value = "";
    await renderCourseList();
    setCourseView(course, "notes");
  } catch (error) {
    addCourseErrorEl.textContent = String(error);
    addCourseErrorEl.hidden = false;
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
  // Watch debounce is 3s plus a 500ms poll; keep this longer so the copy's
  // own notify event does not reopen the review we show below.
  suppressWatchUntil = Date.now() + 5000;
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
    addCourseErrorEl.textContent = "";
    addCourseErrorEl.hidden = true;
    addCourseNameEl.focus();
  }
});

addCourseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void createCourseFromForm();
});

addCourseNameEl.addEventListener("input", () => {
  addCourseErrorEl.textContent = "";
  addCourseErrorEl.hidden = true;
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

toggleSyncShared.addEventListener("click", async () => {
  if (!knowledgeRoot) return;
  const on = toggleSyncShared.classList.contains("off");
  setToggle(toggleSyncShared, on);
  try {
    await invoke("sync_set_shared", { root: knowledgeRoot, shared: on });
  } catch (error) {
    syncStatusEl.textContent = String(error);
    setToggle(toggleSyncShared, !on);
  }
});

toggleSyncAfter.addEventListener("click", async () => {
  const on = toggleSyncAfter.classList.contains("off");
  setToggle(toggleSyncAfter, on);
  await saveKnowledgeSettings({ sync_after_commit: on });
});

syncRemoteSaveBtn.addEventListener("click", async () => {
  if (!knowledgeRoot) return;
  const url = syncRemoteInput.value.trim();
  if (!url) {
    syncStatusEl.textContent = "Enter a remote URL.";
    return;
  }
  syncStatusEl.textContent = "";
  try {
    const result = await invoke<{ remote: string }>("sync_set_remote", {
      root: knowledgeRoot,
      url,
    });
    syncRemoteInput.value = result.remote;
    syncStatusEl.textContent = "Remote saved.";
  } catch (error) {
    syncStatusEl.textContent = String(error);
  }
});

syncNowBtn.addEventListener("click", () => {
  void runSyncNow();
});

function activeRootEntryName(): string {
  if (!knowledgeRoot) return "";
  const entry = knowledgeRoots.find((e) => e.path === knowledgeRoot);
  return entry?.name ?? knowledgePathBasename(knowledgeRoot);
}

createSharedLibraryBtn.addEventListener("click", () => {
  if (!knowledgeRoot) return;
  libraryCreateErrorEl.textContent = "";
  libraryCreateNameEl.value = activeRootEntryName();
  libraryCreateDialogEl.showModal();
});

libraryCreateCancelBtn.addEventListener("click", () => {
  libraryCreateDialogEl.close();
});

libraryCreateConfirmBtn.addEventListener("click", async () => {
  if (!knowledgeRoot) return;
  libraryCreateErrorEl.textContent = "";
  const name = libraryCreateNameEl.value.trim();
  try {
    const doc = await invoke<{ name: string }>("create_shared_library", {
      root: knowledgeRoot,
      name: name || null,
    });
    const entry = knowledgeRoots.find((e) => e.path === knowledgeRoot);
    if (entry) {
      entry.kind = "shared";
      entry.name = doc.name;
    }
    await persist();
    await renderCourseList();
    void refreshSyncUi();
    libraryCreateDialogEl.close();
  } catch (error) {
    libraryCreateErrorEl.textContent = String(error);
  }
});

let libraryJoinInFlight = false;

joinLibraryBtn.addEventListener("click", () => {
  libraryJoinErrorEl.textContent = "";
  libraryJoinUrlEl.value = "";
  libraryJoinDestEl.value = "";
  libraryJoinDialogEl.showModal();
});

libraryJoinCancelBtn.addEventListener("click", () => {
  libraryJoinDialogEl.close();
});

libraryJoinPickBtn.addEventListener("click", async () => {
  libraryJoinErrorEl.textContent = "";
  try {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    libraryJoinDestEl.value = picked;
  } catch (error) {
    libraryJoinErrorEl.textContent = String(error);
  }
});

libraryJoinConfirmBtn.addEventListener("click", async () => {
  if (libraryJoinInFlight) return;
  const url = libraryJoinUrlEl.value.trim();
  const dest = libraryJoinDestEl.value.trim();
  if (!url || !dest) {
    libraryJoinErrorEl.textContent = "Enter a URL and choose a folder.";
    return;
  }
  libraryJoinErrorEl.textContent = "";
  libraryJoinInFlight = true;
  joinLibraryBtn.disabled = true;
  libraryJoinConfirmBtn.disabled = true;
  try {
    const result = await invoke<{ path: string; name: string; kind: KnowledgeKind }>(
      "join_library",
      { url, dest },
    );
    const existing = knowledgeRoots.find((e) => e.path === result.path);
    if (existing) {
      existing.kind = "shared";
      existing.name = result.name;
    } else {
      knowledgeRoots.push({
        path: result.path,
        kind: "shared",
        name: result.name,
      });
    }
    libraryJoinDialogEl.close();
    await switchKnowledgeRoot(result.path);
  } catch (error) {
    libraryJoinErrorEl.textContent = String(error);
  } finally {
    libraryJoinInFlight = false;
    joinLibraryBtn.disabled = false;
    libraryJoinConfirmBtn.disabled = false;
  }
});

syncConflictCloseBtn.addEventListener("click", () => {
  syncConflictDialogEl.close();
});

syncConflictUseMineBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !syncConflictSelectedPath) return;
  syncConflictErrorEl.textContent = "";
  try {
    await invoke("sync_resolve", {
      root: knowledgeRoot,
      path: syncConflictSelectedPath,
      side: "mine",
    });
    await reloadSyncConflictDialog();
  } catch (error) {
    syncConflictErrorEl.textContent = String(error);
  }
});

syncConflictUseTheirsBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !syncConflictSelectedPath) return;
  syncConflictErrorEl.textContent = "";
  try {
    await invoke("sync_resolve", {
      root: knowledgeRoot,
      path: syncConflictSelectedPath,
      side: "theirs",
    });
    await reloadSyncConflictDialog();
  } catch (error) {
    syncConflictErrorEl.textContent = String(error);
  }
});

syncConflictUseEditBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !syncConflictSelectedPath) return;
  syncConflictErrorEl.textContent = "";
  try {
    await invoke("sync_resolve", {
      root: knowledgeRoot,
      path: syncConflictSelectedPath,
      side: "edit",
      content: syncConflictEditEl.value,
    });
    await reloadSyncConflictDialog();
  } catch (error) {
    syncConflictErrorEl.textContent = String(error);
  }
});

syncConflictContinueBtn.addEventListener("click", async () => {
  if (!knowledgeRoot) return;
  syncConflictErrorEl.textContent = "";
  try {
    const result = await invoke<SyncWorkerResult>("sync_continue", { root: knowledgeRoot });
    if (!result.ok && result.action === "conflict") {
      const first = result.files?.[0];
      await openSyncConflictDialog(first);
      return;
    }
    if (result.ok) {
      syncConflictDialogEl.close();
      syncStatusEl.textContent = "Synced (integrated).";
      if (result.head_changed) reloadLibraryAfterSync();
    }
  } catch (error) {
    syncConflictErrorEl.textContent = String(error);
  }
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

providerSel.addEventListener("change", () => {
  providerId = providerSel.value;
  const prevModel = modelSel.value;
  void (async () => {
    refreshProviderExtraRows();
    await refreshProviderKeyStatus();
    try {
      await loadModels(prevModel || null);
    } catch (error) {
      modelSel.innerHTML = "";
      logLine(`Could not load models: ${error}`);
    }
    refreshStudyEnabled();
    await refreshAuth();
    await persist();
  })();
});

providerKeySaveBtn.addEventListener("click", () => {
  void (async () => {
    try {
      await invoke("set_provider_secret", {
        providerId,
        secret: providerKeyInput.value,
      });
      providerKeyInput.value = "";
      await refreshProviderKeyStatus();
      await refreshAuth();
    } catch (error) {
      logLine(`Could not save API key: ${error}`);
    }
  })();
});

providerKeyClearBtn.addEventListener("click", () => {
  void (async () => {
    try {
      await invoke("clear_provider_secret", { providerId });
      providerKeyInput.value = "";
      await refreshProviderKeyStatus();
      await refreshAuth();
    } catch (error) {
      logLine(`Could not clear API key: ${error}`);
    }
  })();
});

providerBaseUrlInput.addEventListener("change", () => {
  syncProviderBaseUrlFromInput();
  void persist();
});

modelSel.addEventListener("change", () => {
  refreshStudyEnabled();
  void refreshAuth();
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

chatCourseSel.addEventListener("change", () => {
  const next = chatCourseSel.value;
  if (next) setCourseView(next, "chat");
});

chatModeAskBtn.addEventListener("click", () => setChatModeButtons("ask"));
chatModeExplainBtn.addEventListener("click", () => setChatModeButtons("explain"));
chatModeQuizBtn.addEventListener("click", () => setChatModeButtons("quiz"));

chatSendBtn.addEventListener("click", () => {
  void sendChatMessage();
});

chatInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendChatMessage();
  }
});

chatNewBtn.addEventListener("click", () => {
  if (!knowledgeRoot || !currentCourse || chatInFlight) return;
  void (async () => {
    await appendChatLines(knowledgeRoot, currentCourse!, [buildSessionLine()]);
    renderChatTranscript(currentCourse!);
    chatStatusEl.textContent = "";
  })();
});

studyPlanGenerateBtn.addEventListener("click", () => {
  void (async () => {
    if (!knowledgeRoot || !currentCourse) return;
    const course = currentCourse;
    const pathAtStart = currentNotesPath;
    if (!modelSel.value) {
      studyPlanStatusEl.textContent = "Select a model in Settings.";
      return;
    }
    await refreshAuth();
    if (abortIfSignedOut()) {
      studyPlanStatusEl.textContent = signedOutJobMessage(
        currentProviderLabel(),
        authCheckReason,
      );
      return;
    }
    studyPlanGenerateBtn.disabled = true;
    studyPlanStatusEl.textContent = "Generating study plan…";
    const examDate = studyPlanExamEl.value.trim();
    try {
      await invoke("study_plan", {
        root: knowledgeRoot,
        course,
        provider: providerId,
        model: modelSel.value,
        examDate: examDate || null,
      });
      if (currentNotesPath !== pathAtStart) return;
      await loadStudyPlan(course, pathAtStart ?? `${course}/course.md`);
      studyPlanStatusEl.textContent = "";
    } catch (error) {
      if (currentNotesPath !== pathAtStart) return;
      studyPlanStatusEl.textContent = String(error);
    } finally {
      studyPlanGenerateBtn.disabled = false;
    }
  })();
});

explainWeakestBtn.addEventListener("click", () => {
  void (async () => {
    if (!weakestRecommendTopic || !currentCourse) return;
    const course = currentCourse;
    const label = weakestRecommendTopic.label;
    setChatModeButtons("explain");
    setCourseView(course, "chat");
    await loadChat(course);
    chatInputEl.value = `Explain the weakest topic "${label}". Stay inside this course and cite sources.`;
    await sendChatMessage();
  })();
});

makeCardBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
  tryUpdateMakeCardSnapshotFromSelection();
});

makeCardBtn.addEventListener("click", () => {
  const text = makeCardSelectionText;
  const digest = makeCardDigest;
  if (!text || !digest) return;
  makeCardDraft = {
    digest,
    heading: makeCardHeading,
    page: makeCardPage,
  };
  makeCardFrontEl.value = text;
  makeCardBackEl.value = text;
  makeCardErrorEl.textContent = "";
  const citationParts: string[] = [];
  citationParts.push(makeCardDraft.digest);
  if (makeCardDraft.heading) citationParts.push(makeCardDraft.heading);
  if (makeCardDraft.page) citationParts.push(`p. ${makeCardDraft.page}`);
  makeCardCitationEl.textContent = citationParts.join(" · ");
  makeCardDialogEl.showModal();
});

makeCardCancelBtn.addEventListener("click", () => {
  makeCardDialogEl.close();
});

makeCardDialogEl.addEventListener("close", () => {
  clearMakeCardDraft();
});

makeCardSaveBtn.addEventListener("click", () => {
  void (async () => {
    const draft = makeCardDraft;
    if (!knowledgeRoot || !currentCourse || !draft) return;
    const front = makeCardFrontEl.value.trim();
    const back = makeCardBackEl.value.trim();
    if (!front || !back) {
      makeCardErrorEl.textContent = "Front and back are required.";
      return;
    }
    makeCardSaveBtn.disabled = true;
    makeCardErrorEl.textContent = "";
    try {
      const card = await invoke<{ id: string }>("append_card", {
        root: knowledgeRoot,
        course: currentCourse,
        front,
        back,
        digest: draft.digest,
        heading: draft.heading,
        page: draft.page,
      });
      makeCardDialogEl.close();
      pendingFocusCardId = card.id;
      setCourseView(currentCourse, "flashcards");
    } catch (error) {
      makeCardErrorEl.textContent = String(error);
    } finally {
      makeCardSaveBtn.disabled = false;
    }
  })();
});

document.addEventListener("selectionchange", () => {
  refreshMakeCardButton();
});

chatClearBtn.addEventListener("click", () => {
  if (!knowledgeRoot || !currentCourse || chatInFlight) return;
  void (async () => {
    const course = currentCourse!;
    const ok = await confirm(
      `Delete all chat history for ${course}? This cannot be undone.`,
      { title: "Clear history", kind: "warning" },
    );
    if (!ok) return;
    await invoke("clear_chat_history", { root: knowledgeRoot, course });
    chatLines = [];
    renderChatTranscript(course);
    chatStatusEl.textContent = "";
  })();
});

generateStudyArtifactBtn.addEventListener("click", () => {
  if (chatArtifactSel.value === "quiz") {
    void startQuizJob(false);
  } else {
    void startFlashcardJob(false);
  }
});

flashcardFlipBtn.addEventListener("click", () => {
  if (!flashcardReview || flashcardReview.cards.length === 0) return;
  flashcardReview = flipReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardDueBtn.addEventListener("click", () => {
  if (!flashcardFullDeck || flashcardDeckMode === "due") return;
  setFlashcardDeckToggle("due");
  flashcardReview = flashcardSessionForMode(flashcardFullDeck);
  renderCurrentFlashcard();
});

flashcardAllBtn.addEventListener("click", () => {
  if (!flashcardFullDeck || flashcardDeckMode === "full") return;
  setFlashcardDeckToggle("full");
  flashcardReview = flashcardSessionForMode(flashcardFullDeck);
  renderCurrentFlashcard();
});

flashcardAgainBtn.addEventListener("click", () => {
  void gradeCurrentFlashcard("again");
});

flashcardWrongBtn.addEventListener("click", () => {
  void gradeCurrentFlashcard("wrong");
});

flashcardMasteredBtn.addEventListener("click", () => {
  void gradeCurrentFlashcard("mastered");
});

flashcardNextBtn.addEventListener("click", () => {
  if (!flashcardReview || flashcardReview.cards.length === 0) return;
  flashcardReview = nextReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardPrevBtn.addEventListener("click", () => {
  if (!flashcardReview || flashcardReview.cards.length === 0) return;
  flashcardReview = previousReview(flashcardReview);
  renderCurrentFlashcard();
});

flashcardShuffleBtn.addEventListener("click", () => {
  if (!flashcardReview || flashcardReview.cards.length === 0) return;
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
    notePathForStudyDigest(flashcardCourse, card.source.digest),
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
  if (!quizReview || quizReview.selected === null || !knowledgeRoot || !quizCourse) return;
  const question = currentQuestion(quizReview);
  const wasSubmitted = quizReview.submitted;
  const choiceIndex = quizReview.selected;
  const result = submitChoice(quizReview, choiceIndex, quizProgress);
  quizReview = result.review;
  quizProgress = result.progress;
  if (!wasSubmitted && quizReview.submitted) {
    const correct = choiceIndex === question.answer_index;
    const root = knowledgeRoot;
    const course = quizCourse;
    const payload = {
      root,
      course,
      action: "quiz" as const,
      id: question.id,
      result: correct ? ("correct" as const) : ("wrong" as const),
      digest: question.source.digest,
      heading: question.source.heading ?? "",
    };
    progressWrite = progressWrite
      .then(() => invoke("study_progress", payload))
      .then(() => undefined)
      .catch((error) => logLine(`Could not save quiz answer: ${error}`));
  }
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
    notePathForStudyDigest(quizCourse, question.source.digest),
    question.source.heading,
  );
});

updateBtn.addEventListener("click", async () => {
  if (!knowledgeRoot || !modelSel.value) return;
  await refreshAuth();
  if (abortIfSignedOut()) return;
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
  if (abortIfSignedOut()) return;
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
      reloadLibraryAfterSync();
      break;
    case "sync_done":
      logLine(`Synced (${ev.action ?? "ok"})${ev.commit ? `: ${ev.commit}` : ""}`);
      reloadLibraryAfterSync();
      break;
    case "run_done":
      logLine(`\nDone. processed=${ev.processed} failed=${ev.failed} skipped=${ev.skipped}`);
      break;
    case "auth_failed":
      logLine(`${currentProviderLabel()} is not authenticated: ${ev.reason}`);
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
    case "sync_conflict":
      logLine(`Sync conflict: ${ev.message ?? ""}`);
      void openSyncConflictDialog(ev.files?.[0]);
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
  setChatModeButtons("ask");
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
