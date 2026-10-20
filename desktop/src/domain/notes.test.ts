import { describe, expect, it } from "vitest";

import {
  collapseSelectionText,
  courseMarkdownForOverview,
  daysUntil,
  digestFlags,
  digestNotesPath,
  digestSlugFromPath,
  examDateFromPlan,
  examFocusCallout,
  firstParagraph,
  headingForSelectionNode,
  pageForSelectionNode,
  quizAccuracy,
  resolveDigestSlug,
  stripLeadingH1,
  studyPlanMarkdownForOverview,
} from "~/domain/notes";
import type { CourseOverviewPayload, DigestInfo } from "~/domain/types";

const digests: DigestInfo[] = [
  {
    title: "Membranes",
    date: "2026-09-12",
    path: "cell-biology/digests/2026-09-12-membranes.md",
  },
  {
    title: "Mitochondria",
    date: "2026-09-15",
    path: "cell-biology/digests/2026-09-15-mitochondria.md",
  },
];

describe("digest paths", () => {
  it("derives slug and notes path", () => {
    expect(digestSlugFromPath("cell-biology/digests/2026-09-12-membranes.md")).toBe(
      "2026-09-12-membranes",
    );
    expect(digestSlugFromPath("digests/foo bar.md")).toBe("foo bar");
    expect(digestSlugFromPath("digests/foo.bar.md")).toBe("foo.bar");
    expect(digestSlugFromPath("cell-biology/digests/report.MD")).toBe("report");
    expect(digestNotesPath("cell-biology", "2026-09-12-membranes")).toBe(
      "cell-biology/digests/2026-09-12-membranes.md",
    );
    expect(
      digestNotesPath("cell-biology", "report", [
        {
          title: "Report",
          date: "2026-01-01",
          path: "cell-biology/digests/report.MD",
        },
      ]),
    ).toBe("cell-biology/digests/report.MD");
  });

  it("resolves worker digest refs to route slugs", () => {
    expect(
      resolveDigestSlug("digests/2026-09-12-membranes.md", digests),
    ).toBe("2026-09-12-membranes");
    expect(resolveDigestSlug("2026-09-15-mitochondria", digests)).toBe("2026-09-15-mitochondria");
  });
});

describe("overview markdown helpers", () => {
  it("strips study plan h1 and worker exam date line", () => {
    const source = `# Study plan

Exam date: **2026-11-04**

- Review cytoskeleton
`;
    expect(studyPlanMarkdownForOverview(source)).toBe("- Review cytoskeleton");
    expect(stripLeadingH1("# Title\n\nBody")).toBe("Body");
  });

  it("strips course h1 and lede paragraph for overview body", () => {
    const source = `# Cell Biology

First paragraph line.

## Syllabus topics

More content.
`;
    const lede = firstParagraph(source);
    expect(lede).toBe("First paragraph line.");
    expect(courseMarkdownForOverview(source, lede).trimEnd()).toBe(
      "## Syllabus topics\n\nMore content.",
    );
    expect(courseMarkdownForOverview(source, null)).toBe(source);
  });
});

describe("firstParagraph", () => {
  it("returns the first paragraph and skips headings", () => {
    const md = "# Title\n\nFirst paragraph line.\n\nSecond paragraph.";
    expect(firstParagraph(md)).toBe("First paragraph line.");
  });

  it("returns null when empty", () => {
    expect(firstParagraph("# Only heading\n")).toBeNull();
  });
});

describe("quizAccuracy", () => {
  it("computes rounded accuracy", () => {
    expect(
      quizAccuracy({
        a: { seen: 1, correct: 3, wrong: 1 },
        b: { seen: 1, correct: 0, wrong: 1 },
      }),
    ).toEqual({ percent: 60, answerCount: 5 });
  });

  it("returns null for empty input", () => {
    expect(quizAccuracy({})).toBeNull();
    expect(quizAccuracy(null)).toBeNull();
  });
});

describe("examDateFromPlan and daysUntil", () => {
  it("parses exam date from plan markdown", () => {
    expect(examDateFromPlan("Exam date: 2026-11-04\n")).toBe("2026-11-04");
    expect(examDateFromPlan("Exam date: **2026-11-04**")).toBe("2026-11-04");
  });

  it("counts days until exam", () => {
    expect(daysUntil("2026-11-04", new Date(2026, 9, 18))).toBe(17);
    expect(daysUntil("2026-10-18", new Date(2026, 9, 18))).toBe(0);
    expect(daysUntil("2026-10-17", new Date(2026, 9, 18))).toBe(-1);
  });
});

describe("digestFlags", () => {
  const overview: CourseOverviewPayload = {
    due: { due_ids: [], count: 0, deck_count: 0 },
    weak: {
      topics: [{ label: "Cytoskeleton", digest: "digests/2026-09-12-membranes.md" }],
    },
    recommend: {
      items: [
        { kind: "unreviewed_digest", label: "New", digest: "digests/2026-09-15-mitochondria.md" },
      ],
    },
  };

  it("marks weak and new digests", () => {
    const flags = digestFlags(overview, digests);
    expect(flags.get(digests[0].path)).toBe("weak");
    expect(flags.get(digests[1].path)).toBe("new");
  });
});

describe("examFocusCallout", () => {
  it("builds combined copy", () => {
    expect(
      examFocusCallout({ weakLabel: "Cytoskeleton", unreviewedTitle: "Membrane transport" }),
    ).toBe(
      "Exam focus: Cytoskeleton is your weakest topic and Membrane transport hasn't been reviewed yet.",
    );
  });

  it("returns null when nothing to show", () => {
    expect(examFocusCallout({ weakLabel: null, unreviewedTitle: null })).toBeNull();
  });
});

describe("selection helpers", () => {
  it("collapses selection text", () => {
    expect(collapseSelectionText("  hello   world  ", 2000)).toBe("hello world");
    expect(collapseSelectionText("x".repeat(5), 3)).toBe("xxx");
  });

  it("finds heading and page for selection", () => {
    const article = document.createElement("article");
    article.innerHTML =
      '<h2 id="h">Membrane structure</h2><p data-arbor-page="12-18">Selected <strong>text</strong></p>';
    const strong = article.querySelector("strong")!;
    expect(headingForSelectionNode(strong, article)).toBe("Membrane structure");
    expect(pageForSelectionNode(strong, article)).toBe("12-18");
  });
});
