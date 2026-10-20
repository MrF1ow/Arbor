import { describe, expect, it } from "vitest";

import {
  effectiveProvider,
  LIBRARY_RECOMMENDATION_LABEL,
  skillHasWritePermission,
  viewerBlocksWrite,
} from "~/domain/library-role";

describe("library-role", () => {
  it("library recommendation when no override for active root", () => {
    const result = effectiveProvider({
      root: "/data/shared",
      settingsProviderId: "codex",
      settingsModelId: "m-global",
      overrides: [{ path: "/other", provider_id: "grok", model_id: "m-other" }],
      libraryProvider: { id: "ollama", model: "llama" },
    });
    expect(result.source).toBe("library");
    expect(result.providerId).toBe("ollama");
    expect(result.modelId).toBe("llama");
  });

  it("override for active root wins over library", () => {
    const result = effectiveProvider({
      root: "/data/shared",
      settingsProviderId: "codex",
      settingsModelId: null,
      overrides: [{ path: "/data/shared", provider_id: "fake", model_id: "test" }],
      libraryProvider: { id: "ollama", model: "llama" },
    });
    expect(result.source).toBe("override");
    expect(result.providerId).toBe("fake");
    expect(result.modelId).toBe("test");
  });

  it("viewerBlocksWrite and skillHasWritePermission", () => {
    expect(viewerBlocksWrite("viewer")).toBe(true);
    expect(viewerBlocksWrite("editor")).toBe(false);
    expect(skillHasWritePermission(["write_course_study"])).toBe(true);
  });

  it("recommendation label is exact", () => {
    expect(LIBRARY_RECOMMENDATION_LABEL).toBe("recommended by library");
  });
});
