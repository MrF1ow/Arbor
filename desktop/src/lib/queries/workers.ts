import { useQuery, useQueryClient } from "@tanstack/react-query";

import { pickerProviders, PROVIDER_FALLBACK } from "~/domain/provider";
import type { Model } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useProviderOptions() {
  return pickerProviders([...PROVIDER_FALLBACK]);
}

export function useModels(provider: string | null, root: string | null) {
  return useQuery({
    queryKey: qk.models(provider ?? "", root),
    queryFn: async () => {
      if (!provider) {
        return [];
      }
      const res = await invoke<{ models: Model[] }>("list_models", {
        root: root ?? undefined,
        provider,
      });
      return res.models;
    },
    staleTime: Number.POSITIVE_INFINITY,
    enabled: Boolean(provider),
  });
}

export function useRefreshModels() {
  const queryClient = useQueryClient();
  return (provider: string, root: string | null) => {
    void queryClient.invalidateQueries({ queryKey: qk.models(provider, root) });
  };
}
