import { useState } from "react";

import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import { PROVIDER_FALLBACK, signedOutJobMessage } from "~/domain/provider";
import { fetchAuthStatus } from "~/lib/auth-refresh";
import { useEffectiveProvider } from "~/lib/queries/effective-provider";
import { useLibrary } from "~/lib/queries/library";
import { useJobStore } from "~/stores/job-store";

type StudyJobInput = {
  course: string;
  force: boolean;
  model: string;
  provider: string;
};

export function useStudyJobLauncher(
  activeRoot: string | null,
  options: {
    mutateAsync: (input: StudyJobInput) => Promise<string>;
    isPending: boolean;
    startedMessage: (jobId: string) => string;
    failedMessage: string;
  },
) {
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const effective = useEffectiveProvider(activeRoot);
  const appendLog = useJobStore((s) => s.append);
  const studyJobRunning = useJobStore((s) => s.status) === "running";
  const [modelHint, setModelHint] = useState<string | null>(null);

  const jobDisabled = viewerBlocked || studyJobRunning || options.isPending;

  async function launchStudyJob(course: string, force: boolean) {
    if (!activeRoot || viewerBlocked) {
      return;
    }
    const modelId = effective.modelId?.trim();
    if (!modelId) {
      setModelHint("Select a model in Settings.");
      return;
    }
    setModelHint(null);
    const providerLabel =
      PROVIDER_FALLBACK.find((p) => p.id === effective.providerId)?.label ??
      effective.providerId;
    try {
      const auth = await fetchAuthStatus(effective.providerId, true);
      if (!auth.authenticated) {
        appendLog(signedOutJobMessage(providerLabel, auth.reason));
        return;
      }
    } catch (error) {
      appendLog(signedOutJobMessage(providerLabel, String(error)));
      return;
    }
    try {
      const jobId = await options.mutateAsync({
        course,
        force,
        model: modelId,
        provider: effective.providerId,
      });
      appendLog(options.startedMessage(jobId));
    } catch (error) {
      appendLog(`${options.failedMessage}: ${error}`);
    }
  }

  return {
    viewerBlocked,
    viewerWriteReason: VIEWER_WRITE_REASON,
    modelHint,
    jobDisabled,
    launchStudyJob,
  };
}
