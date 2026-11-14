import { createFileRoute } from "@tanstack/react-router";

import { AskPage } from "~/components/chat/ask-page";
import { classSearchFrom, type ClassSearch } from "~/lib/class-path";

export type AskSearch = ClassSearch & {
  mode?: string;
  prompt?: string;
  thread?: string;
};

export const Route = createFileRoute("/course/$course/ask")({
  validateSearch: (search: Record<string, unknown>): AskSearch => ({
    ...classSearchFrom(search),
    mode: typeof search.mode === "string" ? search.mode : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
  }),
  component: AskPage,
});
