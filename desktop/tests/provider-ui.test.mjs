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
  assert.match(html, /type="password"/);
  assert.match(html, /id="provider-key-clear"/);
  assert.match(html, /Clear key/);
});

test("providerBadge formats ready and signed-out states", async () => {
  const { providerBadge } = await subject();

  assert.equal(providerBadge("Grok", "Grok 4.7", true), "Grok 4.7 · ready");
  assert.equal(providerBadge("Claude", "Sonnet 5.5", false), "Claude · not signed in");
  assert.equal(
    providerBadge("OpenAI API", "gpt-4o", false, "key missing"),
    "OpenAI API · key missing",
  );
  assert.equal(
    providerBadge("Ollama", "llama3", false, "Ollama is not running at http://127.0.0.1:11434"),
    "Ollama · not running",
  );
  assert.equal(
    providerBadge(
      "Codex",
      "gpt-5",
      false,
      "Arbor worker unavailable: worker failed to start (exit 255): Python",
    ),
    "Arbor worker unavailable: worker failed to start (exit 255): Python",
  );
});

test("authCheckWorkerFailureReason labels worker startup failures", async () => {
  const { authCheckWorkerFailureReason, isWorkerUnavailableAuthReason } = await subject();

  assert.equal(
    authCheckWorkerFailureReason(new Error("worker failed to start (exit 255): Python")),
    "Arbor worker unavailable: worker failed to start (exit 255): Python",
  );
  assert.equal(authCheckWorkerFailureReason(""), "Arbor worker unavailable");
  assert.equal(
    isWorkerUnavailableAuthReason("Arbor worker unavailable: worker failed to start"),
    true,
  );
  assert.equal(isWorkerUnavailableAuthReason("not logged in"), false);
});

test("signedOutJobMessage formats auth refusal for the inspector log", async () => {
  const { signedOutJobMessage } = await subject();

  assert.equal(
    signedOutJobMessage("Grok", "not logged in"),
    "Grok is not authenticated: not logged in",
  );
  assert.equal(signedOutJobMessage("Grok", ""), "Grok is not authenticated");
  assert.equal(signedOutJobMessage("Grok", "   "), "Grok is not authenticated");
  assert.equal(
    signedOutJobMessage("Codex", "Arbor worker unavailable: worker failed to start"),
    "Arbor worker unavailable: worker failed to start",
  );
});

test("provider change persists library override after loadModels selects a model", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf('providerSel.addEventListener("change"');
  assert.ok(handlerStart >= 0, "provider change handler must exist");
  const handlerEnd = source.indexOf('providerKeySaveBtn.addEventListener("click"', handlerStart);
  const handlerBody = source.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd);
  const loadModelsIdx = handlerBody.indexOf("await loadModels");
  const upsertIdx = handlerBody.indexOf("upsertProviderOverride");
  assert.ok(loadModelsIdx >= 0, "provider change must await loadModels");
  assert.ok(upsertIdx >= 0, "provider change must upsert library override");
  assert.ok(
    loadModelsIdx < upsertIdx,
    "override model_id must come from modelSel after loadModels, not the previous provider",
  );
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
