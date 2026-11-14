import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DESKTOP_ONLY_WELCOME_COPY, TAURI_UNAVAILABLE } from "~/domain/tauri";
import { classPath } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { qk } from "~/lib/queries/keys";
import { useCreateCourseMutation, useJoinLibraryMutation } from "~/lib/queries/library";
import { saveSettingsSerialized, useSettings } from "~/lib/queries/settings";
import { useJobStore } from "~/stores/job-store";

const LibraryJoinDialog = lazy(() =>
  import("~/components/settings/library-join-dialog").then((m) => ({
    default: m.LibraryJoinDialog,
  })),
);

function Step({
  number,
  done,
  title,
  children,
}: {
  number: number;
  done?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex gap-3.5 rounded-xl border border-border bg-card p-4 shadow-card">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-small font-semibold text-accent-foreground">
        {done ? <Check className="size-icon-sm" aria-label="Done" /> : number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-heading text-foreground">{title}</h2>
        {children}
      </div>
    </section>
  );
}

/**
 * First run (design frames 5337 / 6522): shown at `/` and `/welcome` while no library exists, and on
 * `/welcome?addClass` right after a folder was chosen. Three steps: Choose a folder or join a shared
 * library, add a class, update knowledge.
 */
export function FirstRun({ addClass = false, root }: { addClass?: boolean; root?: string }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const { chooseFolder, isPending, desktopIpc } = useChooseKnowledgeFolder();
  const appendLog = useJobStore((s) => s.append);
  const classRoot = root ?? pickActiveRoot(settings.data);
  const createCourse = useCreateCourseMutation(classRoot);
  const queryClient = useQueryClient();
  const joinLibrary = useJoinLibraryMutation();
  const switchRoot = useSwitchActiveRootMutation();
  const [joinOpen, setJoinOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [className, setClassName] = useState("");
  const [classError, setClassError] = useState<string | null>(null);
  const formOpen = Boolean(classRoot) && (adding || addClass);

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
      void navigate(classPath(slug, "overview"));
    } catch (error) {
      setClassError(String(error));
    }
  };

  /** Join a shared library: clone it, add it to the libraries, make it active, then land on Today. */
  const onJoinLibrary = async (url: string, dest: string) => {
    const result = await joinLibrary.mutateAsync({ url, dest });
    const path = String((result as { path?: string }).path ?? dest);
    const name = String((result as { name?: string }).name ?? "Joined library");
    await saveSettingsSerialized(queryClient, (current) => {
      const roots = current.knowledge_roots ?? [];
      const existing = roots.find((e) => e.path === path);
      const knowledge_roots = existing
        ? roots.map((e) => (e.path === path ? { ...e, kind: "shared" as const, name } : e))
        : [...roots, { path, kind: "shared" as const, name }];
      return { ...current, knowledge_roots };
    });
    await switchRoot.mutateAsync(path);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.settings() }),
      queryClient.invalidateQueries({ queryKey: qk.library(path) }),
      queryClient.invalidateQueries({ queryKey: qk.courses(path) }),
      queryClient.invalidateQueries({ queryKey: qk.sync(path) }),
    ]);
    toast.success("Joined library.");
    setJoinOpen(false);
    void navigate({ to: "/" });
  };

  return (
    <div data-testid="first-run" className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col gap-4 px-6 pt-5.5 pb-8">
        <header className="flex flex-col">
          <h1 className="text-title text-foreground">Welcome to Arbor</h1>
          <p className="text-small text-muted-foreground">
            {desktopIpc
              ? "Arbor turns your lectures into notes, cards and quizzes. Everything stays in one folder as Markdown."
              : DESKTOP_ONLY_WELCOME_COPY}
          </p>
        </header>

        <div className="flex max-w-160 flex-col gap-4">
        <Step number={1} done={Boolean(classRoot)} title="Choose a Knowledge folder">
          <p className="text-small text-muted-foreground">
            A git-tracked folder for your classes. Arbor writes digests, cards and quizzes beside your files.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              data-testid="welcome-choose-folder"
              disabled={!desktopIpc || isPending}
              onClick={() => void chooseFolder()}
            >
              Choose folder…
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!desktopIpc}
              onClick={() => setJoinOpen(true)}
            >
              Join a shared library
            </Button>
          </div>
        </Step>

        <Step number={2} title="Add a class and its lectures">
          <p className="text-small text-muted-foreground">
            One folder per class, one per lecture. Handwritten or GoodNotes markup → export as PDF. Clean
            slides → PPTX is fine.
          </p>
          {formOpen ? (
            <div className="flex max-w-sm flex-col gap-2">
              <Input
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="Class name"
                aria-label="Class name"
                autoFocus={addClass}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void onCreateClass();
                  }
                }}
              />
              {classError ? <p className="text-micro text-destructive">{classError}</p> : null}
              <div>
                <Button size="sm" onClick={() => void onCreateClass()}>
                  Create class
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={!classRoot}
                title={classRoot ? undefined : "Choose a Knowledge folder first"}
                onClick={() => setAdding(true)}
              >
                + Add class
              </Button>
            </div>
          )}
        </Step>

        <Step number={3} title="Update knowledge">
          <p className="text-small text-muted-foreground">
            Arbor reads each new file and writes lecture.md, metadata, cards and a quiz, then commits them.
          </p>
          <div>
            <span className="rounded-xs bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
              Needs a signed-in provider
            </span>
          </div>
        </Step>
        </div>
      </div>
      <Suspense fallback={null}>
        {joinOpen ? (
          <LibraryJoinDialog
            open={joinOpen}
            onOpenChange={setJoinOpen}
            busy={joinLibrary.isPending}
            onConfirm={onJoinLibrary}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
