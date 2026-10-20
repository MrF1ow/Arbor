import { describe, expect, it } from "vitest";

import { cn } from "~/lib/utils";

describe("cn / tailwind-merge custom tokens", () => {
  it("merges custom max-width tokens against defaults", () => {
    expect(cn("max-w-sm", "max-w-reading")).toBe("max-w-reading");
  });

  it("merges custom font-size tokens", () => {
    expect(cn("text-sm", "text-2xs")).toBe("text-2xs");
  });

  it("keeps font-size and text color together", () => {
    expect(cn("text-2xs", "text-muted-foreground")).toBe("text-2xs text-muted-foreground");
  });

  it("merges custom z-index tokens", () => {
    expect(cn("z-overlay", "z-dialog")).toBe("z-dialog");
  });

  it("merges custom height tokens", () => {
    expect(cn("h-8", "h-header")).toBe("h-header");
  });
});
