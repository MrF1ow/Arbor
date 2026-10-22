import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { ChatView } from "~/components/chat/chat-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChatThreads } from "~/lib/queries/chat";
import { useCourses, useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

export type ChatSearch = {
  mode?: string;
  prompt?: string;
  thread?: string;
};

export const Route = createFileRoute("/course/$course/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    mode: typeof search.mode === "string" ? search.mode : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { course } = Route.useParams();
  const { mode, prompt, thread } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const courses = useCourses(activeRoot);
  const digests = useDigests(activeRoot, course);
  const threadsQuery = useChatThreads(activeRoot, course);
  const allowAutoSelectRef = useRef(!prompt?.trim());

  useEffect(() => {
    allowAutoSelectRef.current = !prompt?.trim();
  }, [course, activeRoot, prompt]);

  useEffect(() => {
    if (thread || prompt?.trim()) {
      return;
    }
    if (!allowAutoSelectRef.current) {
      return;
    }
    if (!threadsQuery.isFetched || (threadsQuery.data?.length ?? 0) === 0) {
      return;
    }
    allowAutoSelectRef.current = false;
    void navigate({
      search: (prev) => ({ ...prev, thread: threadsQuery.data![0]!.id }),
      replace: true,
    });
  }, [thread, prompt, threadsQuery.isFetched, threadsQuery.data, navigate]);

  const onSearchClear = () => {
    void navigate({
      search: { mode: undefined, prompt: undefined, thread },
      replace: true,
    });
  };

  const onModeSearchClear = () => {
    void navigate({
      search: (prev) => ({ ...prev, mode: undefined }),
      replace: true,
    });
  };

  const onCourseChange = (nextCourse: string) => {
    void navigate({
      to: "/course/$course/chat",
      params: { course: nextCourse },
    });
  };

  const onThreadChange = (nextThreadId: string, replace = false) => {
    void navigate({
      to: "/course/$course/chat",
      params: { course },
      search: { mode, prompt: undefined, thread: nextThreadId },
      replace,
    });
  };

  const onNewChatNavigate = () => {
    allowAutoSelectRef.current = false;
    void navigate({
      to: "/course/$course/chat",
      params: { course },
      search: { mode, prompt: undefined, thread: undefined },
      replace: true,
    });
  };

  return (
    <ChatView
      key={`${activeRoot ?? ""}|${course}|${thread ?? "new"}`}
      activeRoot={activeRoot}
      course={course}
      courses={courses.data ?? []}
      digests={digests.data ?? []}
      roots={settings.data?.knowledge_roots ?? []}
      threadId={thread ?? null}
      modeParam={mode}
      promptParam={prompt}
      onSearchClear={onSearchClear}
      onModeSearchClear={onModeSearchClear}
      onCourseChange={onCourseChange}
      onThreadChange={onThreadChange}
      onNewChatNavigate={onNewChatNavigate}
    />
  );
}
