import { describe, expect, it } from "vitest";

import {
  buildAssistantLine,
  buildUserLine,
  parseSlashCommand,
  titleFromUserMessage,
  workerHistory,
} from "~/domain/chat";

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

describe("parseSlashCommand", () => {
  it("parses /explain and /ask commands", () => {
    expect(parseSlashCommand("/explain why")).toEqual({ mode: "explain", text: "why" });
    expect(parseSlashCommand("/EXPLAIN why")).toEqual({ mode: "explain", text: "why" });
    expect(parseSlashCommand("/ask")).toEqual({ mode: "ask", text: "" });
  });

  it("ignores invalid or spaced prefixes", () => {
    expect(parseSlashCommand("/askwhy")).toEqual({ text: "/askwhy" });
    expect(parseSlashCommand("  /explain x")).toEqual({ text: "  /explain x" });
    expect(parseSlashCommand("/unknown x")).toEqual({ text: "/unknown x" });
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
