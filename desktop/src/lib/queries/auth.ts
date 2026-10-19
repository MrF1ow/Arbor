import { useQuery } from "@tanstack/react-query";

import { fetchAuthStatus } from "~/lib/auth-refresh";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

export function useAuth(provider: string) {
  return useQuery({
    queryKey: qk.auth(provider),
    queryFn: () => fetchAuthStatus(provider, false),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    enabled: Boolean(provider),
  });
}

export function useProviderSecretStatus(provider: string) {
  return useQuery({
    queryKey: qk.providerSecret(provider),
    enabled: provider === "openai_api" || provider === "anthropic_api",
    queryFn: () => invoke<string>("provider_secret_status", { providerId: provider }),
  });
}
