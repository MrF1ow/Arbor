import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "~/components/app/empty-state";
import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";
import markLight from "~/assets/arbor-mark.png";
import markDark from "~/assets/arbor-mark-dark.png";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DESKTOP_ONLY_WELCOME_COPY, TAURI_UNAVAILABLE } from "~/domain/tauri";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { useCreateCourseMutation } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useJobStore } from "~/stores/job-store";

type WelcomeSearch = {
  addClass?: boolean;
  root?: string;
};

export const Route = createFileRoute("/welcome")({
  validateSearch: (search: Record<string, unknown>): WelcomeSearch => ({
    addClass: search.addClass === true || search.addClass === "true" || search.addClass === "1",
    root: typeof search.root === "string" ? search.root : undefined,
  }),
  component: WelcomePage,
});

function WelcomePage() {
  const { addClass, root: searchRoot } = Route.useSearch();
  const settings = useSettings();
  const { chooseFolder, isPending, desktopIpc } = useChooseKnowledgeFolder();
  const navigate = useNavigate();
  const appendLog = useJobStore((s) => s.append);
  const classRoot = searchRoot ?? pickActiveRoot(settings.data);
  const showAddClassStep = Boolean(addClass && classRoot);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);
  const createCourse = useCreateCourseMutation(classRoot);

  useEffect(() => {
    if (!desktopIpc) {
      appendLog(TAURI_UNAVAILABLE);
    }
  }, [appendLog, desktopIpc]);

  const onCreateClass = async () => {
    const name = className.trim();
    if (!name) {
      setClassError("Enter a class name.");
      return;
    }
    if (!classRoot) {
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
        {showAddClassStep && classRoot ? (
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
            titleClassName="text-2xl"
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
                disabled={!desktopIpc || isPending}
                onClick={() => void chooseFolder()}
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
