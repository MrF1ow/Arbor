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

  it("counts Unicode code points for emoji titles", () => {
    const emoji = "😀".repeat(40);
    expect(titleFromUserMessage(emoji)).toBe(emoji);
    const over = "😀".repeat(61);
    const title = titleFromUserMessage(over);
    expect(Array.from(title.replace("…", "")).length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("counts CJK characters without splitting surrogate pairs", () => {
    const cjk = "字".repeat(61);
    const title = titleFromUserMessage(cjk);
    expect(Array.from(title.replace("…", "")).length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("matches Rust retitle on empty user content", () => {
    expect(titleFromUserMessage("")).toBe("");
    expect(titleFromUserMessage("   ")).toBe("");
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
