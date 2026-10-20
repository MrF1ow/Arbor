import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ChatView } from "~/components/chat/chat-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useCourses, useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type ChatSearch = {
  mode?: string;
  prompt?: string;
};

export const Route = createFileRoute("/course/$course/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    mode: typeof search.mode === "string" ? search.mode : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { course } = Route.useParams();
  const { mode, prompt } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const courses = useCourses(activeRoot);
  const digests = useDigests(activeRoot, course);

  const onSearchClear = () => {
    void navigate({
      search: { mode: undefined, prompt: undefined },
      replace: true,
    });
  };

  const onCourseChange = (nextCourse: string) => {
    void navigate({
      to: "/course/$course/chat",
      params: { course: nextCourse },
    });
  };

  return (
    <ChatView
      key={`${activeRoot ?? ""}|${course}`}
      activeRoot={activeRoot}
      course={course}
      courses={courses.data ?? []}
      digests={digests.data ?? []}
      roots={settings.data?.knowledge_roots ?? []}
      modeParam={mode}
      promptParam={prompt}
      onSearchClear={onSearchClear}
      onCourseChange={onCourseChange}
    />
  );
}
