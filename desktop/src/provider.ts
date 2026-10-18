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
): string {
  if (available) {
    return `${modelLabel} · ready`;
  }
  return `${providerLabel} · not signed in`;
}

export function pickerProviders(
  rows: { id: string; label: string }[],
): { id: string; label: string }[] {
  return rows.filter((row) => row.id !== "fake");
}
