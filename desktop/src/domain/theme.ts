import type { Appearance } from "./types";

export type Theme = "light" | "dark";

export function resolvedTheme(appearance: Appearance, systemDark: boolean): Theme {
  if (appearance === "light") return "light";
  if (appearance === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function toggledAppearance(current: Theme): Exclude<Appearance, "system"> {
  return current === "dark" ? "light" : "dark";
}

export function parseAppearance(value: string): Appearance | null {
  if (value === "system" || value === "light" || value === "dark") return value;
  return null;
}
