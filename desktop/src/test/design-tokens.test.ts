import { describe, expect, it } from "vitest";

import { twMerge } from "~/lib/tailwind-merge-config";

// Vitest empties CSS imports (even `?raw`), and `src` has no Node types, so read the files from
// disk through an untyped dynamic import. Tests run from `desktop/`.
const NODE_FS = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: "utf8") => string;
};
const indexCss = readFileSync("src/index.css", "utf8");
const tailwindTheme = readFileSync("node_modules/tailwindcss/theme.css", "utf8");

/**
 * The approved Arbor FigCraft design (Arbor.figcraft, collections "Arbor Color" and
 * "Arbor Scale"), copied from `variable.list`. Hex lives here because `check:styles`
 * skips test files. FigCraft colour channels are 0–1 floats; each hex is round(x*255).
 */
type ColourToken = { figma: string; css: string; light: string; dark: string };

const COLOURS: ColourToken[] = [
  { figma: "surface/background", css: "--background", light: "#f6f1e7", dark: "#1a1714" },
  { figma: "surface/card", css: "--card", light: "#fbf8f1", dark: "#211d19" },
  { figma: "surface/sidebar", css: "--sidebar", light: "#f3ede1", dark: "#171411" },
  { figma: "surface/muted", css: "--muted", light: "#ede6d8", dark: "#25201b" },
  { figma: "surface/selected", css: "--selected", light: "#e8e2cf", dark: "#2b2620" },
  { figma: "surface/accent", css: "--accent", light: "#e8ead8", dark: "#272b1e" },
  { figma: "surface/inverse", css: "--surface-inverse", light: "#2b2420", dark: "#ece3d6" },
  { figma: "text/primary", css: "--foreground", light: "#2b2420", dark: "#ece3d6" },
  { figma: "text/muted", css: "--muted-foreground", light: "#75695e", dark: "#ada08f" },
  { figma: "text/faint", css: "--faint-foreground", light: "#a3978a", dark: "#7d7266" },
  { figma: "text/accent", css: "--accent-foreground", light: "#46562b", dark: "#b9cc8e" },
  { figma: "text/inverse", css: "--text-inverse", light: "#f6f1e7", dark: "#1a1714" },
  { figma: "brand/primary", css: "--primary", light: "#586d37", dark: "#9db46f" },
  { figma: "brand/primary-hover", css: "--primary-hover", light: "#4a5d2d", dark: "#aec383" },
  { figma: "brand/on-primary", css: "--primary-foreground", light: "#ffffff", dark: "#171411" },
  // alpha 0.2588 → 0x42
  { figma: "brand/highlight", css: "--highlight", light: "#586d3742", dark: "#9db46f42" },
  { figma: "border/default", css: "--border", light: "#e2d8c8", dark: "#332d27" },
  { figma: "state/destructive", css: "--destructive", light: "#b03a2e", dark: "#e2806f" },
  // alpha 0.1020 → 0x1a
  { figma: "state/destructive-surface", css: "--destructive-surface", light: "#b03a2e1a", dark: "#e2806f1a" },
  { figma: "state/info", css: "--info", light: "#4a6f86", dark: "#8db1c7" },
  { figma: "course/olive", css: "--course-olive", light: "#586d37", dark: "#9db46f" },
  { figma: "course/bark", css: "--course-bark", light: "#6b5344", dark: "#c4a88a" },
  { figma: "course/clay", css: "--course-clay", light: "#a65d42", dark: "#d4927a" },
  { figma: "course/sky", css: "--course-sky", light: "#4a6f86", dark: "#8db1c7" },
  { figma: "course/plum", css: "--course-plum", light: "#6d4f6a", dark: "#b893b5" },
  { figma: "course/sand", css: "--course-sand", light: "#9a7b4f", dark: "#c9b07a" },
  { figma: "course/slate", css: "--course-slate", light: "#5c6570", dark: "#9aa3ad" },
  { figma: "course/moss", css: "--course-moss", light: "#4a7355", dark: "#7fb892" },
];

/** radius/* (px). `full` is 999 in the design; any pill radius of at least 999px matches. */
const RADII: Record<string, number> = { xs: 4, sm: 5, md: 6, lg: 8, xl: 12 };
const RADIUS_FULL_MIN = 999;

/** size/* (px), mapped to the `--spacing-*` theme tokens. */
const SIZES: Record<string, number> = { header: 52, row: 30, control: 28, sidebar: 236 };

/** space/* (px). They equal Tailwind's default spacing steps (step N = N × 4px), so no tokens. */
const SPACES: Record<number, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 };

/** FigCraft text styles → utilities. size/line-height in px. */
const TEXT_STYLES = [
  { util: "display", size: 30, line: 34, family: "serif" },
  { util: "title", size: 21, line: 26, family: "serif" },
  { util: "reading-title", size: 24, line: 30, family: "serif" },
  { util: "heading", size: 16, line: 22, family: "serif" },
  { util: "reading", size: 17.5, line: 30, family: "serif" },
  { util: "body", size: 14, line: 21, family: "sans" },
  { util: "small", size: 13, line: 19, family: "sans" },
  { util: "caption", size: 12, line: 17, family: "sans" },
  { util: "micro", size: 11, line: 15, family: "sans" },
  { util: "label", size: 11, line: 15, family: "sans" },
  { util: "kbd", size: 10.5, line: 14, family: "mono" },
] as const;

function blockBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in index.css`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated ${selector} block`);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const root = declarations(blockBody(indexCss, ":root"));
const dark = new Map([...root, ...declarations(blockBody(indexCss, ".dark"))]);
const theme = declarations(blockBody(indexCss, "@theme"));
const stockTheme = declarations(blockBody(tailwindTheme, "@theme default"));

function resolve(vars: Map<string, string>, name: string): string {
  let value = vars.get(name);
  if (value === undefined) throw new Error(`${name} is not defined`);
  for (let hops = 0; hops < 5; hops += 1) {
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    if (!ref) return value.toLowerCase();
    const next = vars.get(ref[1]);
    if (next === undefined) throw new Error(`${ref[1]} is not defined`);
    value = next;
  }
  throw new Error(`${name} aliases too deeply`);
}

function px(value: string | undefined): number {
  if (value === undefined) throw new Error("missing length");
  const rem = value.match(/^([\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  const pixels = value.match(/^([\d.]+)px$/);
  if (pixels) return Number(pixels[1]);
  throw new Error(`not a px/rem length: ${value}`);
}

describe("Arbor design tokens (FigCraft Arbor Color)", () => {
  it("covers all 28 colour variables", () => {
    expect(COLOURS).toHaveLength(28);
  });

  it.each(COLOURS)("$figma is $css in Light", ({ css, light }) => {
    expect(resolve(root, css)).toBe(light);
  });

  it.each(COLOURS)("$figma is $css in Dark", ({ css, dark: expected }) => {
    expect(resolve(dark, css)).toBe(expected);
  });

  it("exposes the new colours as Tailwind theme colours", () => {
    const themeInline = blockBody(indexCss, "@theme inline");
    for (const name of ["surface-inverse", "text-inverse", "highlight", "destructive-surface"]) {
      expect(themeInline).toContain(`--color-${name}: var(--${name});`);
    }
    expect(themeInline).not.toContain("--color-selection");
  });

  it("replaces --selection with --highlight", () => {
    expect(root.has("--selection")).toBe(false);
    expect(dark.has("--selection")).toBe(false);
    expect(indexCss).not.toMatch(/var\(--selection\)/);
  });
});

describe("Arbor design tokens (FigCraft Arbor Scale)", () => {
  it.each(Object.entries(RADII))("radius/%s is %ipx", (name, expected) => {
    expect(px(theme.get(`--radius-${name}`))).toBe(expected);
  });

  it("radius/full is a pill of at least 999px", () => {
    expect(px(theme.get("--radius-full"))).toBeGreaterThanOrEqual(RADIUS_FULL_MIN);
  });

  it.each(Object.entries(SIZES))("size/%s is %ipx", (name, expected) => {
    expect(px(theme.get(`--spacing-${name}`))).toBe(expected);
  });

  it("space/1–6 and 8 equal Tailwind's default spacing steps", () => {
    expect(theme.has("--spacing")).toBe(false);
    const step = px(stockTheme.get("--spacing"));
    for (const [n, expected] of Object.entries(SPACES)) {
      expect(Number(n) * step).toBe(expected);
    }
  });
});

describe("Arbor fonts and text styles", () => {
  it("puts Inter, P052 and JetBrains Mono first in the font stacks", () => {
    expect(theme.get("--font-sans")).toMatch(/^"?Inter"?,/);
    expect(theme.get("--font-serif")).toBe('P052, Palatino, "Book Antiqua", "Palatino Linotype", serif');
    expect(theme.get("--font-mono")).toMatch(/^"JetBrains Mono",/);
  });

  it.each(TEXT_STYLES)("text-$util is $size/$line in $family", ({ util, size, line, family }) => {
    const match = indexCss.match(new RegExp(`@utility text-${util} \\{([^}]*)\\}`));
    expect(match, `@utility text-${util}`).not.toBeNull();
    const body = declarations(match![1].replace(/([\w-]+)\s*:/g, "--$1:"));
    expect(px(body.get("--font-size"))).toBe(size);
    expect(px(body.get("--line-height"))).toBe(line);
    expect(body.get("--font-family")).toBe(`var(--font-${family})`);
  });

  it("text-label is semibold with 6% tracking", () => {
    const match = indexCss.match(/@utility text-label \{([^}]*)\}/);
    expect(match![1]).toContain("font-weight: 600;");
    expect(match![1]).toContain("letter-spacing: 0.06em;");
  });

  it("tailwind-merge lets a text style replace a size, and keeps a colour", () => {
    for (const { util } of TEXT_STYLES) {
      expect(twMerge(`text-sm text-${util}`)).toBe(`text-${util}`);
      expect(twMerge(`text-${util} text-muted-foreground`)).toBe(`text-${util} text-muted-foreground`);
    }
  });
});
