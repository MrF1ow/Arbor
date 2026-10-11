import type { SearchHit } from "./types";

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
