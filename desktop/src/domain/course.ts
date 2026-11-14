import type { KnowledgeRootEntry } from "~/domain/types";

const ROMAN = new Set(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);

/** An all-lower-case folder name with its words joined by hyphens or underscores. */
const SLUG = /^[\p{Ll}\p{N}]+(?:[-_][\p{Ll}\p{N}]+)*$/u;

/**
 * "cell-biology" → "Cell Biology". Only a slug-like folder name (all lower case, no spaces,
 * words joined by hyphens or underscores) is turned into words, each with a capital first
 * letter; a lone Roman numeral ("ii") goes upper case. Any other name is a typed one and is
 * kept exactly as typed ("iOS Development", "Pre-Med Biology", "BIOL 2410").
 */
export function courseDisplayName(name: string): string {
  if (!SLUG.test(name)) {
    return name;
  }
  return name
    .split(/[-_]/)
    .map((part) => (ROMAN.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
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
