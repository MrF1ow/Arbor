import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";
import { courseDisplayName } from "~/domain/course";

export const Route = createFileRoute("/course/$course/chat")({
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
