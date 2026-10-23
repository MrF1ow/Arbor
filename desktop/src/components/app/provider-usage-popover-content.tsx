import { Link } from "@tanstack/react-router";
import { Gauge, RotateCw, TrendingDown, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useNow } from "~/hooks/use-now";

import { IconButton } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { PROVIDER_FALLBACK } from "~/domain/provider";
import type { LimitPace, UsageLimits, UsageWindow } from "~/domain/usage";
import {
  formatCheckedAgo,
  formatResetsIn,
  formatResetsOnDate,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "~/domain/usage";
import { fetchProviderUsage } from "~/lib/provider-usage";
import { useAuth } from "~/lib/queries/auth";
import { qk } from "~/lib/queries/keys";
import { useProviderUsage } from "~/lib/queries/provider-usage";
import { cn } from "~/lib/utils";

const PACE: Record<
  LimitPace,
  { label: string; icon: typeof Gauge }
> = {
  ahead: {
    label: "Ahead of pace: spending faster than the window elapses",
    icon: TrendingUp,
  },
  on: { label: "On pace with the window", icon: Gauge },
  under: {
    label: "Under pace: headroom left for the rest of the window",
    icon: TrendingDown,
  },
};

function PaceIcon({ pace }: { pace: LimitPace }) {
  const Icon = PACE[pace].icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={PACE[pace].label}
            className="inline-flex text-muted-foreground"
          />
        }
      >
        <Icon className="size-icon-xs" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="top">{PACE[pace].label}</TooltipContent>
    </Tooltip>
  );
}

function UsageWindowRow({ window, now }: { window: UsageWindow; now: number }) {
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const pace = paceOf(window, now);
  const resetsIn = formatResetsIn(window, now);
  const resetsOn = window.resets_at ? formatResetsOnDate(window.resets_at) : null;
  const barColor =
    remaining < 10 ? "bg-destructive" : "bg-primary";
  const summary = `${window.label}: ${remaining}% left${
    timeLeft === null ? "" : `, ${timeLeft}% of the window left`
  }${resetsIn ? `, ${resetsIn}` : ""}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">{window.label}</span>
        <span className="shrink-0 font-medium tabular-nums">{remaining}% left</span>
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="img"
                aria-label={summary}
                tabIndex={0}
                className="relative h-2 min-w-0 flex-1 cursor-default overflow-hidden rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            }
          >
            <div
              className={cn("usage-window-fill absolute inset-y-0 left-0 rounded-full", barColor)}
              style={{ "--usage-window-fill": `${remaining}%` } as React.CSSProperties}
            />
            {timeLeft !== null ? (
              <span
                aria-hidden
                className="usage-window-pace absolute inset-y-0 w-px -translate-x-1/2 bg-foreground"
                style={
                  {
                    "--usage-window-pace": `clamp(2px, ${timeLeft}%, calc(100% - 2px))`,
                  } as React.CSSProperties
                }
              />
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex flex-col gap-0.5">
              <span>
                {remaining}% left
                {timeLeft !== null ? ` · ${timeLeft}% of the window left` : ""}
              </span>
              {resetsOn ? (
                <span className="text-muted-foreground">
                  Resets {resetsOn}
                  {resetsIn ? ` · ${resetsIn}` : ""}
                </span>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
        {pace ? <PaceIcon pace={pace} /> : null}
        <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
          {resetsIn ?? (resetsOn ? `Resets ${resetsOn}` : "")}
        </span>
      </div>
    </div>
  );
}

export function UsagePanelBody({
  providerId,
  providerLabel,
  modelLabel,
  enabled,
  refetchInterval,
  now,
}: {
  providerId: string;
  providerLabel: string;
  modelLabel: string;
  enabled: boolean;
  refetchInterval: number | false;
  now: number;
}) {
  const queryClient = useQueryClient();
  const auth = useAuth(providerId);
  const usage = useProviderUsage(providerId, { enabled, refetchInterval });

  const onRefresh = () => {
    void fetchProviderUsage(providerId, true)
      .then((data) => {
        queryClient.setQueryData(qk.providerUsage(providerId), data);
      })
      .catch(() => {
        queryClient.setQueryData(qk.providerUsage(providerId), {
          checked_at: new Date().toISOString(),
          windows: [],
          unavailable: {
            reason: "probe_failed",
            message: "Could not read usage limits.",
          },
        });
      });
  };

  if (auth.isLoading) {
    return <p className="text-xs text-muted-foreground">Checking sign-in…</p>;
  }
  if (!auth.data?.authenticated) {
    return (
      <p className="text-xs text-muted-foreground">
        {providerLabel} is not signed in.
      </p>
    );
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {providerLabel} · {modelLabel}
          </p>
        </div>
        <Link
          to="/settings/provider"
          className="shrink-0 text-xs text-primary underline-offset-4 hover:underline"
        >
          Settings
        </Link>
      </div>
      <UsageLimitsBody limits={limits} now={now} />
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">
          {formatCheckedAgo(limits.checked_at, now)}
        </span>
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

export function UsageLimitsBody({ limits, now }: { limits: UsageLimits; now: number }) {
  if (limits.unavailable?.reason === "unsupported") {
    return (
      <p className="text-xs text-muted-foreground">
        This provider doesn&apos;t report usage limits.
      </p>
    );
  }
  if (limits.unavailable?.reason === "probe_failed") {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t read usage
        {limits.unavailable.message ? `: ${limits.unavailable.message}` : "."}
      </p>
    );
  }
  if (limits.windows.length === 0) {
    return <p className="text-xs text-muted-foreground">No limits reported.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {limits.windows.map((window) => (
        <UsageWindowRow key={window.id} window={window} now={now} />
      ))}
    </div>
  );
}

function OtherProviderRow({
  providerId,
  label,
  popoverOpen,
  now,
}: {
  providerId: string;
  label: string;
  popoverOpen: boolean;
  now: number;
}) {
  const auth = useAuth(providerId);
  if (!auth.data?.authenticated) {
    return null;
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs text-muted-foreground hover:text-foreground">
        <span>{label}</span>
        <span className="text-muted-foreground">Show</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <UsagePanelBody
          providerId={providerId}
          providerLabel={label}
          modelLabel="—"
          enabled={popoverOpen}
          refetchInterval={false}
          now={now}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ProviderUsagePopoverContent({
  effectiveProviderId,
  effectiveLabel,
  modelLabel,
  open,
}: {
  effectiveProviderId: string;
  effectiveLabel: string;
  modelLabel: string;
  open: boolean;
}) {
  const now = useNow(60_000);
  const auth = useAuth(effectiveProviderId);
  const signedIn = auth.data?.authenticated === true;
  const effectiveEnabled = open && signedIn;
  const refetchInterval =
    effectiveEnabled ? 5 * 60_000 : false;

  const others = PROVIDER_FALLBACK.filter((row) => row.id !== effectiveProviderId);

  return (
    <div className="flex max-h-96 w-80 flex-col gap-3 overflow-y-auto p-3">
      <h2 className="sr-only">{effectiveLabel}</h2>
      <UsagePanelBody
        providerId={effectiveProviderId}
        providerLabel={effectiveLabel}
        modelLabel={modelLabel}
        enabled={effectiveEnabled}
        refetchInterval={refetchInterval}
        now={now}
      />
      <div className="border-t border-border pt-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Other providers</p>
        <div className="flex flex-col gap-1">
          {others.map((row) => (
            <OtherProviderRow
              key={row.id}
              providerId={row.id}
              label={row.label}
              popoverOpen={open}
              now={now}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
