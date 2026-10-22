import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LiveAnswer } from "~/components/chat/live-answer";
import { FIXTURE_ROOT_FALL } from "~/test/fixtures/data";
import { renderWithProviders } from "~/test/render";
import {
  appendChatLiveDelta,
  beginChatLiveStream,
  chatLiveKey,
  finishChatLiveStream,
  resetChatLiveStoreForTests,
} from "~/stores/chat-live-store";

const THREAD_ID = "t-20261020T160000Z-000001";

afterEach(() => {
  cleanup();
  resetChatLiveStoreForTests();
});

describe("LiveAnswer", () => {
  it("renders markdown deltas as HTML in the live bubble", async () => {
    const key = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", THREAD_ID);
    beginChatLiveStream(key);
    renderWithProviders(
      <LiveAnswer root={FIXTURE_ROOT_FALL} course="cell-biology" threadId={THREAD_ID} />,
      { minimal: true },
    );
    await act(async () => {
      appendChatLiveDelta(key, "**Bold");
      appendChatLiveDelta(key, " text**");
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(screen.getByTestId("chat-live-answer").querySelector("strong")?.textContent).toBe(
      "Bold text",
    );
  });

  it("shows only the new stream text on the first render after a prior answer", async () => {
    const key = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", THREAD_ID);
    beginChatLiveStream(key);
    renderWithProviders(
      <LiveAnswer root={FIXTURE_ROOT_FALL} course="cell-biology" threadId={THREAD_ID} />,
      { minimal: true },
    );
    act(() => {
      appendChatLiveDelta(key, "First answer");
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    act(() => {
      finishChatLiveStream(key);
    });
    await act(async () => {
      beginChatLiveStream(key);
      appendChatLiveDelta(key, "Second");
    });
    expect(screen.getByTestId("chat-live-answer").textContent).toContain("Second");
    expect(screen.getByTestId("chat-live-answer").textContent).not.toContain("First answer");
  });

  it("clears the live bubble when the stream finishes", async () => {
    const key = chatLiveKey(FIXTURE_ROOT_FALL, "cell-biology", THREAD_ID);
    beginChatLiveStream(key);
    renderWithProviders(
      <LiveAnswer root={FIXTURE_ROOT_FALL} course="cell-biology" threadId={THREAD_ID} />,
      { minimal: true },
    );
    act(() => {
      appendChatLiveDelta(key, "Hello");
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(screen.getByTestId("chat-live-answer")).toBeInTheDocument();
    act(() => {
      finishChatLiveStream(key);
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(screen.queryByTestId("chat-live-answer")).not.toBeInTheDocument();
  });
});
