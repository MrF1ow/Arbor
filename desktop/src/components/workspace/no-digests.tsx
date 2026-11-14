import { Loader2, Plus } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { useAddFiles } from "~/components/workspace/use-add-files";
import { Button } from "~/components/ui/button";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { useLibrary } from "~/lib/queries/library";
import { cn } from "~/lib/utils";

/** What Overview and Read show for a class with no digests yet. */
export function NoDigestsEmptyState({ root, course }: { root: string | null; course: string }) {
  const { addFiles, busy } = useAddFiles(root, course);
  const library = useLibrary(root);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const Icon = busy ? Loader2 : Plus;
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <EmptyState
        title="No digests yet"
        description="Add lecture files to generate study notes for this class."
        actions={
          <Button
            disabled={busy || viewerBlocked}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => void addFiles()}
          >
            <Icon className={cn("size-icon-sm", busy && "animate-spin")} />
            Add files
          </Button>
        }
      />
    </div>
  );
}
