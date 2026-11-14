import { useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";

import { UsageLimitsBody } from "~/components/app/provider-usage-popover-content";
import { SettingRow } from "~/components/app/settings-section";
import { SettingsGroup } from "~/components/settings/settings-page";
import { IconButton } from "~/components/ui/button";
import { PROVIDER_FALLBACK } from "~/domain/provider";
import type { ProviderUsageSummary } from "~/domain/types";
import { formatCheckedAgo } from "~/domain/usage";
import { useNow } from "~/hooks/use-now";
import { fetchProviderUsage } from "~/lib/provider-usage";
import { useAuth } from "~/lib/queries/auth";
import { qk } from "~/lib/queries/keys";
import { useProviderUsage } from "~/lib/queries/provider-usage";
import { useUsageSummary } from "~/lib/queries/usage";

const USAGE_DAYS = 7;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function providerLabel(id: string): string {
  return PROVIDER_FALLBACK.find((p) => p.id === id)?.label ?? id;
}

function tokensOf(row: ProviderUsageSummary): number {
  return row.input_tokens + row.output_tokens;
}

/** Tokens and requests over the last week, summed over every provider that reported. */
export function UsageThisWeek({ root }: { root: string | null }) {
  const usage = useUsageSummary(root, USAGE_DAYS);
  const rows = usage.data ?? [];
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);
  const tokens = rows.reduce((sum, row) => sum + tokensOf(row), 0);
  const unreported = rows.reduce((sum, row) => sum + Math.max(0, row.requests - row.tokens_known), 0);

  return (
    <SettingsGroup title="Usage this week">
      {!root ? (
        <p className="px-4 py-3 text-small text-muted-foreground">Choose a Knowledge folder to see usage</p>
      ) : usage.isLoading ? (
        <p className="px-4 py-3 text-small text-muted-foreground">Reading usage…</p>
      ) : usage.isError ? (
        <p className="px-4 py-3 text-small text-muted-foreground">Couldn&apos;t read usage.</p>
      ) : requests === 0 ? (
        <p className="px-4 py-3 text-small text-muted-foreground">No usage yet this week.</p>
      ) : (
        <>
          <SettingRow
            label="Tokens"
            description={
              unreported > 0
                ? `${unreported} ${unreported === 1 ? "request" : "requests"} reported no token counts.`
                : "Input and output, all providers."
            }
            control={<span className="text-small tabular-nums">{compact.format(tokens)}</span>}
          />
          <SettingRow
            label="Requests"
            description={rows.map((row) => `${providerLabel(row.provider)} ${row.requests}`).join(" · ")}
            control={<span className="text-small tabular-nums">{compact.format(requests)}</span>}
          />
        </>
      )}
    </SettingsGroup>
  );
}

/** The provider's limit windows, reset times and Refresh (no link back to this page). */
function ProviderLimitsBody({
  providerId,
  providerLabel,
  modelLabel,
  now,
}: {
  providerId: string;
  providerLabel: string;
  modelLabel: string;
  now: number;
}) {
  const queryClient = useQueryClient();
  const auth = useAuth(providerId);
  const usage = useProviderUsage(providerId, { enabled: true, refetchInterval: 5 * 60_000 });

  const onRefresh = () => {
    void fetchProviderUsage(providerId, true)
      .then((data) => {
        queryClient.setQueryData(qk.providerUsage(providerId), data);
      })
      .catch(() => {
        queryClient.setQueryData(qk.providerUsage(providerId), {
          checked_at: new Date().toISOString(),
          windows: [],
          unavailable: { reason: "probe_failed", message: "Could not read usage limits." },
        });
      });
  };

  if (auth.isLoading) {
    return <p className="text-xs text-muted-foreground">Checking sign-in…</p>;
  }
  if (!auth.data?.authenticated) {
    return <p className="text-xs text-muted-foreground">{providerLabel} is not signed in.</p>;
  }
  if (usage.isLoading && !usage.data) {
    return <p className="text-xs text-muted-foreground">Reading usage…</p>;
  }
  const limits = usage.data;
  if (!limits) {
    return <p className="text-xs text-muted-foreground">Couldn&apos;t read usage.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="truncate text-sm font-medium">
        {providerLabel} · {modelLabel}
      </p>
      <UsageLimitsBody limits={limits} now={now} />
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">{formatCheckedAgo(limits.checked_at, now)}</span>
        <IconButton
          variant="ghost"
          size="icon-sm"
          icon={RotateCw}
          label="Refresh usage"
          tooltip={false}
          onClick={onRefresh}
        />
      </div>
    </div>
  );
}

/** The old usage popover's content: the provider's limit windows, reset times and Refresh. */
export function ProviderLimits({
  providerId,
  label,
  modelLabel,
}: {
  providerId: string | null;
  label: string;
  modelLabel: string;
}) {
  const now = useNow(60_000);
  if (!providerId) {
    return null;
  }
  return (
    <SettingsGroup title="Provider limits">
      <div className="px-4 py-3">
        <ProviderLimitsBody providerId={providerId} providerLabel={label} modelLabel={modelLabel} now={now} />
      </div>
    </SettingsGroup>
  );
}
