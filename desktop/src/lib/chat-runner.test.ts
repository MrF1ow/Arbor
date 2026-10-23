import { describe, expect, it } from "vitest";

import { chatAuthErrorMessage } from "~/domain/chat";

describe("chatAuthErrorMessage", () => {
  it("maps plain timeout errors for the runner status line", () => {
    expect(chatAuthErrorMessage("Grok", new Error("timeout"))).toContain("timeout");
  });
});
