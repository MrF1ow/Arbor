export interface DigestInfo {
  name: string;
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

export interface Settings {
  knowledge_root: string | null;
  model_id: string | null;
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
  watch_enabled: boolean;
  auto_generate: {
    flashcards: boolean;
  };
}

export interface CardSource {
  digest: string;
  heading: string | null;
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
  page_start?: number;
  page_end?: number;
}
