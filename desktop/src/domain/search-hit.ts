import { courseDisplayName } from "./course.ts";

import type { SearchHit } from "./types";

export function searchHitRelativePath(hit: SearchHit): string {
  return hit.path.includes("/") ? hit.path : `${hit.course}/${hit.path}`;
}

export function isSearchDigestPath(relativePath: string): boolean {
  return relativePath.includes("/digests/") && relativePath.endsWith(".md");
}

export function digestRefFromSearchPath(relativePath: string): string {
  const marker = "digests/";
  const index = relativePath.indexOf(marker);
  if (index >= 0 && relativePath.endsWith(".md")) {
    return relativePath.slice(index);
  }
  return relativePath;
}

export type SearchHitNavigation =
  | { kind: "digest"; course: string; digestRef: string }
  | { kind: "overview"; course: string }
  | { kind: "plan"; course: string }
  | { kind: "overview_with_toast"; course: string };

export function resolveSearchHitNavigation(hit: SearchHit): SearchHitNavigation {
  const rel = searchHitRelativePath(hit);
  if (isSearchDigestPath(rel)) {
    return { kind: "digest", course: hit.course, digestRef: digestRefFromSearchPath(rel) };
  }
  if (rel.endsWith("/course.md")) {
    return { kind: "overview", course: hit.course };
  }
  if (rel.endsWith("/study/plan.md")) {
    return { kind: "plan", course: hit.course };
  }
  return { kind: "overview_with_toast", course: hit.course };
}

export function searchHitMeta(hit: SearchHit): string {
  const pages = hit.page_range ? ` · p.${hit.page_range}` : "";
  return `${courseDisplayName(hit.course)} · ${hit.path}${pages}`;
}

export function searchHitItemValue(hit: SearchHit, index: number): string {
  return `${hit.course}:${hit.path}:${index}`;
}

const SEARCH_HIT_KIND_LABELS: Record<string, string> = {
  course_md: "Course",
  plan: "Plan",
  digest: "Digest",
};

export function searchHitKindLabel(kind: string): string {
  return SEARCH_HIT_KIND_LABELS[kind] ?? kind;
}

export function groupSearchHitsByCourse(hits: SearchHit[]): [string, SearchHit[]][] {
  const map = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const list = map.get(hit.course) ?? [];
    list.push(hit);
    map.set(hit.course, list);
  }
  return [...map.entries()];
}

export function renderSearchHit(hit: SearchHit): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "search-hit";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = hit.title;

  const sub = document.createElement("div");
  sub.className = "sub";
  const pages = hit.page_range ? ` · p.${hit.page_range}` : "";
  sub.textContent = `${hit.course} · ${hit.path}${pages}`;

  const snippet = document.createElement("div");
  snippet.className = "snippet";
  snippet.textContent = hit.snippet;

  btn.append(title, sub, snippet);
  return btn;
}
