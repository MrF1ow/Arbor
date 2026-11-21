import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAtRoute } from "~/test/render";

const COURSE = "cell-biology";
const SLUG = "2026-10-13-cell-signalling";
const DIGEST = `${COURSE}/digests/${SLUG}.md`;
const READ = `/course/${COURSE}/read/${SLUG}`;

const digestInfos = [
  {
    title: "Cell signalling",
    date: "2026-10-13",
    path: DIGEST,
    unit: "Membranes",
    source_path: `${COURSE}/Membranes/cell-signalling.pdf`,
  },
];

const entry = (fraction: number) => ({
  fraction,
  last_opened: "2026-10-14T09:00:00Z",
  read: fraction >= 0.9,
});

// Every box is 2000 px tall in a 500 px window, so a stored fraction f resumes at f * 2000 - 500.
const SCROLL_HEIGHT = 2000;
const CLIENT_HEIGHT = 500;

describe("DigestView resume", () => {
  const scrollTo = vi.fn();
  const originalScrollTo = Element.prototype.scrollTo;
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  beforeEach(() => {
    scrollTo.mockReset();
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => SCROLL_HEIGHT,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => CLIENT_HEIGHT,
    });
  });

  afterEach(() => {
    Element.prototype.scrollTo = originalScrollTo;
    for (const [name, descriptor] of [
      ["scrollHeight", heightDescriptor],
      ["clientHeight", clientDescriptor],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, name);
      }
    }
  });

  function fixtures(read: () => unknown) {
    return {
      list_digests: () => digestInfos,
      read_reading_state: read,
    };
  }

  async function waitForArticle() {
    await waitFor(() => expect(screen.getByRole("article").textContent).toContain("Membrane structure"));
  }

  const scrolledDown = () => scrollTo.mock.calls.filter((call) => Number(call[1]) > 0);

  it("scrolls to where an unfinished lecture was left", async () => {
    await renderAppAtRoute(READ, fixtures(() => ({ [DIGEST]: entry(0.4) })));
    await waitForArticle();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0.4 * SCROLL_HEIGHT - CLIENT_HEIGHT));
  });

  it("does not scroll a lecture that was read to the end", async () => {
    await renderAppAtRoute(READ, fixtures(() => ({ [DIGEST]: entry(0.95) })));
    await waitForArticle();
    await waitFor(() => expect(screen.getByTestId("digest-view")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrolledDown()).toEqual([]);
  });

  it("does not scroll a lecture that was never opened", async () => {
    await renderAppAtRoute(READ, fixtures(() => ({})));
    await waitForArticle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrolledDown()).toEqual([]);
  });

  it("does not scroll when the link names a heading", async () => {
    await renderAppAtRoute(
      `${READ}?heading=Membrane%20structure`,
      fixtures(() => ({ [DIGEST]: entry(0.4) })),
    );
    await waitForArticle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrolledDown()).toEqual([]);
  });

  it("opens at the top when the saved spot is still the first screen", async () => {
    await renderAppAtRoute(READ, fixtures(() => ({ [DIGEST]: entry(0.2) })));
    await waitForArticle();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));
    expect(scrolledDown()).toEqual([]);
  });

  it("scrolls once per open, not again when the reading state changes", async () => {
    let fraction = 0.4;
    const { queryClient } = await renderAppAtRoute(
      READ,
      fixtures(() => ({ [DIGEST]: entry(fraction) })),
    );
    await waitForArticle();
    await waitFor(() => expect(scrolledDown()).toHaveLength(1));

    fraction = 0.6;
    await queryClient.invalidateQueries();
    fireEvent.scroll(screen.getByTestId("digest-view"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrolledDown()).toEqual([[0, 0.4 * SCROLL_HEIGHT - CLIENT_HEIGHT]]);
  });

  it("waits for the reading state when it loads after the lecture", async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await renderAppAtRoute(
      READ,
      fixtures(() => gate.then(() => ({ [DIGEST]: entry(0.4) }))),
    );
    await waitForArticle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(scrolledDown()).toEqual([]);

    release(null);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0.4 * SCROLL_HEIGHT - CLIENT_HEIGHT));
  });
});
