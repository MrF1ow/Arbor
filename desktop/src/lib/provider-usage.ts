import type { UsageLimits } from "~/domain/usage";
import { invoke } from "~/lib/ipc";

export function fetchProviderUsage(provider: string, force = false): Promise<UsageLimits> {
  return invoke<UsageLimits>("read_provider_usage", { provider, force });
}
