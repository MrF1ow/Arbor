import { describe, expect, it } from "vitest";

import { classHref, classPath, lecturesFromSearch, lecturesToSearch } from "~/lib/class-path";

describe("classPath", () => {
  it("gives the I7 route for every tab", () => {
    expect(classPath("Cell Biology", "overview")).toEqual({
      to: "/course/$course/overview",
      params: { course: "Cell Biology" },
    });
    expect(classPath("Cell Biology", "map").to).toBe("/course/$course/map");
    expect(classPath("Cell Biology", "cards").to).toBe("/course/$course/practice/cards");
    expect(classPath("Cell Biology", "quiz").to).toBe("/course/$course/practice/quiz");
    expect(classPath("Cell Biology", "ask").to).toBe("/course/$course/ask");
  });

  it("read takes the digest file", () => {
    expect(classPath("Cell Biology", "read", "2026-09-12-membranes")).toEqual({
      to: "/course/$course/read/$digest",
      params: { course: "Cell Biology", digest: "2026-09-12-membranes" },
    });
  });

  it("read without a digest is a programming error", () => {
    expect(() => classPath("Cell Biology", "read")).toThrow(/digest/);
  });
});

describe("classHref", () => {
  it("is the concrete pathname, encoded", () => {
    expect(classHref("Cell Biology", "cards")).toBe("/course/Cell%20Biology/practice/cards");
    expect(classHref("Cell Biology", "read", "a")).toBe("/course/Cell%20Biology/read/a");
  });
});

describe("lectures search param", () => {
  const digests = ["Cell Biology/digests/a.md", "Cell Biology/digests/b,c.md"];

  it("round-trips course-prefixed digests, commas included", () => {
    expect(lecturesFromSearch(lecturesToSearch(digests))).toEqual(digests);
  });

  it("is absent when nothing is ticked", () => {
    expect(lecturesToSearch([])).toBeUndefined();
    expect(lecturesFromSearch(undefined)).toEqual([]);
    expect(lecturesFromSearch("")).toEqual([]);
  });
});
