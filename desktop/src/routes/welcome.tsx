import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { Button } from "~/components/ui/button";
import { openDialog } from "~/lib/ipc";
import { useActivateKnowledgeRootMutation } from "~/lib/queries/active-root";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

function WelcomePage() {
  const activate = useActivateKnowledgeRootMutation();

  const onChoose = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") {
      return;
    }
    await activate.mutateAsync(picked);
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <EmptyState
        icon={FolderOpen}
        title="Choose a Knowledge folder"
        description="Pick a folder to hold your courses and digests. The full welcome flow arrives in PR 6."
        actions={
          <Button onClick={() => void onChoose()}>
            <FolderOpen className="size-icon-sm" />
            Choose Knowledge folder…
          </Button>
        }
      />
    </div>
  );
}
