import { describe, expect, it } from "vitest";

import { courseDisplayName } from "~/domain/course";

describe("courseDisplayName", () => {
  it("capitalises each hyphen part of a slug", () => {
    expect(courseDisplayName("cell-biology")).toBe("Cell Biology");
    expect(courseDisplayName("organic-chemistry-ii")).toBe("Organic Chemistry II");
    expect(courseDisplayName("history-ii")).toBe("History II");
  });

  it("keeps a typed name as typed", () => {
    expect(courseDisplayName("Cell Biology")).toBe("Cell Biology");
    expect(courseDisplayName("BIOL 2410")).toBe("BIOL 2410");
    expect(courseDisplayName("iOS Development")).toBe("iOS Development");
    expect(courseDisplayName("eBay Strategy")).toBe("eBay Strategy");
    expect(courseDisplayName("Pre-Med Biology")).toBe("Pre-Med Biology");
    expect(courseDisplayName("Chem 101 - Fall")).toBe("Chem 101 - Fall");
    expect(courseDisplayName("intro to AI")).toBe("intro to AI");
  });

  it("turns only a slug-like folder name into words", () => {
    expect(courseDisplayName("intro_to_ai")).toBe("Intro To Ai");
    expect(courseDisplayName("biology")).toBe("Biology");
    expect(courseDisplayName("pre-med")).toBe("Pre Med");
  });
});
