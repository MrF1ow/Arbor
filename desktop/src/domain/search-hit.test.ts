import { describe, expect, it } from "vitest";

import {
  resolveSearchHitNavigation,
  searchHitRelativePath,
} from "~/domain/search-hit";
import type { SearchHit } from "~/domain/types";

const digestHit: SearchHit = {
  course: "cell-biology",
  path: "cell-biology/digests/2026-09-12-membranes.md",
  kind: "digest",
  title: "Cell membranes",
  snippet: "snippet",
  page_range: "3-5",
  source_path: null,
};

describe("searchHitRelativePath", () => {
  it("prefixes bare filenames with the course slug", () => {
    expect(searchHitRelativePath({ ...digestHit, path: "notes.md" })).toBe(
      "cell-biology/notes.md",
    );
  });

  it("does not prefix paths that already contain a slash", () => {
    expect(searchHitRelativePath(digestHit)).toBe(
      "cell-biology/digests/2026-09-12-membranes.md",
    );
  });
});

describe("resolveSearchHitNavigation", () => {
  it("routes digest paths to digest navigation", () => {
    expect(resolveSearchHitNavigation(digestHit)).toEqual({
      kind: "digest",
      course: "cell-biology",
      digestRef: "digests/2026-09-12-membranes.md",
    });
  });

  it("routes course.md to overview", () => {
    expect(
      resolveSearchHitNavigation({
        ...digestHit,
        path: "cell-biology/course.md",
      }),
    ).toEqual({ kind: "overview", course: "cell-biology" });
  });

  it("routes study plan to plan navigation", () => {
    expect(
      resolveSearchHitNavigation({
        ...digestHit,
        path: "cell-biology/study/plan.md",
        kind: "plan",
      }),
    ).toEqual({ kind: "plan", course: "cell-biology" });
  });

  it("routes unknown paths to overview with toast", () => {
    expect(
      resolveSearchHitNavigation({
        ...digestHit,
        path: "cell-biology/misc/notes.txt",
      }),
    ).toEqual({ kind: "overview_with_toast", course: "cell-biology" });
  });
});
