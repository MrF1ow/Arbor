import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return await import("../src/theme.ts");
}

test("resolves system appearance from the OS flag", async () => {
  const { resolvedTheme } = await subject();

  assert.equal(resolvedTheme("system", true), "dark");
  assert.equal(resolvedTheme("system", false), "light");
  assert.equal(resolvedTheme("light", true), "light");
  assert.equal(resolvedTheme("dark", false), "dark");
});

test("toggle flips the resolved theme into an explicit appearance", async () => {
  const { toggledAppearance } = await subject();

  assert.equal(toggledAppearance("light"), "dark");
  assert.equal(toggledAppearance("dark"), "light");
});

test("accepts only system, light, or dark appearance values", async () => {
  const { parseAppearance } = await subject();

  assert.equal(parseAppearance("system"), "system");
  assert.equal(parseAppearance("light"), "light");
  assert.equal(parseAppearance("dark"), "dark");
  assert.equal(parseAppearance("sepia"), null);
});
