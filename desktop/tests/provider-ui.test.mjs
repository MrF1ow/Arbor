import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function subject() {
  try {
    return await import("../src/provider.ts");
  } catch (error) {
    assert.fail(`provider module could not load: ${error}`);
  }
}

test("index.html exposes provider controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /id="provider-status"/);
  assert.match(html, /id="provider"/);
  assert.doesNotMatch(html, /id="codex-status"/);

  const settingsStart = html.indexOf('data-panel="settings"');
  assert.notEqual(settingsStart, -1);
  const settingsSlice = html.slice(settingsStart);
  const providerIdx = settingsSlice.indexOf('id="provider"');
  const modelIdx = settingsSlice.indexOf('id="model"');
  assert.notEqual(providerIdx, -1);
  assert.notEqual(modelIdx, -1);
  assert.ok(providerIdx < modelIdx);
});

test("providerBadge formats ready and signed-out states", async () => {
  const { providerBadge } = await subject();

  assert.equal(providerBadge("Grok", "Grok 4.7", true), "Grok 4.7 · ready");
  assert.equal(providerBadge("Claude", "Sonnet 5.5", false), "Claude · not signed in");
});

test("pickerProviders drops fake and keeps grok", async () => {
  const { pickerProviders } = await subject();

  assert.deepEqual(
    pickerProviders([
      { id: "codex", label: "Codex" },
      { id: "fake", label: "Fake" },
      { id: "grok", label: "Grok" },
    ]),
    [
      { id: "codex", label: "Codex" },
      { id: "grok", label: "Grok" },
    ],
  );
});

test("flashcard study job includes provider", async () => {
  const { flashcardJobArgs } = await import("../src/flashcards.ts");

  assert.equal(
    flashcardJobArgs("/knowledge", "Biology", false, "grok-4.7", "grok").provider,
    "grok",
  );
});
