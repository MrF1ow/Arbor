import { useQuery } from "@tanstack/react-query";

import type { SearchHit } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

const SEARCH_LIMIT = 20;

export type SearchQueryResult = {
  query: string;
  hits: SearchHit[];
};

export function useSearch(root: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.search(root ?? "", trimmed, false),
    enabled: Boolean(root && trimmed),
    queryFn: async () => {
      const forQuery = trimmed;
      const hits = await invoke<SearchHit[]>("search_knowledge", {
        root: root!,
        query: forQuery,
        limit: SEARCH_LIMIT,
      });
      return { query: forQuery, hits };
    },
  });
}

export function useSemanticSearch(root: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: qk.search(root ?? "", trimmed, true),
    enabled: Boolean(root && trimmed),
    queryFn: async () => {
      const forQuery = trimmed;
      const hits = await invoke<SearchHit[]>("search_semantic", {
        root: root!,
        query: forQuery,
        limit: SEARCH_LIMIT,
      });
      return { query: forQuery, hits };
    },
  });
}
