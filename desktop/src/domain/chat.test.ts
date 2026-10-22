import { describe, expect, it } from "vitest";

import { titleFromUserMessage, workerHistory } from "~/domain/chat";
import { buildAssistantLine, buildUserLine } from "~/domain/chat";

describe("titleFromUserMessage", () => {
  it("collapses whitespace and truncates on word boundary", () => {
    expect(titleFromUserMessage("  hello   world  ")).toBe("hello world");
    const long = `${"word ".repeat(20).trim()} extra`;
    const title = titleFromUserMessage(long);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("workerHistory", () => {
  it("includes user and assistant lines in order", () => {
    const lines = [
      buildUserLine("ask", "Q"),
      buildAssistantLine("ask", "A", true, []),
    ];
    expect(workerHistory(lines)).toEqual([
      { role: "user", content: "Q" },
      { role: "assistant", content: "A" },
    ]);
  });
});
