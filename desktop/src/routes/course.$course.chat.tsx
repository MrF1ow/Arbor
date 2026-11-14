import { createFileRoute } from "@tanstack/react-router";

import { AskPage } from "~/components/chat/ask-page";

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
  component: AskPage,
});
