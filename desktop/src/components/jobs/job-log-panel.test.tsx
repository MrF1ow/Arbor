import { describe, expect, it, vi } from "vitest";

import {
  buildLogLines,
  copyLogLines,
  formatLogForClipboard,
  liveTailFromStore,
} from "~/components/jobs/job-log-panel";
import { clipboardWriteText } from "~/test/setup";

describe("liveTailFromStore", () => {
  it("does not repeat lines already covered by the cursor", () => {
    const store = ["older", "in-db", "in-db"];
    expect(liveTailFromStore(store, 2)).toEqual(["in-db"]);
    expect(liveTailFromStore(store, 3)).toEqual([]);
  });

  it("never includes lines from before the job cursor", () => {
    const store = ["job-a-line", "job-b-line"];
    expect(liveTailFromStore(store, 1)).toEqual(["job-b-line"]);
  });
});

describe("buildLogLines", () => {
  it("shows DB events once when live tail is empty", () => {
    const events = [{ line: "stored", created_at: "2026-10-20T10:00:00Z" }];
    const lines = buildLogLines(events, [], "job-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("stored");
  });

  it("appends live tail after DB rows without duplicating shared text", () => {
    const events = [{ line: "stored", created_at: "2026-10-20T10:00:00Z" }];
    const lines = buildLogLines(events, ["fresh"], "job-1");
    expect(lines.map((row) => row.text)).toEqual(["stored", "fresh"]);
  });
});

describe("copyLogLines", () => {
  it("writes formatted log text to the clipboard", async () => {
    clipboardWriteText.mockClear();
    clipboardWriteText.mockResolvedValue(undefined);
    await copyLogLines([
      { key: "a", prefix: "10:00:01", text: "hello" },
      { key: "b", prefix: "", text: "live tail" },
    ]);
    expect(clipboardWriteText).toHaveBeenCalledWith("10:00:01 hello\nlive tail");
  });

  it("shows an error toast when clipboard write fails", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "1");
    clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    await copyLogLines([{ key: "a", prefix: "", text: "line" }]);
    expect(errorSpy).toHaveBeenCalledWith("Couldn't copy log");
    errorSpy.mockRestore();
  });
});

describe("formatLogForClipboard", () => {
  it("joins lines without extra prefix spacing when empty", () => {
    expect(formatLogForClipboard([{ key: "a", prefix: "", text: "only" }])).toBe("only");
  });
});
