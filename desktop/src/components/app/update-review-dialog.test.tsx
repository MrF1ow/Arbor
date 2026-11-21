import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpdateReviewDialog } from "~/components/app/update-review-dialog";
import type { PendingSource } from "~/domain/types";
import { clearTauriMocks, installMockIpc } from "~/test/mock-ipc";
import { renderWithProviders } from "~/test/render";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

function manyPending(count: number): PendingSource[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/mock/knowledge/fall-2026/cell-biology/sources/file-${i}.pdf`,
    course: "cell-biology",
    source_type: "pdf",
    page_count: 10,
    suggested_ranges: [],
    alignment_status: "clean_append" as const,
    previously_digested: false,
  }));
}

describe("update review dialog with many files", () => {
  beforeEach(() => {
    installMockIpc();
    useUpdatePlanStore.setState({ pending: manyPending(50), open: true, trigger: "manual" });
  });

  afterEach(() => {
    cleanup();
    clearTauriMocks();
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
  });

  it("scrolls the file list and keeps Cancel and Confirm in the footer", async () => {
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(screen.getAllByRole("textbox")).toHaveLength(50);
    });

    const table = dialog.querySelector("table");
    expect(table).not.toBeNull();
    const scroller = table!.closest("div.overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(dialog.contains(scroller)).toBe(true);
    expect(scroller!.classList.contains("min-h-0")).toBe(true);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(scroller!.contains(cancel)).toBe(false);
    expect(scroller!.contains(confirm)).toBe(false);
    expect(dialog.className).toContain("max-h-dialog-tall");
  });
});
