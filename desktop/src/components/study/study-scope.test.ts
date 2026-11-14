import { describe, expect, it } from "vitest";

import { inScope, scopedSessionKey, scopeItems, scopeNoun } from "~/components/study/study-scope";
import { studySessionKey } from "~/domain/study-session";

const item = (id: string, digest: string) => ({ id, source: { digest } });
const items = [
  item("a", "digests/2026-09-12-membranes.md"),
  item("b", "cell-biology/digests/2026-09-15-mitochondria.md"),
  item("c", "2026-09-12-membranes"),
];

describe("scopeItems", () => {
  it("keeps everything when nothing is ticked", () => {
    expect(scopeItems("cell-biology", items, []).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("matches a source in any path form against the course-prefixed ticked lecture", () => {
    const ticked = ["cell-biology/digests/2026-09-12-membranes.md"];
    expect(scopeItems("cell-biology", items, ticked).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("returns nothing for a lecture none of the items cite", () => {
    expect(scopeItems("cell-biology", items, ["cell-biology/digests/2026-10-12-stem-cells.md"])).toEqual([]);
  });
});

describe("inScope", () => {
  it("is true only for a ticked lecture", () => {
    const ticked = ["cell-biology/digests/2026-09-15-mitochondria.md"];
    expect(inScope("cell-biology", "digests/2026-09-15-mitochondria.md", ticked)).toBe(true);
    expect(inScope("cell-biology", "digests/2026-09-12-membranes.md", ticked)).toBe(false);
  });
});

describe("scopeNoun", () => {
  it("names one lecture and several", () => {
    expect(scopeNoun(1)).toEqual({ these: "this lecture", their: "its digest" });
    expect(scopeNoun(3)).toEqual({ these: "these 3 lectures", their: "their digests" });
  });
});

describe("scopedSessionKey", () => {
  it("is the plain class key for the whole class, and one more per set of ticked lectures", () => {
    const whole = scopedSessionKey("/root", "cell-biology", "quiz", []);
    expect(whole).toBe(studySessionKey("/root", "cell-biology", "quiz"));
    const a = scopedSessionKey("/root", "cell-biology", "quiz", ["x", "y"]);
    expect(a).not.toBe(whole);
    expect(scopedSessionKey("/root", "cell-biology", "quiz", ["y", "x"])).toBe(a);
    expect(scopedSessionKey("/root", "cell-biology", "quiz", ["x"])).not.toBe(a);
  });
});

describe("a class whose folder name ends in 'digests' (C25)", () => {
  const course = "Weekly digests";
  const cards = [item("c1", "digests/2026-09-01.md"), item("c2", "digests/2026-09-08.md")];

  it("matches a card of the ticked lecture, however the store spelled it", () => {
    expect(scopeItems(course, cards, ["Weekly digests/digests/2026-09-01.md"]).map((i) => i.id)).toEqual(["c1"]);
    // the form toCourseDigest(course, info.path) produced before it was fixed
    expect(scopeItems(course, cards, ["Weekly digests/digests/digests/2026-09-01.md"]).map((i) => i.id)).toEqual(["c1"]);
  });

  it("matches a card whose source carries the course prefix", () => {
    const prefixed = [item("c3", "Weekly digests/digests/2026-09-01.md")];
    expect(scopeItems(course, prefixed, ["Weekly digests/digests/2026-09-01.md"]).map((i) => i.id)).toEqual(["c3"]);
  });

  it("tells inScope the same", () => {
    expect(inScope(course, "digests/2026-09-08.md", ["Weekly digests/digests/2026-09-08.md"])).toBe(true);
    expect(inScope(course, "digests/2026-09-08.md", ["Weekly digests/digests/2026-09-01.md"])).toBe(false);
  });
});
