export type Mode = "notes" | "flashcards" | "quiz" | "graph" | "chat";

export type Appearance = "system" | "light" | "dark";

export interface DigestInfo {
  title: string;
  date: string;
  /** Course-prefixed path, e.g. `Cell Biology/digests/2026-09-12-membranes.md`. */
  path: string;
  /** Sub-folder name of the source the digest came from; null when it sits at the class root. */
  unit?: string | null;
  source_path?: string | null;
}

export interface Model {
  id: string;
  label: string;
}

export interface AuthStatus {
  authenticated: boolean;
  reason: string;
  docs_url: string;
}

export type KnowledgeKind = "personal" | "shared";

export interface SshWorker {
  id: string;
  label: string;
  host: string;
  port: number;
  user?: string | null;
  identity_file?: string | null;
  worker_cmd: string;
  remote_root: string;
}

export interface KnowledgeRootEntry {
  path: string;
  kind: KnowledgeKind;
  name: string;
  worker_id?: string | null;
}

export interface SkillGrant {
  id: string;
  commit: string;
  permissions: string[];
}

export interface ProviderOverride {
  path: string;
  provider_id: string;
  model_id: string | null;
}

export interface Settings {
  knowledge_root: string | null;
  knowledge_roots: KnowledgeRootEntry[];
  active_root: string | null;
  model_id: string | null;
  provider_id: string;
  appearance: Appearance;
  ollama_base_url?: string | null;
  lmstudio_base_url?: string | null;
  skill_index_source?: string;
  skill_index_ref?: string;
  skill_grants?: SkillGrant[];
  provider_overrides?: ProviderOverride[];
  workers?: SshWorker[];
}

export type LibraryRole = "owner" | "editor" | "viewer";

export type LibraryShowResult =
  | { present: false }
  | {
      present: true;
      name: string;
      created_by: string;
      members: { email: string; role: LibraryRole }[];
      provider: { id: string; model: string } | null;
      role: LibraryRole;
    };

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  reason: string;
  docs_url: string;
  models: Model[];
}

export type AlignmentStatus = "clean_append" | "changed" | "ambiguous" | "identical";

export interface PendingSource {
  path: string;
  course: string;
  source_type: string;
  page_count: number;
  suggested_ranges: [number, number][];
  alignment_status: AlignmentStatus;
  previously_digested: boolean;
}

export interface UpdatePlan {
  pending: PendingSource[];
  /**
   * Classes whose notebook a cancelled update left unbuilt. Update rebuilds each one even with no
   * file to process. Absent from plans written by an older worker.
   */
  synthesis_pending?: string[];
}

export interface Selection {
  path: string;
  ranges: [number, number][] | null;
}

export interface KnowledgeSettings {
  delete_sources_after_digest: boolean;
  auto_update: boolean;
  watch_enabled: boolean;
  auto_generate: {
    flashcards: boolean;
    quiz: boolean;
  };
  sync_after_commit: boolean;
}

export interface SyncShowResult {
  remote: string | null;
  shared: boolean;
  sync_remote?: "origin" | "arbor" | null;
  remote_note?: string | null;
}

export interface SyncWorkerResult {
  ok: boolean;
  action: string;
  commit?: string;
  files?: string[];
  head_changed?: boolean;
}

export interface SyncConflictFile {
  path: string;
  binary: boolean;
  mine?: string | null;
  theirs?: string | null;
  choice?: string;
  edit_content?: string;
}

export interface SyncConflictSession {
  strategy: string;
  upstream: string;
  branch: string;
  files: SyncConflictFile[];
}

export interface CardSource {
  digest: string;
  heading: string | null;
  page?: string | null;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  tags: string[];
  source: CardSource;
}

export interface FlashcardDeck {
  schema_version: 1;
  course: string;
  cards: Flashcard[];
}

export interface FlashcardReview {
  cards: Flashcard[];
  index: number;
  flipped: boolean;
}

export interface FlashcardProgressEntry {
  seen: number;
  correct: number;
  wrong: number;
}

export type FlashcardProgress = Record<string, FlashcardProgressEntry>;

export interface QuizQuestion {
  id: string;
  type: "multiple_choice";
  prompt: string;
  choices: [string, string, string, string];
  answer_index: number;
  explanation: string;
  source: CardSource;
}

export interface QuizPack {
  schema_version: 1;
  course: string;
  questions: QuizQuestion[];
}

export type QuizReview =
  | {
      questions: QuizQuestion[];
      index: number;
      selected: number | null;
      submitted: false;
      answers: Record<string, number>;
    }
  | {
      questions: QuizQuestion[];
      index: number;
      selected: number;
      submitted: true;
      answers: Record<string, number>;
    };

export interface QuizProgressEntry {
  seen: number;
  correct: number;
  wrong: number;
}

export type QuizProgress = Record<string, QuizProgressEntry>;

export interface ConceptSource {
  digest: string;
  heading: string | null;
}

export interface ConceptNode {
  id: string;
  name: string;
  summary: string;
  kind: "concept" | "figure";
  sources: ConceptSource[];
}

export interface ConceptEdge {
  from: string;
  to: string;
  relation: string;
  sources: ConceptSource[];
}

export interface ConceptGraph {
  schema_version: 1;
  course: string;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

export interface ConceptNeighbor {
  id: string;
  name: string;
  relation: string;
}

export interface CitationFailure {
  path: string;
  id: string;
  reason: string;
}

export interface CitationsReport {
  schema_version: 1;
  course: string;
  failures: CitationFailure[];
}
export interface SearchHit {
  course: string;
  path: string;
  kind: string;
  title: string;
  snippet: string;
  page_range: string | null;
  source_path: string | null;
}

export interface JobSummary {
  id: string;
  status: string;
  trigger_kind: string;
  skill?: string | null;
  model_id: string | null;
  started_at: string;
  finished_at: string | null;
  error_summary: string | null;
  exit_code: number | null;
  /** The class the job covered; null for legacy rows and updates that span classes. */
  course?: string | null;
  /** Digest paths (study jobs) or source paths (updates); null when unknown or whole-class. */
  digests?: string[] | null;
}

export interface JobEventRow {
  line: string;
  created_at: string;
}

export interface JobFinished {
  job_id: string;
  status: string;
  summary: string | null;
  operation: "update" | "generate";
  root: string;
}

export type StudyRecommendItem = {
  kind: string;
  label: string;
  digest?: string | null;
  heading?: string | null;
};

export interface CourseOverviewPayload {
  due: { due_ids: string[]; count: number; deck_count: number };
  weak: {
    topics: Array<{ label: string; digest?: string; heading?: string | null }>;
  };
  recommend: { items: StudyRecommendItem[] };
}

export interface SkillIndexPackage {
  id: string;
  kind: string;
  name: string;
  description: string;
  commit: string;
  permissions: string[];
  installed?: boolean;
}

export interface WorkerEvent {
  type: string;
  ts?: string;
  model_id?: string;
  course_dir?: string;
  source?: string;
  ranges?: [number, number][];
  digest?: string;
  digests?: number;
  digest_count?: number;
  sources?: number;
  /** `planned.total` and `source_started.total`: sources in the run. */
  total?: number;
  /** `source_started.index`: 1-based position of the source being processed. */
  index?: number;
  stage?: string;
  status?: string;
  detail?: string;
  message?: string;
  commit?: string;
  courses?: string[];
  processed?: number;
  failed?: number;
  skipped?: number;
  after_sources?: number;
  reason?: string;
  docs_url?: string;
  code?: number;
  action?: string;
  force?: boolean;
  provider?: string;
  root?: string;
  page_start?: number;
  page_end?: number;
  skill?: string;
  course?: string;
  file?: string;
  path?: string;
  id?: string;
  attempt?: number;
  attempts?: number;
  files?: string[];
  kind?: string;
  exit_code?: number;
}

/** `study_progress stats`: quiz and card accuracy by week. */
export interface CourseStats {
  quiz: { this_week: { correct: number; total: number }; last_week: { correct: number; total: number } };
  cards: { this_week: { correct: number; total: number }; last_week: { correct: number; total: number } };
}

/** `study_plan_status`: the plan's checklist and how much of it is ticked. */
export interface StudyPlanStatus {
  done: number;
  total: number;
  tasks: { id: string; text: string; done: boolean }[];
}

/** `usage_summary`: one row per provider over the last N days. */
export interface ProviderUsageSummary {
  provider: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  /** Calls where the provider reported both token counts. */
  tokens_known: number;
}
