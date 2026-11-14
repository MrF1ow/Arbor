import { useParams, useSearch } from "@tanstack/react-router";

import { DigestView } from "~/components/notes/digest-view";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigests } from "~/lib/queries/library";
import { useSettings } from "~/lib/queries/settings";

/**
 * The body of the Read route and of the old `notes/$digest` route, so both import a component and
 * stay code-split; it reads its params without a fixed route.
 */
export function ReadPage() {
  const { course, digest } = useParams({ strict: false }) as { course: string; digest: string };
  const { heading } = useSearch({ strict: false }) as { heading?: string };
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const digests = useDigests(activeRoot, course);

  return (
    <DigestView
      key={digest}
      course={course}
      digestSlug={digest}
      digests={digests.data ?? []}
      heading={heading}
    />
  );
}
