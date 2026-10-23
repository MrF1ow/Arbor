import { useQuery } from "@tanstack/react-query";

import { canUseDesktopIpc } from "~/domain/tauri";
import { fetchProviderUsage } from "~/lib/provider-usage";
import { qk } from "~/lib/queries/keys";

const STALE_MS = 5 * 60_000;
const REFETCH_MS = 5 * 60_000;

export function useProviderUsage(
  providerId: string | null,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  },
) {
  const enabled = Boolean(providerId) && (options?.enabled ?? true) && canUseDesktopIpc();
  return useQuery({
    queryKey: qk.providerUsage(providerId ?? ""),
    queryFn: () => fetchProviderUsage(providerId ?? "", false),
    staleTime: STALE_MS,
    refetchInterval: options?.refetchInterval ?? false,
    enabled,
  });
}

export { STALE_MS as PROVIDER_USAGE_STALE_MS, REFETCH_MS as PROVIDER_USAGE_REFETCH_MS };
