import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearTauriMocks } from "~/test/mock-ipc";

import { createAppQueryClient } from "~/lib/query-client";
import { useImportSourcesMutation } from "~/lib/queries/library";
import { useJobStore } from "~/stores/job-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { clearMockIpcLog, getMockIpcLog } from "~/test/mock-handlers";
import { installMockIpc } from "~/test/mock-ipc";

describe("library mutations", () => {
  afterEach(() => {
    clearTauriMocks();
    useUpdatePlanStore.setState({ pending: null, open: false });
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      lines: [],
      unread: 0,
    });
  });

  it("useImportSourcesMutation plans update after import", async () => {
    clearMockIpcLog();
    const pending = [
      {
        path: "/tmp/lecture.pdf",
        course: "cell-biology",
        source_type: "pdf",
        page_count: 10,
        suggested_ranges: [[1, 10]] as [number, number][],
        alignment_status: "clean_append" as const,
        previously_digested: false,
      },
    ];
    installMockIpc({
      import_sources: () => ["/mock/knowledge/fall-2026/cell-biology/lecture.pdf"],
      plan_update: () => ({ pending }),
      get_knowledge_settings: () => ({
        delete_sources_after_digest: false,
        auto_update: false,
        auto_embed: false,
        watch_enabled: true,
        auto_generate: { flashcards: false, quiz: false },
        sync_after_commit: false,
      }),
    });
    const client = createAppQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useImportSourcesMutation(FIXTURE_ROOT_FALL), { wrapper });
    await result.current.mutateAsync({
      course: "cell-biology",
      paths: ["/tmp/lecture.pdf"],
    });
    await waitFor(() => expect(getMockIpcLog()).toContain("plan_update"));
    expect(useUpdatePlanStore.getState().open).toBe(true);
    expect(useUpdatePlanStore.getState().pending).toEqual(pending);
  });
});
