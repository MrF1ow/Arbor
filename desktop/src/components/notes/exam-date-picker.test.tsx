import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExamDatePicker } from "~/components/notes/course-overview";
import { parseExamDate, toExamDate } from "~/components/workspace/use-exam-date";
import { VIEWER_WRITE_REASON } from "~/domain/library-role";

function setup(value = "", disabled = false) {
  const onPick = vi.fn();
  const user = userEvent.setup();
  render(<ExamDatePicker value={value} disabled={disabled} onPick={onPick} />);
  return { onPick, user };
}

describe("ExamDatePicker", () => {
  it("reads No exam date when unset, and the formatted date when set", () => {
    const { unmount } = render(<ExamDatePicker value="" disabled={false} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exam date" })).toHaveTextContent("No exam date");
    unmount();
    render(<ExamDatePicker value="2026-11-04" disabled={false} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exam date" })).toHaveTextContent("Nov 4, 2026");
  });

  it("picking a day calls onPick with YYYY-MM-DD and closes the calendar", async () => {
    const { onPick, user } = setup("2026-11-04");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    const grid = await screen.findByRole("grid");
    await user.click(within(grid).getByRole("button", { name: /November 12th, 2026/ }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("2026-11-12");
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
  });

  it("an empty date opens on the current month and a pick still saves a full date", async () => {
    const { onPick, user } = setup("");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    const grid = await screen.findByRole("grid");
    const days = within(grid).getAllByRole("button");
    await user.click(days[10]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Clear sends an empty string and closes; it is disabled when there is no date", async () => {
    const { onPick, user } = setup("2026-11-04");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("");
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
  });

  it("Clear is disabled when no date is set", async () => {
    const { user } = setup("");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    expect(await screen.findByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("Clear stays available for a saved date that is not a real day", async () => {
    const { onPick, user } = setup("2026-02-30");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    const clear = await screen.findByRole("button", { name: "Clear" });
    expect(clear).toBeEnabled();
    await user.click(clear);
    expect(onPick).toHaveBeenCalledWith("");
  });

  it("Escape closes the calendar without saving", async () => {
    const { onPick, user } = setup("2026-11-04");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    await screen.findByRole("grid");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a click outside closes the calendar without saving", async () => {
    const { onPick, user } = setup("2026-11-04");
    await user.click(screen.getByRole("button", { name: "Exam date" }));
    await screen.findByRole("grid");
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("is disabled for viewers, with the viewer reason as its title", async () => {
    const { user } = setup("2026-11-04", true);
    const trigger = screen.getByRole("button", { name: "Exam date" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", VIEWER_WRITE_REASON);
    await user.click(trigger);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

describe("exam date strings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["Pacific/Kiritimati", "2026-11-29"],
    ["Pacific/Pago_Pago", "2026-12-01"],
  ])("a local day near midnight keeps its date, with no UTC shift (%s)", (zone, utcDay) => {
    vi.stubEnv("TZ", zone);
    const lateNight = new Date(2026, 10, 30, 23, 30);
    const earlyMorning = new Date(2026, 10, 30, 0, 30);
    // The zone is in effect: the UTC date of one of them is a different day.
    expect([lateNight, earlyMorning].map((d) => d.toISOString().slice(0, 10))).toContain(utcDay);
    expect(toExamDate(lateNight)).toBe("2026-11-30");
    expect(toExamDate(earlyMorning)).toBe("2026-11-30");
    const parsed = parseExamDate("2026-12-01");
    expect(parsed && [parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 11, 1]);
    expect(parsed && toExamDate(parsed)).toBe("2026-12-01");
  });

  it("parseExamDate rejects an empty or impossible date", () => {
    expect(parseExamDate("")).toBeUndefined();
    expect(parseExamDate("2026-02-30")).toBeUndefined();
  });
});
