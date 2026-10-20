import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { JobsView } from "~/components/jobs/jobs-view";

export type JobsSearch = {
  job?: string;
};

export const Route = createFileRoute("/jobs")({
  validateSearch: (search: Record<string, unknown>): JobsSearch => ({
    job: typeof search.job === "string" ? search.job : undefined,
  }),
  component: JobsPage,
});

function JobsPage() {
  const { job } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const onJobParamSync = useCallback(
    (jobId: string | undefined) => {
      void navigate({
        search: (prev) => ({ ...prev, job: jobId }),
        replace: true,
      });
    },
    [navigate],
  );

  return <JobsView jobParam={job} onJobParamSync={onJobParamSync} />;
};
