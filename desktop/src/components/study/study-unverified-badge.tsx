import { Badge } from "~/components/ui/badge";
import {
  LazyTooltip,
  LazyTooltipContent,
  LazyTooltipTrigger,
} from "~/components/ui/lazy-tooltip";

export function StudyUnverifiedBadge({ reason }: { reason?: string }) {
  return (
    <LazyTooltip>
      <LazyTooltipTrigger
        render={(tooltipProps) => (
          <Badge variant="destructive" className="cursor-default" {...tooltipProps}>
            Unverified
          </Badge>
        )}
      />
      <LazyTooltipContent>{reason ?? "Citation check failed"}</LazyTooltipContent>
    </LazyTooltip>
  );
}
