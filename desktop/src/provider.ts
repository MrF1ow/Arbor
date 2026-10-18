export function authCheckWorkerFailureReason(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (message === "") {
    return "Arbor worker unavailable";
  }
  return `Arbor worker unavailable: ${message}`;
}

export function isWorkerUnavailableAuthReason(reason: string): boolean {
  return reason.startsWith("Arbor worker unavailable");
}

export function signedOutJobMessage(providerLabel: string, reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return `${providerLabel} is not authenticated`;
  }
  return `${providerLabel} is not authenticated: ${trimmed}`;
}

export function providerBadge(
  providerLabel: string,
  modelLabel: string,
  available: boolean,
  reason?: string,
): string {
  if (available) {
    return `${modelLabel} · ready`;
  }
  if (reason === "key missing") {
    return `${providerLabel} · key missing`;
  }
  if (reason?.includes("not running")) {
    return `${providerLabel} · not running`;
  }
  if (reason?.includes("disabled inside a Claude Code session")) {
    return `${providerLabel} · disabled in this session`;
  }
  return `${providerLabel} · not signed in`;
}

export function pickerProviders(
  rows: { id: string; label: string }[],
): { id: string; label: string }[] {
  return rows.filter((row) => row.id !== "fake");
}
