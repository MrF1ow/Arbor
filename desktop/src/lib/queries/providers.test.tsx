import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { createAppQueryClient } from "~/lib/query-client";
import { useAuth } from "~/lib/queries/auth";
import { useChatHistory } from "~/lib/queries/chat";
import { useApplyEffectiveProvider } from "~/lib/queries/effective-provider";
import { useJobs, usePlanUpdate } from "~/lib/queries/jobs";
import { useCourses, useDigests, useLibrary } from "~/lib/queries/library";
import { useCourseOverview, useMarkdown } from "~/lib/queries/notes";
import { useSettings, useKnowledgeSettings } from "~/lib/queries/settings";
import { useSkillIndex } from "~/lib/queries/skills";
import { useStudyJson, useQuizProgress } from "~/lib/queries/study";
import { useSyncState } from "~/lib/queries/sync";
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
  useAuth("grok", root);
  useModels("grok", root);
  useApplyEffectiveProvider(root);
  useLibrary(root);
  useCourses(root);
  useDigests(root, course);
  useMarkdown(root, `${course}/course.md`);
  useCourseOverview(root, course);
  useStudyJson(root, course, "flashcards.json");
  useQuizProgress(root, course);
  useJobs(root);
  usePlanUpdate(root);
  useSyncState(root);
  useSkillIndex();
  useChatHistory(root, course);
  return null;
}

describe("provider queries", () => {
  afterEach(() => {
    clearMocks();
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
