import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CircleHelp,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

import { Suspense, lazy } from "react";

import { CourseIconDisplay } from "~/components/app/course-icon-display";
import { SidebarHeaderTrigger } from "~/components/app/sidebar-header-trigger";
import { Button, IconButton } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { openDialog } from "~/lib/ipc";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { useDigests, useImportSourcesMutation, useLibrary } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";

const CourseIconPicker = lazy(() =>
  import("~/components/app/course-icon-picker").then((m) => ({ default: m.CourseIconPicker })),
);

const MODES = [
  { id: "notes", label: "Notes", icon: BookOpen, segment: "notes", to: "/course/$course/notes" as const },
  {
    id: "flashcards",
    label: "Flashcards",
    icon: Layers,
    segment: "flashcards",
    to: "/course/$course/flashcards" as const,
  },
  { id: "quiz", label: "Quiz", icon: CircleHelp, segment: "quiz", to: "/course/$course/quiz" as const },
  { id: "graph", label: "Graph", icon: Share2, segment: "graph", to: "/course/$course/graph" as const },
  { id: "chat", label: "Chat", icon: MessageSquare, segment: "chat", to: "/course/$course/chat" as const },
];

export function CourseHeader({
  course,
  onOpenSearch,
}: {
  course: string;
  onOpenSearch: () => void;
}) {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const rootEntry = roots.find((r) => r.path === activeRoot);
  const rootLabel = rootEntry ? workspaceRootLabel(rootEntry, roots) : activeRoot ?? "";
  const digests = useDigests(activeRoot, course);
  const courseMeta = useCourseMeta(activeRoot);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const iconChangeDisabled = viewerBlocked || library.isPending;
  const digestCount = digests.data?.length ?? 0;
  const importSources = useImportSourcesMutation(activeRoot);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onAddFiles = async () => {
    if (!activeRoot) {
      return;
    }
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Lecture files", extensions: ["pdf", "pptx", "docx"] }],
      });
      const paths = typeof picked === "string" ? [picked] : picked;
      if (!paths || paths.length === 0) {
        return;
      }
      await importSources.mutateAsync({ course, paths });
    } catch (error) {
      toast.error(String(error));
    }
  };

  const importBusy = importSources.isPending;
  const AddFilesIcon = importBusy ? Loader2 : Plus;

  const searchLabel = `Search (${modShortcut("K")})`;

  return (
    <header className="@container/course-header flex h-header min-w-0 shrink-0 items-stretch gap-2 border-b border-border px-4 @[880px]/course-header:gap-3">
      <SidebarHeaderTrigger className="self-center" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2 self-center">
        {activeRoot ? (
          <Suspense
            fallback={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Change course icon"
                disabled={iconChangeDisabled}
                title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
                className="inline-flex shrink-0 self-center"
              >
                <CourseIconDisplay meta={courseMeta.data} course={course} className="size-icon" />
              </Button>
            }
          >
            <CourseIconPicker
              root={activeRoot}
              course={course}
              meta={courseMeta.data}
              role={role}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Change course icon"
                  disabled={iconChangeDisabled}
                  title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
                  className="inline-flex shrink-0 self-center"
                >
                  <CourseIconDisplay meta={courseMeta.data} course={course} className="size-icon" />
                </Button>
              }
            />
          </Suspense>
        ) : null}
        <h1 className="truncate font-serif text-title font-medium">{courseDisplayName(course)}</h1>
        <span className="min-w-0 truncate text-xs text-faint-foreground">
          {rootLabel} · {digestCount} digests
        </span>
      </div>
      <nav
        className="flex min-w-0 shrink items-stretch gap-2 self-stretch overflow-x-auto @[880px]/course-header:gap-3"
        aria-label="Course modes"
      >
        {MODES.map((mode) => {
          const active = pathname.includes(`/course/${course}/${mode.segment}`);
          return (
            <Link
              key={mode.id}
              to={mode.to}
              params={{ course }}
              aria-label={mode.label}
              aria-current={active ? "page" : undefined}
              title={mode.label}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-y-2 border-transparent px-0.5 text-sm text-muted-foreground transition-colors duration-fast ease-out-soft",
                active && "border-b-primary text-foreground",
              )}
            >
              <mode.icon className={cn("size-icon-sm", active && "text-primary")} />
              <span className="hidden @[880px]/course-header:inline">{mode.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5 self-center @[880px]/course-header:gap-2">
        <IconButton
          icon={AddFilesIcon}
          label={importBusy ? "Adding files…" : "Add files"}
          size="icon-sm"
          variant="outline"
          className={cn(
            "@[880px]/course-header:hidden",
            importBusy && "[&_svg]:animate-spin",
          )}
          disabled={importBusy}
          onClick={() => void onAddFiles()}
        />
        <Button
          variant="outline"
          size="sm"
          className="hidden @[880px]/course-header:inline-flex"
          disabled={importBusy}
          onClick={() => void onAddFiles()}
        >
          <AddFilesIcon className={cn("size-icon-sm", importBusy && "animate-spin")} />
          Add files
        </Button>
        <IconButton
          icon={Search}
          label={searchLabel}
          size="icon-sm"
          variant="outline"
          className="@[880px]/course-header:hidden"
          onClick={onOpenSearch}
        />
        <Button
          variant="outline"
          size="sm"
          className="hidden @[880px]/course-header:inline-flex"
          onClick={onOpenSearch}
        >
          <Search className="size-icon-sm" />
          Search
          <Kbd>{modShortcut("K")}</Kbd>
        </Button>
      </div>
    </header>
  );
}
