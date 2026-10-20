import type { KnowledgeRootEntry, Settings, SshWorker } from "~/domain/types";

export function generateWorkerId(): string {
  return `w${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function parseWorkerPort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 22;
  }
  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

export type WorkerFormResult =
  | { ok: true; worker: SshWorker }
  | { ok: false; message: string };

export function readWorkerFromForm(input: {
  forId: string;
  label: string;
  host: string;
  portRaw: string;
  user: string;
  identityFile: string;
  workerCmd: string;
  remoteRoot: string;
}): WorkerFormResult {
  const label = input.label.trim();
  const host = input.host.trim();
  const worker_cmd = input.workerCmd.trim();
  const remote_root = input.remoteRoot.trim();
  if (!label || !host || !worker_cmd || !remote_root) {
    return {
      ok: false,
      message: "Label, host, worker command, and remote root are required.",
    };
  }
  const port = parseWorkerPort(input.portRaw);
  if (port === null) {
    return { ok: false, message: "Port must be between 1 and 65535." };
  }
  const userRaw = input.user.trim();
  const identityRaw = input.identityFile.trim();
  return {
    ok: true,
    worker: {
      id: input.forId,
      label,
      host,
      port,
      user: userRaw ? userRaw : null,
      identity_file: identityRaw ? identityRaw : null,
      worker_cmd,
      remote_root,
    },
  };
}

export function upsertWorker(workers: SshWorker[], worker: SshWorker, editingId: string | null): SshWorker[] {
  if (editingId) {
    const idx = workers.findIndex((w) => w.id === editingId);
    if (idx < 0) {
      return workers;
    }
    const next = workers.slice();
    next[idx] = worker;
    return next;
  }
  return [...workers, worker];
}

export function removeWorkerFromSettings(settings: Settings, workerId: string): Settings {
  const workers = (settings.workers ?? []).filter((w) => w.id !== workerId);
  const knowledge_roots = (settings.knowledge_roots ?? []).map((entry) =>
    entry.worker_id === workerId ? { ...entry, worker_id: null } : entry,
  );
  return { ...settings, workers, knowledge_roots };
}

export function setRootWorkerOnSettings(
  settings: Settings,
  entryPath: string,
  workerId: string | null,
): Settings {
  const knowledge_roots = (settings.knowledge_roots ?? []).map((entry) =>
    entry.path === entryPath ? { ...entry, worker_id: workerId } : entry,
  );
  return { ...settings, knowledge_roots };
}

export function workerPortDisplay(port: number): string {
  return port === 22 ? "" : String(port);
}

export function fillWorkerFormFields(worker: SshWorker) {
  return {
    label: worker.label,
    host: worker.host,
    portRaw: workerPortDisplay(worker.port),
    user: worker.user ?? "",
    identityFile: worker.identity_file ?? "",
    workerCmd: worker.worker_cmd,
    remoteRoot: worker.remote_root,
  };
}

export function knowledgeRootLabel(entry: KnowledgeRootEntry): string {
  return entry.name || entry.path;
}
