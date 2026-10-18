export type Mode = "notes" | "flashcards" | "quiz" | "graph" | "chat";

export type Appearance = "system" | "light" | "dark";

export interface DigestInfo {
  title: string;
  date: string;
  path: string;
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

export interface KnowledgeRootEntry {
  path: string;
  kind: KnowledgeKind;
  name: string;
}

export interface SkillGrant {
  id: string;
  commit: string;
  permissions: string[];
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
}

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
}

export interface Selection {
  path: string;
  ranges: [number, number][] | null;
}

export interface KnowledgeSettings {
  delete_sources_after_digest: boolean;
  auto_update: boolean;
  auto_embed: boolean;
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
  model_id: string | null;
  started_at: string;
  finished_at: string | null;
  error_summary: string | null;
  exit_code: number | null;
}

export interface JobEventRow {
  line: string;
  created_at: string;
}

export interface JobFinished {
  job_id: string;
  status: string;
  summary: string | null;
  operation: "update" | "generate" | "embed";
  root: string;
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
  embedded?: number;
  chunks?: number;
  digest_count?: number;
  sources?: number;
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
}
