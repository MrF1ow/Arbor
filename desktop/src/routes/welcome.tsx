import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { Button } from "~/components/ui/button";
import { invoke, openDialog } from "~/lib/ipc";
import { useActivateKnowledgeRootMutation } from "~/lib/queries/active-root";
import { qk } from "~/lib/queries/keys";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

function WelcomePage() {
  const activate = useActivateKnowledgeRootMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onChoose = async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") {
        return;
      }
      const root = await activate.mutateAsync(picked);
      const courses = await queryClient.fetchQuery({
        queryKey: qk.courses(root),
        queryFn: () => invoke<string[]>("list_courses", { root }),
      });
      if (courses[0]) {
        void navigate({ to: "/course/$course/notes", params: { course: courses[0] } });
      }
    } catch (error) {
      toast.error(String(error));
    }
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
