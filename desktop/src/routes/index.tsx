import { createFileRoute } from "@tanstack/react-router";

import { ListRow } from "~/components/app/list-row";
import { useCourses } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";
export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const settings = useSettings();
  const root =
    settings.data?.active_root ??
    settings.data?.knowledge_root ??
    settings.data?.knowledge_roots?.[0]?.path ??
    null;
  const courses = useCourses(root);

  return (
    <main className="mx-auto max-w-lg space-y-3 p-6">
      <h1 className="text-lg font-medium">Arbor 6.0 rebuild in progress</h1>
      <p className="text-sm text-muted-foreground">
        Courses for <code className="text-xs">{root}</code>
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {(courses.data ?? []).map((course) => (
          <li key={course}>
            <ListRow title={course} />
          </li>
        ))}
      </ul>
      {import.meta.env.DEV ? (
        <p className="text-sm">
          <a href="#/dev/ui" className="text-primary underline-offset-2 hover:underline">
            Open the dev UI token gallery
          </a>
        </p>
      ) : null}
    </main>
  );
}
