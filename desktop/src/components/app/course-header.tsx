import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CircleHelp,
  Layers,
  MessageSquare,
  Plus,
  Search,
  Share2,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { openDialog } from "~/lib/ipc";
import { useDigests, useImportSourcesMutation } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { modShortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";

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
  const { open: sidebarOpen } = useSidebar();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const roots = settings.data?.knowledge_roots ?? [];
  const rootEntry = roots.find((r) => r.path === activeRoot);
  const rootLabel = rootEntry ? workspaceRootLabel(rootEntry, roots) : activeRoot ?? "";
  const digests = useDigests(activeRoot, course);
  const digestCount = digests.data?.length ?? 0;
  const importSources = useImportSourcesMutation(activeRoot);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const onAddFiles = async () => {
    if (!activeRoot) {
      return;
    }
    const picked = await openDialog({
      multiple: true,
      filters: [{ name: "Lecture files", extensions: ["pdf", "pptx", "docx"] }],
    });
    const paths = typeof picked === "string" ? [picked] : picked;
    if (!paths || paths.length === 0) {
      return;
    }
    await importSources.mutateAsync({ course, paths });
  };

  return (
    <header className="flex h-header shrink-0 items-stretch gap-3 border-b border-border px-4">
      {!sidebarOpen ? (
        <div className="flex items-center">
          <SidebarTrigger />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-baseline gap-2 self-center">
        <h1 className="truncate font-serif text-title font-medium">{courseDisplayName(course)}</h1>
        <span className="truncate text-xs text-faint-foreground">
          {rootLabel} · {digestCount} digests
        </span>
      </div>
      <nav className="hidden items-end gap-5 self-stretch lg:flex" aria-label="Course modes">
        {MODES.map((mode) => {
          const active = pathname.includes(`/course/${course}/${mode.segment}`);
          return (
            <Link
              key={mode.id}
              to={mode.to}
              params={{ course }}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 border-transparent px-0.5 pb-2 text-sm text-muted-foreground transition-colors duration-fast ease-out-soft",
                active && "border-primary text-foreground",
              )}
            >
              <mode.icon className={cn("size-icon-sm", active && "text-primary")} />
              {mode.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 self-center">
        <Button variant="outline" size="sm" onClick={() => void onAddFiles()}>
          <Plus className="size-icon-sm" />
          Add files
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSearch}>
          <Search className="size-icon-sm" />
          Search
          <Kbd>{modShortcut("K")}</Kbd>
        </Button>
      </div>
    </header>
  );
}
