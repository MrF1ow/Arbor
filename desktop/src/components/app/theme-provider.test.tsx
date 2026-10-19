import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "~/components/app/theme-provider";
import { useUiStore } from "~/stores/ui-store";

type MediaListener = (event: MediaQueryListEvent) => void;

let mediaMatches = false;
let mediaListeners: MediaListener[] = [];

function installMatchMedia() {
  mediaListeners = [];
  mediaMatches = false;
  window.matchMedia = vi.fn((query: string) => {
    if (query !== "(prefers-color-scheme: dark)") {
      throw new Error(`unexpected media query: ${query}`);
    }
    return {
      matches: mediaMatches,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners = mediaListeners.filter((item) => item !== listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as MediaQueryList;
  });
}

function setSystemDark(next: boolean) {
  mediaMatches = next;
  const event = { matches: next } as MediaQueryListEvent;
  for (const listener of [...mediaListeners]) {
    listener(event);
  }
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    installMatchMedia();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    if (typeof localStorage.clear === "function") {
      localStorage.clear();
    }
    useUiStore.setState({ appearance: "system" });
  });

  it("applies dark class when appearance is system and OS prefers dark", () => {
    mediaMatches = true;
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("arbor.theme")).toBe("dark");
  });

  it("keeps light class when appearance is explicitly light", () => {
    mediaMatches = true;
    useUiStore.setState({ appearance: "light" });

    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("arbor.theme")).toBe("light");
  });

  it("updates the class when appearance changes", () => {
    mediaMatches = false;
    const { rerender } = render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    useUiStore.setState({ appearance: "dark" });
    rerender(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("follows system changes while appearance is system", () => {
    mediaMatches = false;
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      setSystemDark(true);
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
