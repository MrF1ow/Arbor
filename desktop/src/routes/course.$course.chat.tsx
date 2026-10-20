import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export type ChatSearch = {
  mode?: string;
  prompt?: string;
};

export const Route = createFileRoute("/course/$course/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    mode: typeof search.mode === "string" ? search.mode : undefined,
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
  }),
  component: ChatPlaceholder,
});

function ChatPlaceholder() {
  const { course } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={`${courseDisplayName(course)} chat`} description="Chat arrives in PR 11." />
    </div>
  );
}
