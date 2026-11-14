import { describe, expect, it } from "vitest";

import {
  citationLabel,
  citedRanges,
  pageCount,
  sourceSummary,
  stripLeadingH1,
  withCitationChips,
} from "~/components/notes/citation-chips";
import { renderMarkdown } from "~/domain/markdown";

describe("citationLabel", () => {
  it("says slide for decks and page for everything else, plural for ranges", () => {
    expect(citationLabel("6", "Bio/lecture-07.pptx")).toBe("slide 6");
    expect(citationLabel("12-18", "Bio/lecture-07.pptx")).toBe("slides 12–18");
    expect(citationLabel("12-18", "Bio/lecture-07.pdf")).toBe("pages 12–18");
    expect(citationLabel("3", null)).toBe("page 3");
  });
});

describe("withCitationChips", () => {
  const source = [
    "<!-- arbor-pages:6 -->",
    "First block.",
    "",
    "Second block, same slide.",
    "<!-- /arbor-pages:6 -->",
    "",
    "<!-- arbor-pages:8 -->",
    "Third block.",
    "<!-- /arbor-pages:8 -->",
    "",
    "A block with no page marker.",
  ].join("\n");

  it("adds one chip after each run of blocks from the same pages", () => {
    const html = withCitationChips(renderMarkdown(source).html, "Bio/lecture-07.pptx");
    const chips = [...html.matchAll(/data-arbor-cite[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(chips).toEqual(["slide 6", "slide 8"]);
    expect(html.indexOf("Second block")).toBeLessThan(html.indexOf("slide 6"));
    expect(html.indexOf("slide 6")).toBeLessThan(html.indexOf("Third block"));
    expect(html.indexOf("slide 8")).toBeLessThan(html.indexOf("A block with no page marker"));
  });

  it("leaves a digest without page markers untouched", () => {
    const html = renderMarkdown("Just text.\n\nMore text.").html;
    expect(withCitationChips(html, null)).toBe(html);
  });
});

describe("stripLeadingH1", () => {
  it("drops the first h1 whatever its text, escapes and markup", () => {
    expect(stripLeadingH1('<h1 id="a">Glycolysis &amp;amp; yield</h1>\n<p>x</p>')).toBe("<p>x</p>");
    expect(stripLeadingH1('<h1 id="a">The <em>lac</em> operon</h1><h2>y</h2>')).toBe("<h2>y</h2>");
  });

  it("keeps a document that does not start with an h1, and later h1s", () => {
    expect(stripLeadingH1("<p>x</p><h1>y</h1>")).toBe("<p>x</p><h1>y</h1>");
  });
});

describe("sourceSummary", () => {
  it("counts the pages or slides the ranges cover", () => {
    expect(pageCount("12-18, 22-24")).toBe(10);
    expect(pageCount("5")).toBe(1);
    expect(pageCount("a-b")).toBeNull();
    expect(sourceSummary("lecture-07.pdf", "12-18, 22-24", "x/lecture-07.pdf")).toBe("lecture-07.pdf · cites 10 pages");
    expect(sourceSummary("deck.pptx", "6", "x/deck.pptx")).toBe("deck.pptx · cites 1 slide");
  });

  it("shows only the file name when the digest has no page markers, and nothing without a source", () => {
    expect(sourceSummary("a.pdf", null, "a.pdf")).toBe("a.pdf");
    expect(sourceSummary(null, "1-2", null)).toBeNull();
  });

  it("C20: the digest's summary counts the pages of every marker block, not just the first", () => {
    const md = [
      "<!-- arbor-pages:3-4 -->",
      "## One",
      "Text",
      "<!-- /arbor-pages:3-4 -->",
      "<!-- arbor-pages:7-9 -->",
      "## Two",
      "Text",
      "<!-- /arbor-pages:7-9 -->",
    ].join("\n");
    const ranges = citedRanges(renderMarkdown(md).html);
    expect(ranges).toBe("3-4, 7-9");
    expect(sourceSummary("x.pdf", ranges, "Bio/x.pdf")).toBe("x.pdf · cites 5 pages");
  });

  it("counts a page cited by two blocks once", () => {
    expect(pageCount("3-5, 5-6")).toBe(4);
  });
});
