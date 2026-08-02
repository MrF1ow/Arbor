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

export interface WorkerEvent {
  type: string;
  ts?: string;
  model_id?: string;
  // common optional fields
  lecture_dir?: string;
  source?: string;
  stage?: string;
  status?: string;
  detail?: string;
  message?: string;
  commit?: string;
  lectures?: string[];
  processed?: number;
  failed?: number;
  skipped?: number;
  reason?: string;
  docs_url?: string;
  code?: number;
}
