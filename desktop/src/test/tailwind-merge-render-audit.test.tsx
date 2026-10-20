import { clsx } from "clsx";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { twMerge as twMergePlain } from "tailwind-merge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";

import { UpdateReviewDialog } from "~/components/app/update-review-dialog";
import { twMerge as twMergeExtended } from "~/lib/tailwind-merge-config";
import { fixturePendingSources } from "~/test/fixtures/data";
import { renderAppAtRoute, renderWithProviders } from "~/test/render";
import { useUiStore } from "~/stores/ui-store";
import { useUpdatePlanStore } from "~/stores/update-plan-store";

export type MergeAuditEntry = {
  mergedInput: string;
  plain: string;
  extended: string;
  site: string;
};

const auditEntries: MergeAuditEntry[] = [];

function siteFromStack(stack: string): string {
  const lines = stack.split("\n");
  for (const line of lines) {
    const match = line.match(/\/desktop\/src\/(.+\.(?:tsx|ts)):(\d+):\d+/);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
  }
  return "unknown";
}

vi.mock("~/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/utils")>();
  return {
    ...actual,
    cn: (...inputs: Parameters<typeof actual.cn>) => {
      const mergedInput = clsx(inputs);
      const plain = twMergePlain(mergedInput);
      const extended = twMergeExtended(mergedInput);
      if (plain !== extended) {
        auditEntries.push({
          mergedInput,
          plain,
          extended,
          site: siteFromStack(new Error().stack ?? ""),
        });
      }
      return extended;
    },
  };
});

function dedupeEntries(entries: MergeAuditEntry[]): MergeAuditEntry[] {
  const seen = new Set<string>();
  const out: MergeAuditEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.site}\0${entry.mergedInput}\0${entry.plain}\0${entry.extended}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

async function waitForOverview() {
  await waitFor(() => {
    expect(screen.getByText("Course overview")).toBeInTheDocument();
  });
}

async function openSearchPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  await waitFor(() => {
    expect(within(screen.getByRole("dialog")).getByLabelText("Search digests")).toBeInTheDocument();
  });
}

describe("tailwind-merge render audit", { timeout: 120_000 }, () => {
  beforeEach(() => {
    auditEntries.length = 0;
    localStorage.clear();
    useUiStore.persist.clearStorage();
    useUiStore.setState({
      appearance: "system",
      sidebarOpen: true,
      sidebarTouched: true,
      logOpen: false,
      logHeight: 200,
      notesIndexOpen: true,
      searchSemantic: false,
      lastCourse: null,
    });
    useUpdatePlanStore.setState({ pending: null, open: false, trigger: "manual" });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
  });

  afterEach(() => {
    cleanup();
    clearMocks();
    vi.restoreAllMocks();
  });

  it("collects cn merge diffs across primary screens", async () => {
    const user = userEvent.setup();
    const routes = [
      "/course/cell-biology/notes",
      "/course/cell-biology/notes/2026-09-12-membranes",
      "/course/cell-biology/flashcards",
      "/course/cell-biology/quiz",
      "/course/cell-biology/graph",
      "/course/cell-biology/chat",
      "/welcome",
    ] as const;

    for (const route of routes) {
      cleanup();
      await renderAppAtRoute(route);
      if (route.includes("/notes") && !route.includes("/notes/")) {
        await waitForOverview();
      }
    }
    cleanup();
    await renderAppAtRoute("/course/cell-biology/notes");
    await waitForOverview();
    await openSearchPalette(user);
    cleanup();
    useUpdatePlanStore.setState({
      pending: fixturePendingSources,
      open: true,
      trigger: "manual",
    });
    renderWithProviders(<UpdateReviewDialog />, { minimal: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const unique = dedupeEntries(auditEntries);
    expect(unique.length).toBeGreaterThan(0);
    expect(unique.some((e) => e.mergedInput.includes("top-palette-top"))).toBe(true);
  });
});
