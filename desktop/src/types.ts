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

export interface PendingSource {
  path: string;
  course: string;
  source_type: string;
  page_count: number;
  suggested_start_page: number | null;
  previously_digested: boolean;
}

export interface UpdatePlan {
  pending: PendingSource[];
}

export interface Selection {
  path: string;
  start_page: number | null;
}

export interface WorkerEvent {
  type: string;
  ts?: string;
  model_id?: string;
  course_dir?: string;
  source?: string;
  start_page?: number;
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
}
