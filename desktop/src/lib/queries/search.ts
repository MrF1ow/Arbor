import { useQuery } from "@tanstack/react-query";

import type { SearchHit } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

const SEARCH_LIMIT = 20;

export function useSearch(root: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.search(root ?? "", trimmed, false),
    enabled: Boolean(root && trimmed),
    queryFn: () =>
      invoke<SearchHit[]>("search_knowledge", {
        root: root!,
        query: trimmed,
        limit: SEARCH_LIMIT,
      }),
  });
}

export function useSemanticSearch(root: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.search(root ?? "", trimmed, true),
    enabled: Boolean(root && trimmed),
    queryFn: () =>
      invoke<SearchHit[]>("search_semantic", {
        root: root!,
        query: trimmed,
        limit: SEARCH_LIMIT,
      }),
  });
}
