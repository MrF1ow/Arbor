import { beforeEach, describe, expect, it } from "vitest";

import { useJobStore } from "~/stores/job-store";
import { useUiStore } from "~/stores/ui-store";

describe("job-store", () => {
  beforeEach(() => {
    useJobStore.setState({
      activeJobId: null,
      activeUpdateJobId: null,
      status: "idle",
      step: null,
      lines: [],
      unread: 0,
    });
    useUiStore.setState({ logOpen: false });
  });

  it("caps the ring buffer at 5000 lines", () => {
    for (let i = 0; i < 5005; i += 1) {
      useJobStore.getState().append(`line-${i}`);
    }
    expect(useJobStore.getState().lines).toHaveLength(5000);
    expect(useJobStore.getState().lines[0]).toBe("line-5");
  });

  it("increments unread only while the log is closed", () => {
    useJobStore.getState().append("one");
    expect(useJobStore.getState().unread).toBe(1);
    useUiStore.setState({ logOpen: true });
    useJobStore.getState().append("two");
    expect(useJobStore.getState().unread).toBe(1);
    useJobStore.getState().markRead();
    expect(useJobStore.getState().unread).toBe(0);
  });

  it("does not toggle logOpen", () => {
    useJobStore.getState().append("event");
    expect(useUiStore.getState().logOpen).toBe(false);
  });
});
