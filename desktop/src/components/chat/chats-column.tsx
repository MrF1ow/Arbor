import { useNavigate, useSearch } from "@tanstack/react-router";

import { CourseIconDisplay } from "~/components/app/course-icon-display";
import { ChatThreadsPanel, ChatThreadsPanelShowButton } from "~/components/chat/chat-threads-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { courseDisplayName, workspaceRootLabel } from "~/domain/course";
import { classPath } from "~/lib/class-path";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { useCourses } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useUiStore } from "~/stores/ui-store";

/**
 * Ask's left column: the Chats list that stands where the lecture column stands on the other
 * tabs. The open chat is the `?thread=` of the URL. Hidden, it renders nothing and the class
 * header offers Show chats instead.
 */
export function ChatsColumn({ root, course }: { root: string | null; course: string }) {
  const open = useUiStore((s) => s.chatThreadsOpen);
  const { thread } = useSearch({ strict: false }) as { thread?: string };
  const navigate = useNavigate();
  if (!root || !open) {
    return null;
  }
  return (
    <ChatThreadsPanel
      root={root}
      course={course}
      activeThreadId={thread ?? null}
      onSelectThread={(id) =>
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({ ...prev, prompt: undefined, thread: id }),
        })
      }
      onNewChat={() =>
        void navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({ ...prev, prompt: undefined, thread: undefined }),
          replace: true,
        })
      }
    />
  );
}

/** Show chats, in the class header, while the Chats list is hidden. */
export function ShowChatsButton() {
  const open = useUiStore((s) => s.chatThreadsOpen);
  const setOpen = useUiStore((s) => s.setChatThreadsOpen);
  return open ? null : <ChatThreadsPanelShowButton onClick={() => setOpen(true)} />;
}

/** The "Course" select at the right of Ask's class header: opens Ask for another class. */
export function AskCourseSelect({ root, course }: { root: string | null; course: string }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const courses = useCourses(root);
  const courseMeta = useCourseMeta(root);
  const roots = settings.data?.knowledge_roots ?? [];
  const rootEntry = roots.find((entry) => entry.path === root);
  const slugs = courses.data ?? [];
  return (
    <div className="flex w-48 min-w-0 shrink-[4] items-center gap-2.5 text-small text-muted-foreground">
      <span className="hidden xl:inline">Course</span>
      <Select
        value={course}
        items={slugs.map((slug) => ({ value: slug, label: courseDisplayName(slug) }))}
        onValueChange={(value) => {
          if (value && value !== course) {
            void navigate({ ...classPath(value, "ask"), search: {} });
          }
        }}
      >
        <SelectTrigger
          className="w-full min-w-0 flex-1"
          aria-label="Course"
          title={rootEntry ? workspaceRootLabel(rootEntry, roots) : (root ?? "")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {slugs.map((slug) => (
            <SelectItem key={slug} value={slug}>
              <span className="flex items-center gap-2">
                <CourseIconDisplay meta={courseMeta.data} course={slug} />
                {courseDisplayName(slug)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
