import type { Theme } from "~/domain/theme";

export function applyDocumentTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem("arbor.theme", theme);
  } catch {
    /* storage may be unavailable in tests */
  }
}

export function readBootTheme(): Theme {
  try {
    const stored = localStorage.getItem("arbor.theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
