import { Suspense, lazy } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

const ProviderUsagePopoverContent = lazy(() =>
  import("~/components/app/provider-usage-popover-content").then((m) => ({
    default: m.ProviderUsagePopoverContent,
  })),
);

export function ProviderUsagePopover({
  trigger,
  open,
  onOpenChange,
  effectiveProviderId,
  effectiveLabel,
  modelLabel,
}: {
  trigger: React.ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effectiveProviderId: string;
  effectiveLabel: string;
  modelLabel: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" side="top" className="w-auto p-0">
        {open ? (
          <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading…</div>}>
            <ProviderUsagePopoverContent
              effectiveProviderId={effectiveProviderId}
              effectiveLabel={effectiveLabel}
              modelLabel={modelLabel}
              open={open}
            />
          </Suspense>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
