import { RefreshCw } from "lucide-react";

import { UnsavedBadge } from "~/components/app/unsaved-badge";
import { Button } from "~/components/ui/button";
import { VIEWER_WRITE_REASON } from "~/domain/library-role";

export function StudyArtifactToolbar({
  stale,
  viewerBlocked,
  jobDisabled,
  onRefresh,
  modelHint,
}: {
  stale: boolean;
  viewerBlocked: boolean;
  jobDisabled: boolean;
  onRefresh: () => void;
  modelHint: string | null;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {stale ? (
        <span className="inline-flex items-center gap-1 text-faint-foreground">
          <RefreshCw className="size-icon-sm" aria-hidden />
          Digests updated since last generation.
        </span>
      ) : null}
      <UnsavedBadge />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={jobDisabled}
        title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
        onClick={onRefresh}
      >
        <RefreshCw className="size-icon-sm" />
        Refresh from digests
      </Button>
      {modelHint ? <span>{modelHint}</span> : null}
    </div>
  );
}
