import { beforeEach, describe, expect, it } from "vitest";

import { snapshotFlashcards } from "~/domain/study-session";
import { createReview } from "~/domain/flashcards";
import type { FlashcardDeck } from "~/domain/types";

import { useStudySessionStore } from "~/stores/study-session-store";

const deck: FlashcardDeck = {
  schema_version: 1,
  course: "bio",
  cards: [
    {
      id: "a",
      front: "A",
      back: "a",
      tags: [],
      source: { digest: "d", heading: null, page: null },
    },
  ],
};

describe("useStudySessionStore persist", () => {
  beforeEach(() => {
    localStorage.clear();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
  });

  it("round-trips sessions through persist storage", async () => {
    const key = "root\0bio\0flashcards";
    const value = snapshotFlashcards(createReview(deck), "due", "id");
    useStudySessionStore.getState().save(key, value);
    await useStudySessionStore.persist.rehydrate();
    const raw = localStorage.getItem("arbor.study-sessions");
    expect(raw).toBeTruthy();
    useStudySessionStore.persist.clearStorage();
    useStudySessionStore.setState({ sessions: {} });
    localStorage.setItem("arbor.study-sessions", raw!);
    await useStudySessionStore.persist.rehydrate();
    expect(useStudySessionStore.getState().sessions[key]).toEqual(value);
  });

  it("clear removes a session entry", () => {
    const key = "k";
    useStudySessionStore.getState().save(key, snapshotFlashcards(createReview(deck), "full", "id"));
    useStudySessionStore.getState().clear(key);
    expect(useStudySessionStore.getState().sessions[key]).toBeUndefined();
  });
});
