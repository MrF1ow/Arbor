import { describe, expect, it } from "vitest";

import { modShortcut, SHORTCUT_CATALOG } from "~/lib/shortcuts";

describe("shortcut catalog", () => {
  it("labels Mod+1 to Mod+5 with the class tabs the handler opens", () => {
    const general = SHORTCUT_CATALOG.filter((e) => e.group === "General");
    const byKey = Object.fromEntries(general.map((e) => [e.keys, e.description]));
    expect(byKey[modShortcut("1")]).toBe("Open Overview");
    expect(byKey[modShortcut("2")]).toBe("Open Cards");
    expect(byKey[modShortcut("3")]).toBe("Open Quiz");
    expect(byKey[modShortcut("4")]).toBe("Open Map");
    expect(byKey[modShortcut("5")]).toBe("Open Ask");
    expect(general.map((e) => e.description).join("|")).not.toMatch(/Notes mode|Flashcards mode|Graph mode|Chat mode/);
  });
});
