import { describe, expect, it } from "vitest";

import { copyLogLines, formatLogForClipboard } from "~/components/jobs/job-log-panel";
import { clipboardWriteText } from "~/test/setup";

describe("copyLogLines", () => {
  it("writes formatted log text to the clipboard", async () => {
    clipboardWriteText.mockClear();
    await copyLogLines([
      { key: "a", prefix: "10:00:01", text: "hello" },
      { key: "b", prefix: "", text: "live tail" },
    ]);
    expect(clipboardWriteText).toHaveBeenCalledWith("10:00:01 hello\nlive tail");
  });
});

describe("formatLogForClipboard", () => {
  it("joins lines without extra prefix spacing when empty", () => {
    expect(formatLogForClipboard([{ key: "a", prefix: "", text: "only" }])).toBe("only");
  });
});
