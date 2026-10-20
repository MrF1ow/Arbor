import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { useAuth, useProviderSecretStatus } from "~/lib/queries/auth";
import { useChatHistory } from "~/lib/queries/chat";
import { useJobEvents, useJobs } from "~/lib/queries/jobs";
import { useCourses, useDigests, useLibrary } from "~/lib/queries/library";
import { useCourseOverview, useMarkdown } from "~/lib/queries/notes";
import { useSearch, useSemanticSearch } from "~/lib/queries/search";
import { useSettings, useKnowledgeSettings } from "~/lib/queries/settings";
import { useSkillIndex } from "~/lib/queries/skills";
import { useStudyJson, useQuizProgress, useStudyPlan } from "~/lib/queries/study";
import { useSyncConflict, useSyncState } from "~/lib/queries/sync";
import { useModels, useProviderOptions } from "~/lib/queries/workers";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

function AllReadHooks() {
  const root = FIXTURE_ROOT_FALL;
  const course = "cell-biology";
  useProviderOptions();
  useSettings();
  useKnowledgeSettings(root);
  useAuth("grok");
  useProviderSecretStatus("openai_api");
  useModels("grok", root);
  useLibrary(root);
  useCourses(root);
  useDigests(root, course);
  useMarkdown(root, `${course}/course.md`);
  useCourseOverview(root, course);
  useStudyJson(root, course, "flashcards.json");
  useQuizProgress(root, course);
  useStudyPlan(root, course);
  useJobs(root);
  useJobEvents(root, "job-ok-1");
  useSyncState(root);
  useSyncConflict(root);
  useSkillIndex();
  useChatHistory(root, course);
  useSearch(root, "membrane");
  useSemanticSearch(root, "membrane");
  return null;
}

describe("provider queries", () => {
  afterEach(() => {
    clearTauriMocks();
  });

  it("never invokes list_providers", async () => {
    installMockIpc();
    clearMockIpcLog();
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <AllReadHooks />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getMockIpcLog().length).toBeGreaterThan(0));
    expect(getMockIpcLog()).not.toContain("list_providers");
  });
});
