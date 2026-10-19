import { describe, expect, it } from "vitest";

import { formatWorkerEvent } from "~/domain/worker-events";

describe("formatWorkerEvent", () => {
  it("formats stage events with step metadata", () => {
    const formatted = formatWorkerEvent({
      type: "stage",
      stage: "digest",
      status: "running",
      detail: "page 3",
    });
    expect(formatted.line).toContain("digest: running");
    expect(formatted.step).toBe("digest");
    expect(formatted.status).toBe("running");
  });

  it("marks failures", () => {
    const formatted = formatWorkerEvent({ type: "error", message: "boom" });
    expect(formatted.status).toBe("failed");
  });
});
