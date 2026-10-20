import { describe, expect, it } from "vitest";

import {
  authCheckWorkerFailureReason,
  isWorkerUnavailableAuthReason,
  pickerProviders,
  providerBadge,
  signedOutJobMessage,
} from "~/domain/provider";

describe("provider helpers", () => {
  it("formats providerBadge for ready and signed-out states", () => {
    expect(providerBadge("Grok", "Grok 4.7", true)).toBe("Grok 4.7 · ready");
    expect(providerBadge("Claude", "Sonnet 5.5", false)).toBe("Claude · not signed in");
    expect(providerBadge("OpenAI API", "gpt-4o", false, "key missing")).toBe(
      "OpenAI API · key missing",
    );
    expect(
      providerBadge("Ollama", "llama3", false, "Ollama is not running at http://127.0.0.1:11434"),
    ).toBe("Ollama · not running");
    expect(
      providerBadge(
        "Codex",
        "gpt-5",
        false,
        "Arbor worker unavailable: worker failed to start (exit 255): Python",
      ),
    ).toBe("Arbor worker unavailable: worker failed to start (exit 255): Python");
  });

  it("labels worker startup failures for auth checks", () => {
    expect(
      authCheckWorkerFailureReason(new Error("worker failed to start (exit 255): Python")),
    ).toBe("Arbor worker unavailable: worker failed to start (exit 255): Python");
    expect(authCheckWorkerFailureReason("")).toBe("Arbor worker unavailable");
    expect(isWorkerUnavailableAuthReason("Arbor worker unavailable: worker failed to start")).toBe(
      true,
    );
    expect(isWorkerUnavailableAuthReason("not logged in")).toBe(false);
  });

  it("formats signedOutJobMessage for the inspector log", () => {
    expect(signedOutJobMessage("Grok", "not logged in")).toBe(
      "Grok is not authenticated: not logged in",
    );
    expect(signedOutJobMessage("Grok", "")).toBe("Grok is not authenticated");
    expect(signedOutJobMessage("Grok", "   ")).toBe("Grok is not authenticated");
    expect(
      signedOutJobMessage("Codex", "Arbor worker unavailable: worker failed to start"),
    ).toBe("Arbor worker unavailable: worker failed to start");
  });

  it("drops fake providers from picker lists", () => {
    expect(
      pickerProviders([
        { id: "codex", label: "Codex" },
        { id: "fake", label: "Fake" },
        { id: "grok", label: "Grok" },
      ]),
    ).toEqual([
      { id: "codex", label: "Codex" },
      { id: "grok", label: "Grok" },
    ]);
  });
});
