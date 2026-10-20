import { describe, expect, it } from "vitest";

import {
  resolveSearchHitNavigation,
  searchHitItemValue,
  searchHitKindLabel,
  searchHitMeta,
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

describe("searchHitMeta", () => {
  it("uses course display name, path, and page range", () => {
    expect(searchHitMeta(digestHit)).toBe(
      "Cell Biology · cell-biology/digests/2026-09-12-membranes.md · p.3-5",
    );
  });

  it("omits page suffix when page_range is null", () => {
    expect(
      searchHitMeta({
        ...digestHit,
        page_range: null,
        path: "cell-biology/course.md",
      }),
    ).toBe("Cell Biology · cell-biology/course.md");
  });
});

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

describe("searchHitItemValue", () => {
  it("includes course, path, and index for cmdk uniqueness", () => {
    expect(searchHitItemValue(digestHit, 0)).toBe(
      "cell-biology:cell-biology/digests/2026-09-12-membranes.md:0",
    );
    expect(searchHitItemValue(digestHit, 1)).not.toBe(searchHitItemValue(digestHit, 0));
  });
});

describe("searchHitKindLabel", () => {
  it("maps known kinds to display labels", () => {
    expect(searchHitKindLabel("course_md")).toBe("Course");
    expect(searchHitKindLabel("plan")).toBe("Plan");
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
