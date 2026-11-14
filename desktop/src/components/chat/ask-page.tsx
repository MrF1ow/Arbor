import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { ChatView } from "~/components/chat/chat-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useChatThreads } from "~/lib/queries/chat";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
import { useTickedLectures } from "~/stores/lecture-selection-store";
import { useSelectionStore, type AskFocus } from "~/stores/selection-store";

/**
 * The Ask view: one chat of the class, opened on the newest chat unless the URL names a thread, a
 * prompt or a mode. The Chats list and the class header around it belong to the workspace.
 */
export function AskPage() {
  const { course } = useParams({ strict: false }) as { course: string };
  const { mode, prompt, thread } = useSearch({ strict: false }) as {
    mode?: string;
    prompt?: string;
    thread?: string;
  };
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);
  const threadsQuery = useChatThreads(activeRoot, course);
  const hasSearchParams = Boolean(mode || prompt || thread);
  const allowAutoSelectRef = useRef(!hasSearchParams);
  const tickedLectures = useTickedLectures(activeRoot, course);

  // "Ask about this" hands over a passage through the selection store. It is taken once on
  // entering Ask and cleared; a passage of another class is dropped. It is kept with the library it
  // was taken in, so a switch to a same-named class of another library drops it unsent.
  const [taken, setTaken] = useState<{ root: string; course: string; focus: AskFocus } | null>(null);
  useEffect(() => {
    if (!activeRoot) {
      return;
    }
    const pending = useSelectionStore.getState().askFocus;
    if (!pending) {
      return;
    }
    useSelectionStore.getState().setAskFocus(null);
    // A focused question belongs in a new chat, not in the newest one.
    allowAutoSelectRef.current = false;
    if (pending.digest.startsWith(`${course}/`)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the store
      setTaken({ root: activeRoot, course, focus: pending });
    }
  }, [course, activeRoot]);
  useEffect(() => {
    if (taken && taken.root !== activeRoot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drop the focus of another library
      setTaken(null);
    }
  }, [taken, activeRoot]);
  const focus = taken?.course === course && taken.root === activeRoot ? taken.focus : null;

  useEffect(() => {
    if (mode || prompt || thread) {
      allowAutoSelectRef.current = false;
    }
  }, [course, activeRoot, mode, prompt, thread]);

  useEffect(() => {
    if (mode || prompt || thread || !allowAutoSelectRef.current) {
      return;
    }
    if (!threadsQuery.isFetched || (threadsQuery.data?.length ?? 0) === 0) {
      return;
    }
    allowAutoSelectRef.current = false;
    // Lectures ticked on entry ("Ask about these") scope a new question, so they start a new chat.
    if (tickedLectures.length > 0) {
      return;
    }
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, thread: threadsQuery.data![0]!.id }),
      replace: true,
    });
  }, [course, thread, mode, prompt, threadsQuery.isFetched, threadsQuery.data, tickedLectures, navigate]);

  // Search changes stay on the current path and are made against
  // the URL as it is now: a send moves the chat into `?thread=` before these run.
  const onSearchClear = () => {
    allowAutoSelectRef.current = false;
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, mode: undefined, prompt: undefined }),
      replace: true,
    });
  };

  const onModeSearchClear = () => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, mode: undefined }),
      replace: true,
    });
  };

  const onThreadChange = (nextThreadId: string, replace = false) => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, prompt: undefined, thread: nextThreadId }),
      replace,
    });
  };

  return (
    <ChatView
      key={`${activeRoot ?? ""}|${course}|${thread ?? "new"}`}
      activeRoot={activeRoot}
      course={course}
      digests={digests.data ?? []}
      threadId={thread ?? null}
      modeParam={mode}
      promptParam={prompt}
      focus={focus}
      onFocusUsed={() => setTaken(null)}
      onSearchClear={onSearchClear}
      onModeSearchClear={onModeSearchClear}
      onThreadChange={onThreadChange}
    />
  );
}
