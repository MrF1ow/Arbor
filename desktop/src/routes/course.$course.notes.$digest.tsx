import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "~/components/app/page-header";

export const Route = createFileRoute("/course/$course/notes/$digest")({
  component: DigestPlaceholder,
});

function DigestPlaceholder() {
  const { course, digest } = Route.useParams();
  return (
    <div className="p-8">
      <PageHeader title={digest} description={`Digest reading for ${course} arrives in PR 7.`} />
    </div>
  );
}
