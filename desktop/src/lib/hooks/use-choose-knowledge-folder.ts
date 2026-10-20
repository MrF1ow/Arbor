import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { canUseDesktopIpc } from "~/domain/tauri";
import { openDialog } from "~/lib/ipc";
import { useActivateKnowledgeRootMutation } from "~/lib/queries/active-root";
import { fetchCourses } from "~/lib/queries/library";
import { qk } from "~/lib/queries/keys";
import { useJobStore } from "~/stores/job-store";

export function useChooseKnowledgeFolder() {
  const desktopIpc = canUseDesktopIpc();
  const activate = useActivateKnowledgeRootMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appendLog = useJobStore((s) => s.append);

  const chooseFolder = async () => {
    if (!desktopIpc) {
      return;
    }
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") {
        return;
      }
      const { root, repoCreated, initRepoError } = await activate.mutateAsync(picked);
      if (repoCreated) {
        appendLog(`Initialized git repository in ${root}`);
      }
      if (initRepoError) {
        appendLog(`Could not initialize git: ${initRepoError}`);
      }
      const courses = await queryClient.fetchQuery({
        queryKey: qk.courses(root),
        queryFn: () => fetchCourses(root),
      });
      if (courses[0]) {
        void navigate({ to: "/course/$course/notes", params: { course: courses[0] } });
        return;
      }
      void navigate({ to: "/welcome", search: { addClass: true, root } });
    } catch (error) {
      toast.error(String(error));
    }
  };

  return { chooseFolder, isPending: activate.isPending, desktopIpc };
}
