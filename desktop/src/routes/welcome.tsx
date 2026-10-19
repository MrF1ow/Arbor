import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "~/components/app/empty-state";
import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";
import markLight from "~/assets/arbor-mark.png";
import markDark from "~/assets/arbor-mark-dark.png";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { canUseDesktopIpc, DESKTOP_ONLY_WELCOME_COPY, TAURI_UNAVAILABLE } from "~/domain/tauri";
import { openDialog } from "~/lib/ipc";
import { useActivateKnowledgeRootMutation } from "~/lib/queries/active-root";
import { useCreateCourseMutation } from "~/lib/queries/library";
import { qk } from "~/lib/queries/keys";
import { useJobStore } from "~/stores/job-store";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

function WelcomePage() {
  const desktopIpc = canUseDesktopIpc();
  const activate = useActivateKnowledgeRootMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appendLog = useJobStore((s) => s.append);
  const [awaitingClass, setAwaitingClass] = useState(false);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);
  const createCourse = useCreateCourseMutation(activeRoot);

  useEffect(() => {
    if (!desktopIpc) {
      appendLog(TAURI_UNAVAILABLE);
    }
  }, [appendLog, desktopIpc]);

  const onChoose = async () => {
    if (!desktopIpc) {
      return;
    }
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") {
        return;
      }
      const { root, repoCreated } = await activate.mutateAsync(picked);
      if (repoCreated) {
        appendLog(`Initialized Knowledge repo at ${root}`);
      }
      const courses = await queryClient.fetchQuery({
        queryKey: qk.courses(root),
        queryFn: async () => {
          const { invoke } = await import("~/lib/ipc");
          return invoke<string[]>("list_courses", { root });
        },
      });
      if (courses[0]) {
        void navigate({ to: "/course/$course/notes", params: { course: courses[0] } });
        return;
      }
      setActiveRoot(root);
      setAwaitingClass(true);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onCreateClass = async () => {
    const name = className.trim();
    if (!name) {
      setClassError("Enter a class name.");
      return;
    }
    if (!activeRoot) {
      setClassError("Choose a Knowledge folder first.");
      return;
    }
    try {
      const slug = await createCourse.mutateAsync(name);
      setClassName("");
      setClassError(null);
      void navigate({ to: "/course/$course/notes", params: { course: slug } });
    } catch (error) {
      setClassError(String(error));
    }
  };

  const description = desktopIpc
    ? "Choose a Knowledge folder, add a class, and drop lecture files in from the app. Arbor reads them and writes study notes."
    : DESKTOP_ONLY_WELCOME_COPY;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-header shrink-0 items-center border-b border-border px-4">
        <SidebarHeaderTrigger />
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        {awaitingClass && activeRoot ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
            <img src={markLight} alt="" className="size-18 dark:hidden" />
            <img src={markDark} alt="" className="hidden size-18 dark:block" />
            <h2 className="font-serif text-2xl font-medium">Add your first class</h2>
            <p className="text-sm text-muted-foreground">
              Name a course folder under your Knowledge library, then add lecture files from the
              course header.
            </p>
            <div className="flex w-full flex-col gap-2">
              <Input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="Class name"
                aria-label="Class name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void onCreateClass();
                  }
                }}
              />
              {classError ? <p className="text-2xs text-destructive">{classError}</p> : null}
              <Button className="w-full" onClick={() => void onCreateClass()}>
                Create class
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Welcome to Arbor"
            description={description}
            media={
              <>
                <img src={markLight} alt="" className="mx-auto size-18 dark:hidden" />
                <img src={markDark} alt="" className="mx-auto hidden size-18 dark:block" />
              </>
            }
            actions={
              <Button
                data-testid="welcome-choose-folder"
                disabled={!desktopIpc || activate.isPending}
                onClick={() => void onChoose()}
              >
                <FolderOpen className="size-icon-sm" />
                Choose Knowledge folder…
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
