import { useQuery } from "@tanstack/react-query";

import type { ProviderUsageSummary } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { qk } from "~/lib/queries/keys";

/** Tokens and requests per provider over the last `days` days ("Usage this week"). */
export function useUsageSummary(root: string | null, days: number) {
  return useQuery({
    queryKey: qk.usageSummary(root ?? "", days),
    enabled: Boolean(root),
    queryFn: () => invoke<ProviderUsageSummary[]>("usage_summary", { root: root!, days }),
  });
}
