import type { KnowledgeRootEntry } from "~/domain/types";

const ROMAN = new Set(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);

export function courseDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      if (ROMAN.has(lower)) {
        return lower.toUpperCase();
      }
      if (lower.length === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function workspaceRootLabel(entry: KnowledgeRootEntry, all: KnowledgeRootEntry[]): string {
  const dupes = all.filter((e) => e.name === entry.name);
  if (dupes.length <= 1) {
    return entry.name;
  }
  const trimmed = entry.path.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  return parent ? `${entry.name} (${parent})` : entry.name;
}
