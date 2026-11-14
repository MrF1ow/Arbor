import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { UnsavedBadge } from "~/components/app/unsaved-badge";
import { useStudyModelLabel } from "~/components/study/use-study-model-label";
import { Button } from "~/components/ui/button";
import { VIEWER_WRITE_REASON } from "~/domain/library-role";

/** "Digests updated since last generation.", Refresh from digests, and the model that would run it. */
export function StudyArtifactToolbar({
  stale,
  viewerBlocked,
  jobDisabled,
  onRefresh,
  modelHint,
  trailing,
}: {
  stale: boolean;
  viewerBlocked: boolean;
  jobDisabled: boolean;
  onRefresh: () => void;
  modelHint: string | null;
  /** Pinned to the right end of the row (Restart on the quiz). */
  trailing?: ReactNode;
}) {
  const modelLabel = useStudyModelLabel();
  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-caption text-muted-foreground">
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
        Refresh from digests
      </Button>
      {modelHint ? <span>{modelHint}</span> : modelLabel ? <span>{modelLabel}</span> : null}
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}
