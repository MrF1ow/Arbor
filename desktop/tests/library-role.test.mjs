import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return await import("../src/domain/library-role.ts");
}

test("library recommendation when no override for active root", async () => {
  const { effectiveProvider } = await subject();
  const result = effectiveProvider({
    root: "/data/shared",
    settingsProviderId: "codex",
    settingsModelId: "m-global",
    overrides: [{ path: "/other", provider_id: "grok", model_id: "m-other" }],
    libraryProvider: { id: "ollama", model: "llama" },
  });
  assert.equal(result.source, "library");
  assert.equal(result.providerId, "ollama");
  assert.equal(result.modelId, "llama");
});

test("override for active root wins over library", async () => {
  const { effectiveProvider } = await subject();
  const result = effectiveProvider({
    root: "/data/shared",
    settingsProviderId: "codex",
    settingsModelId: null,
    overrides: [{ path: "/data/shared", provider_id: "fake", model_id: "test" }],
    libraryProvider: { id: "ollama", model: "llama" },
  });
  assert.equal(result.source, "override");
  assert.equal(result.providerId, "fake");
  assert.equal(result.modelId, "test");
});

test("override for different path does not apply", async () => {
  const { effectiveProvider } = await subject();
  const result = effectiveProvider({
    root: "/data/shared",
    settingsProviderId: "codex",
    settingsModelId: "global-model",
    overrides: [{ path: "/elsewhere", provider_id: "grok", model_id: "x" }],
    libraryProvider: null,
  });
  assert.equal(result.source, "settings");
  assert.equal(result.providerId, "codex");
  assert.equal(result.modelId, "global-model");
});

test("viewerBlocksWrite and skillHasWritePermission", async () => {
  const { viewerBlocksWrite, skillHasWritePermission } = await subject();
  assert.equal(viewerBlocksWrite("viewer"), true);
  assert.equal(viewerBlocksWrite("editor"), false);
  assert.equal(viewerBlocksWrite("owner"), false);
  assert.equal(viewerBlocksWrite(null), false);
  assert.equal(skillHasWritePermission(["read_course"]), false);
  assert.equal(skillHasWritePermission(["write_course_study"]), true);
  assert.equal(skillHasWritePermission(["write_export_dir"]), true);
});

test("recommendation label is exact", async () => {
  const { LIBRARY_RECOMMENDATION_LABEL } = await subject();
  assert.equal(LIBRARY_RECOMMENDATION_LABEL, "recommended by library");
});

test("index.html library and provider chrome", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../legacy.html", import.meta.url), "utf8");
  for (const id of [
    "library-role-note",
    "library-members",
    "library-members-save",
    "library-provider-id",
    "library-provider-save",
    "provider-recommendation",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
});
