import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WeakTopicsCard } from "~/components/today/today-sections";

const base = { root: "/r", course: "Biology", digest: "Biology/digests/a.md", heading: "Glycolysis", wrong_rate: 0.6, wrong: 3, correct: 2 };
const t = (label: string, over: object = {}) => ({ ...base, label, ...over });
const labels = () => screen.getAllByRole("button", { name: /Drill/ }).map((b) => (b.getAttribute("aria-label") ?? "").replace("Drill ", ""));
const rows = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("Weak topics: concepts sharing one section", () => {
  it("shows exactly the topics it was given after every update", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = t("ATP yield"), b = t("Glycolysis steps"), c = t("NADH"), d = t("Pyruvate");
    const { rerender } = render(<WeakTopicsCard topics={[a, b, c]} meta={{}} onDrill={() => {}} />);
    const log: string[] = [];
    for (const next of [[b, c], [d, b], [c, d, a], [a], [b, a, c, d]]) {
      rerender(<WeakTopicsCard topics={next} meta={{}} onDrill={() => {}} />);
      log.push(`want ${next.map((x) => x.label).join("|")} got ${labels().join("|")} rows=${rows().length}`);
    }
    expect(err.mock.calls.filter((call) => call.join(" ").includes("same key"))).toEqual([]);
    err.mockRestore();
    expect(log.filter((l) => { const m = /want (.*) got (.*) rows/.exec(l)!; return m[1] !== m[2]; })).toEqual([]);
  });
});
