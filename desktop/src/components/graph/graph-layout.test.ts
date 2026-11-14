import { describe, expect, it } from "vitest";

import {
  FIT_MIN_SCALE,
  fitScale,
  layoutConcepts,
  NODE_HEIGHT,
  nodeWidth,
  revealScroll,
  rowBudget,
  type GraphLayout,
  type LayoutEdge,
  type LayoutNode,
} from "~/components/graph/graph-layout";

const names = ["Membrane transport", "Passive transport", "Active transport", "Osmosis", "Aquaporins", "Carrier proteins"];
const nodes: LayoutNode[] = names.map((name, i) => ({ id: `c${i}`, label: name }));
const edges = [
  { from: "c0", to: "c1" },
  { from: "c0", to: "c2" },
  { from: "c0", to: "c3" },
  { from: "c3", to: "c4" },
  { from: "c1", to: "c5" },
];

describe("layoutConcepts", () => {
  it("places every concept once, inside the reported size", () => {
    const layout = layoutConcepts(nodes, edges);
    expect(layout.positions.size).toBe(nodes.length);
    for (const node of nodes) {
      const p = layout.positions.get(node.id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(layout.width);
      expect(p.y + NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
    }
  });

  it("never lets two concept pills overlap", () => {
    const many: LayoutNode[] = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Concept number ${i}` }));
    const links = many.slice(1).map((n, i) => ({ from: many[Math.floor(i / 3)]!.id, to: n.id }));
    const { positions } = layoutConcepts(many, links);
    const boxes = [...positions.values()];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapY = a.y < b.y + NODE_HEIGHT && b.y < a.y + NODE_HEIGHT;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("is deterministic, so the map does not jump between renders", () => {
    const a = layoutConcepts(nodes, edges);
    const b = layoutConcepts(nodes, edges);
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()]);
  });

  it("sizes a pill by its label", () => {
    expect(nodeWidth("Osmosis")).toBeLessThan(nodeWidth("Concentration gradient"));
  });

  it("handles a single concept and no links", () => {
    const layout = layoutConcepts([{ id: "only", label: "Only" }], []);
    expect(layout.positions.size).toBe(1);
    expect(Number.isFinite(layout.width)).toBe(true);
  });

  it("ignores links to unknown concepts", () => {
    const layout = layoutConcepts(nodes, [...edges, { from: "c0", to: "ghost" }]);
    expect(layout.positions.size).toBe(nodes.length);
  });
});

function randomGraph(count: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  let seed = count * 7919;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Concept number ${i} of the map` }));
  const edges: LayoutEdge[] = [];
  for (let i = 1; i < count; i++) {
    edges.push({ from: `n${i}`, to: `n${Math.floor(next() * i)}` });
    if (next() < 0.4) {
      edges.push({ from: `n${i}`, to: `n${Math.floor(next() * count)}` });
    }
  }
  return { nodes, edges };
}

/** Whether the segment crosses the interior of the rectangle (shrunk by 1 px so ports on its edge do not count). */
function segmentCrossesBox(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
  box: { x: number; y: number; width: number },
): boolean {
  const left = box.x + 1;
  const right = box.x + box.width - 1;
  const top = box.y + 1;
  const bottom = box.y + NODE_HEIGHT - 1;
  // Liang-Barsky: the part of the segment inside the box's interior, if any.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - left],
    [dx, right - ax],
    [-dy, ay - top],
    [dy, bottom - ay],
  ] as const) {
    if (p === 0) {
      if (q <= 0) {
        return false;
      }
    } else {
      const t = q / p;
      if (p < 0) {
        t0 = Math.max(t0, t);
      } else {
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 < t1;
}

function expectNoEdgeThroughPill(layout: GraphLayout) {
  const through: string[] = [];
  for (const route of layout.routes) {
    for (let k = 0; k + 1 < route.points.length; k++) {
      for (const [id, box] of layout.positions) {
        if (id !== route.from && id !== route.to && segmentCrossesBox(route.points[k]!, route.points[k + 1]!, box)) {
          through.push(`${route.from}-${route.to} through ${id}`);
        }
      }
    }
  }
  expect(through).toEqual([]);
}

describe("layered layout", () => {
  it("lays the concepts out top-down: a hub on top, what it links to below it", () => {
    const layout = layoutConcepts(nodes, edges);
    const y = (id: string) => layout.positions.get(id)!.y;
    expect(y("c0")).toBeLessThan(y("c1"));
    expect(y("c0")).toBeLessThan(y("c2"));
    expect(y("c1")).toBeLessThan(y("c5"));
    expect(y("c3")).toBeLessThan(y("c4"));
    // The hub (most links) is on the first row, centred above its children.
    expect(y("c0")).toBe(Math.min(...nodes.map((n) => y(n.id))));
  });

  it("keeps every link going from one row to another, ending on the pills' top and bottom", () => {
    const layout = layoutConcepts(nodes, edges);
    expect(layout.routes).toHaveLength(edges.length);
    for (const route of layout.routes) {
      const first = route.points[0]!;
      const last = route.points[route.points.length - 1]!;
      const a = layout.positions.get(route.from)!;
      const b = layout.positions.get(route.to)!;
      const upper = a.y < b.y ? a : b;
      const lower = a.y < b.y ? b : a;
      expect(a.y).not.toBe(b.y);
      expect(Math.min(first[1], last[1])).toBe(upper.y + NODE_HEIGHT);
      expect(Math.max(first[1], last[1])).toBe(lower.y);
    }
  });

  it("draws no link through a pill, on a hundred and fifty concepts with cross links", () => {
    const { nodes: many, edges: links } = randomGraph(150);
    const layout = layoutConcepts(many, links);
    expectNoEdgeThroughPill(layout);
  });

  it("draws no link through a pill when links skip rows or join concepts on one row", () => {
    const dense: LayoutNode[] = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, label: `Dense ${i}` }));
    const links: LayoutEdge[] = [];
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        links.push({ from: `d${i}`, to: `d${j}` });
      }
    }
    const layout = layoutConcepts(dense, links);
    expectNoEdgeThroughPill(layout);
  });

  it("puts concepts without links in rows below the connected ones", () => {
    const lone: LayoutNode[] = [...nodes, { id: "x1", label: "Loner one" }, { id: "x2", label: "Loner two" }];
    const layout = layoutConcepts(lone, edges);
    const connectedBottom = Math.max(...nodes.map((n) => layout.positions.get(n.id)!.y));
    expect(layout.positions.get("x1")!.y).toBeGreaterThan(connectedBottom);
    expect(layout.positions.get("x2")!.y).toBeGreaterThan(connectedBottom);
  });
});

const rowCount = (layout: GraphLayout) => new Set([...layout.positions.values()].map((box) => box.y)).size;

describe("rows stay few", () => {
  it("keeps a hub whose leaves link in a ring on a handful of rows, not one row per leaf (F111)", () => {
    const ring: LayoutNode[] = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `Concept ${i}` }));
    const links: LayoutEdge[] = [];
    for (let i = 1; i < 20; i++) {
      links.push({ from: "c0", to: `c${i}` });
    }
    for (let i = 1; i < 20; i++) {
      links.push({ from: `c${i}`, to: `c${(i % 19) + 1}` });
    }
    const layout = layoutConcepts(ring, links, 742);
    expect(rowCount(layout)).toBeLessThanOrEqual(5);
    expect(layout.routes).toHaveLength(links.length);
    expectNoEdgeThroughPill(layout);
    // Links between concepts of one row arc through the gap above it, ending on the pills' top edges.
    const sameRow = layout.routes.filter((route) => layout.positions.get(route.from)!.y === layout.positions.get(route.to)!.y);
    expect(sameRow.length).toBeGreaterThan(0);
    for (const route of sameRow) {
      const row = layout.positions.get(route.from)!.y;
      expect(route.points[0]![1]).toBe(row);
      expect(route.points[route.points.length - 1]![1]).toBe(row);
      expect(Math.min(...route.points.map(([, y]) => y))).toBeLessThan(row);
    }
    const again = layoutConcepts(ring, links, 742);
    expect(again.routes).toEqual(layout.routes);
  });

  it("fits a 21-concept tree on a few rows (F111)", () => {
    const tree: LayoutNode[] = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, label: `Concept name ${i}` }));
    const links: LayoutEdge[] = [];
    for (let c = 1; c <= 5; c++) {
      links.push({ from: "c0", to: `c${c}` });
      for (let g = 0; g < 3; g++) {
        links.push({ from: `c${c}`, to: `c${5 + (c - 1) * 3 + g + 1}` });
      }
    }
    const layout = layoutConcepts(tree, links, 742);
    expect(rowCount(layout)).toBeLessThanOrEqual(6);
    expectNoEdgeThroughPill(layout);
  });

  it("lays 150 concepts out within 100 ms (F111)", () => {
    const { nodes: many, edges: links } = randomGraph(150);
    layoutConcepts(many, links);
    const started = performance.now();
    layoutConcepts(many, links);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("a concept wider than the map", () => {
  it("keeps an unlinked wide concept inside the canvas, growing the canvas instead (F112)", () => {
    const wide = "Figure · Sodium–potassium pump cycle with ATP hydrolysis, conformational change and ion release across the plasma membrane";
    const layout = layoutConcepts(
      [
        { id: "a", label: "Membrane transport" },
        { id: "b", label: "Diffusion" },
        { id: "w", label: wide },
      ],
      [{ from: "a", to: "b" }],
    );
    const box = layout.positions.get("w")!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
    expect(layout.width).toBeGreaterThanOrEqual(nodeWidth(wide));
    const only = layoutConcepts([{ id: "w", label: "x".repeat(110) }], []);
    expect(only.positions.get("w")!.x).toBeGreaterThanOrEqual(0);
    expect(only.width).toBeGreaterThanOrEqual(only.positions.get("w")!.width);
  });
});

describe("revealScroll", () => {
  const viewport = { width: 400, height: 300 };
  const box = { x: 100, y: 200, width: 120 };

  it("leaves the scroll alone when the pill is in view (F114)", () => {
    expect(revealScroll(box, 1, viewport, { left: 0, top: 0 })).toEqual({ left: 0, top: 0 });
  });

  it("scrolls down and right just far enough to show a pill below the fold, with a margin (F114)", () => {
    const to = revealScroll({ x: 600, y: 900, width: 120 }, 1, viewport, { left: 0, top: 0 });
    expect(to).toEqual({ left: 720 + 16 - 400, top: 933 + 16 - 300 });
  });

  it("scrolls back up and left to a pill above and left of the view, at the zoom (F114)", () => {
    const to = revealScroll({ x: 10, y: 10, width: 100 }, 0.5, viewport, { left: 300, top: 500 });
    expect(to).toEqual({ left: 0, top: 0 });
    const half = revealScroll({ x: 400, y: 400, width: 100 }, 0.5, viewport, { left: 900, top: 900 });
    expect(half).toEqual({ left: 200 - 16, top: 200 - 16 });
  });
});

describe("fitScale", () => {
  const layout = { positions: new Map(), routes: [], width: 600, height: 800 } satisfies GraphLayout;

  it("fits the layout inside the viewport without enlarging it", () => {
    expect(fitScale({ width: 1200, height: 1600 }, layout)).toBe(1);
    expect(fitScale({ width: 600, height: 900 }, layout)).toBe(1);
  });

  it("measures the viewport as it is: all of its height is room for the map", () => {
    expect(fitScale({ width: 1000, height: 720 }, layout)).toBeCloseTo(0.9, 5);
  });

  it("never shrinks the pills below a readable size, and lets the canvas scroll instead", () => {
    expect(fitScale({ width: 200, height: 200 }, layout)).toBe(FIT_MIN_SCALE);
    expect(FIT_MIN_SCALE * 13).toBeGreaterThanOrEqual(10.5);
  });
});

const starOf = (count: number) => {
  const kids = ["Passive transport", "Active transport", "Concentration gradient", "Osmosis", "Aquaporins", "Carrier proteins", "Simple diffusion", "Facilitated diffusion", "Na\u207a/K\u207a pump", "Endocytosis", "Exocytosis", "Ion channels"].slice(0, count);
  const starNodes: LayoutNode[] = [{ id: "h", label: "Membrane transport" }, ...kids.map((label, i) => ({ id: `k${i}`, label }))];
  const starEdges: LayoutEdge[] = kids.map((_, i) => ({ from: "h", to: `k${i}` }));
  return { starNodes, starEdges };
};

describe("a hub whose neighbours wrap onto a second row (C24)", () => {
  it.each([
    [6, 872, 60],
    [8, 872, 60],
    [10, 872, 100],
    [11, 872, 100],
  ])("keeps the layout as wide as its widest row, so %i neighbours fit a 742 px canvas without scrolling", (count, maxWidth, offCentre) => {
    const { starNodes, starEdges } = starOf(count);
    const layout = layoutConcepts(starNodes, starEdges, 742);
    const rows = new Map<number, { left: number; right: number }>();
    for (const [id, box] of layout.positions) {
      if (id === "h") continue;
      const row = rows.get(box.y) ?? { left: Infinity, right: -Infinity };
      rows.set(box.y, { left: Math.min(row.left, box.x), right: Math.max(row.right, box.x + box.width) });
    }
    expect(rows.size).toBeGreaterThan(1);
    const widest = Math.max(...[...rows.values()].map((row) => row.right - row.left));
    expect(layout.width).toBeLessThanOrEqual(maxWidth);
    expect(layout.width).toBeLessThanOrEqual(widest + 48 + 100);
    expect(fitScale({ width: 742, height: 700 }, layout)).toBeGreaterThan(FIT_MIN_SCALE);
    // every row is centred under the hub
    const hub = layout.positions.get("h")!;
    for (const row of rows.values()) {
      expect(Math.abs((row.left + row.right) / 2 - (hub.x + hub.width / 2))).toBeLessThanOrEqual(offCentre);
    }
    expectNoEdgeThroughPill(layout);
  });

  it("stays deterministic and overlap free with the rows centred", () => {
    const { starNodes, starEdges } = starOf(8);
    const layout = layoutConcepts(starNodes, starEdges, 742);
    expect(layoutConcepts(starNodes, starEdges, 742).routes).toEqual(layout.routes);
    const boxes = [...layout.positions.values()];
    for (const a of boxes) {
      for (const b of boxes) {
        if (a !== b && a.y === b.y) {
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
        }
      }
    }
  });
});

describe("pill widths follow the text (C27)", () => {
  it("gives a full-width (CJK) label about one em per character, not 7.4 px", () => {
    expect(nodeWidth("ミトコンドリア内膜の電気化学的勾配")).toBeGreaterThanOrEqual(17 * 13 + 20);
    expect(nodeWidth("细胞膜转运机制")).toBeGreaterThanOrEqual(7 * 13 + 20);
  });

  it("gives wide Latin capitals more room than narrow lowercase", () => {
    expect(nodeWidth("WWWWWWWWWWWWWWWW")).toBeGreaterThanOrEqual(16 * 10.5 + 20);
    expect(nodeWidth("WWWWWWWWWWWWWWWW")).toBeGreaterThan(nodeWidth("iiiiiiiiiiiiiiii"));
  });

  it("gives Cyrillic and Greek capitals more than the Latin average", () => {
    expect(nodeWidth("НЖЩШЮФ")).toBeGreaterThanOrEqual(6 * 11.5 + 20);
    expect(nodeWidth("ΩΩΩΩΩΩ")).toBeGreaterThanOrEqual(6 * 10.5 + 20);
  });

  it("keeps a Latin label near its old width", () => {
    expect(nodeWidth("Osmosis")).toBeLessThan(nodeWidth("Concentration gradient"));
    expect(nodeWidth("Membrane transport")).toBeLessThanOrEqual(18 * 7.4 + 26 + 15);
  });
});

const WORDS = ["Membrane", "transport", "Osmosis", "gradient", "protein", "channel", "Mitosis", "Meiosis", "DNA", "replication", "RNA", "splicing", "Krebs", "cycle", "ATP", "synthase", "Glycolysis", "enzyme", "kinetics", "receptor", "signalling", "apoptosis", "cytoskeleton", "vesicle"];
/** A seeded map with a few hubs (preferential attachment, about 1.4 links per concept) and varied labels. */
function linkedGraph(count: number, seedValue: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  let state = (seedValue * 7919 + 13) >>> 0;
  const next = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  next();
  next();
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: Array.from({ length: 1 + Math.floor(next() * 3) }, () => WORDS[Math.floor(next() * WORDS.length)]!).join(" "),
  }));
  const degree = new Array<number>(count).fill(1);
  const edges: LayoutEdge[] = [];
  for (let i = 1; i < count; i++) {
    for (let e = 0; e < (next() < 0.4 ? 2 : 1); e++) {
      let pick = next() * degree.slice(0, i).reduce((a, b) => a + b, 0);
      let j = 0;
      while (pick > degree[j]!) {
        pick -= degree[j]!;
        j++;
      }
      edges.push({ from: `n${j}`, to: `n${i}` });
      degree[j]!++;
      degree[i]!++;
    }
  }
  return { nodes, edges };
}

// The measured Map canvas (the scrolling viewport): 506 px at a 1440×900 window, 474 px at the default 1100×760.
const CANVAS_WIDTHS = [506, 474];
/** Whether the layout, shown at Fit, needs no sideways scroll in a canvas this wide. */
const fitsAcross = (layout: GraphLayout, canvasWidth: number, height = 700) =>
  layout.width * fitScale({ width: canvasWidth, height }, layout) <= canvasWidth + 0.5;
const rowSpans = (layout: GraphLayout, skip = "") => {
  const rows = new Map<number, { left: number; right: number }>();
  for (const [id, box] of layout.positions) {
    if (id === skip) continue;
    const row = rows.get(box.y) ?? { left: Infinity, right: -Infinity };
    rows.set(box.y, { left: Math.min(row.left, box.x), right: Math.max(row.right, box.x + box.width) });
  }
  return rows;
};
const noOverlap = (layout: GraphLayout) => {
  const boxes = [...layout.positions.values()];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + NODE_HEIGHT && b.y < a.y + NODE_HEIGHT).toBe(false);
    }
  }
};

describe("the layout follows the measured canvas width (C29)", () => {
  it.each(CANVAS_WIDTHS.flatMap((width) => [4, 5, 6, 8].map((count) => [width, count] as const)))(
    "shows a %i px canvas a %i-neighbour star whole at Fit, without a sideways scroll",
    (canvasWidth, count) => {
      const { starNodes, starEdges } = starOf(count);
      const layout = layoutConcepts(starNodes, starEdges, canvasWidth);
      expect(fitsAcross(layout, canvasWidth)).toBe(true);
      expect(layout.positions.size).toBe(starNodes.length);
      noOverlap(layout);
      expectNoEdgeThroughPill(layout);
    },
  );

  it.each(CANVAS_WIDTHS.flatMap((width) => [15, 16].map((count) => [width, count] as const)))(
    "shows a %i px canvas a %i-concept map without a sideways scroll",
    (canvasWidth, count) => {
      const { nodes: some, edges: links } = linkedGraph(count, 11);
      const layout = layoutConcepts(some, links, canvasWidth);
      expect(fitsAcross(layout, canvasWidth)).toBe(true);
      noOverlap(layout);
      expectNoEdgeThroughPill(layout);
    },
  );

  it("grows downwards where the canvas is narrow, and lays out wider in a wider one", () => {
    const { nodes: some, edges: links } = linkedGraph(16, 11);
    const narrow = layoutConcepts(some, links, 474);
    const wide = layoutConcepts(some, links, 1200);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(fitsAcross(wide, 1200)).toBe(true);
  });

  it("is deterministic for one width", () => {
    const { nodes: some, edges: links } = linkedGraph(16, 11);
    const a = layoutConcepts(some, links, 506);
    const b = layoutConcepts(some, links, 506);
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()]);
    expect(a.routes).toEqual(b.routes);
  });
});

describe("rows stay within the width budget and centred, also on big hubs (C30)", () => {
  it.each([12, 16, 20])("keeps a %i-neighbour star inside a 506 px canvas, every row centred under the hub", (count) => {
    const { starNodes, starEdges } = starOf(count);
    const layout = layoutConcepts(starNodes, starEdges, 506);
    expect(fitsAcross(layout, 506)).toBe(true);
    const hub = layout.positions.get("h")!;
    for (const row of rowSpans(layout, "h").values()) {
      // every row sits inside the budget (the canvas at the Fit floor, less the padding) and about the hub's axis
      expect(row.right - row.left).toBeLessThanOrEqual(rowBudget(506));
      expect(Math.abs((row.left + row.right) / 2 - (hub.x + hub.width / 2))).toBeLessThanOrEqual(130);
    }
    noOverlap(layout);
    expectNoEdgeThroughPill(layout);
  });

  it("scrolls sideways on none of 200 hub-heavy graphs of 12 to 36 concepts at a 506 px canvas", () => {
    let sideways = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { nodes: some, edges: links } = linkedGraph(12 + (seed % 25), seed);
      const layout = layoutConcepts(some, links, 506);
      if (!fitsAcross(layout, 506)) {
        sideways++;
      }
    }
    expect(sideways).toBe(0);
  });
});

describe("a wrapped plain tree stays inside the width and in depth order (C32)", () => {
  const treeOf = () => {
    const tree: LayoutNode[] = [{ id: "root", label: "Cell membrane" }];
    const links: LayoutEdge[] = [];
    const depth = new Map<string, number>([["root", 0]]);
    for (let c = 0; c < 6; c++) {
      tree.push({ id: `c${c}`, label: `Transport topic ${c}` });
      links.push({ from: "root", to: `c${c}` });
      depth.set(`c${c}`, 1);
      for (let g = 0; g < 5; g++) {
        const id = `g${c}_${g}`;
        tree.push({ id, label: `Detail concept ${c}.${g}` });
        links.push({ from: `c${c}`, to: id });
        depth.set(id, 2);
      }
    }
    return { tree, links, depth };
  };

  it.each(CANVAS_WIDTHS)("wraps 37 concepts within a %i px canvas", (canvasWidth) => {
    const { tree, links } = treeOf();
    const layout = layoutConcepts(tree, links, canvasWidth);
    expect(fitsAcross(layout, canvasWidth)).toBe(true);
    noOverlap(layout);
    expectNoEdgeThroughPill(layout);
  });

  it("puts every concept of a depth on rows above all of the next depth", () => {
    const { tree, links, depth } = treeOf();
    const layout = layoutConcepts(tree, links, 506);
    for (const level of [0, 1]) {
      const here = tree.filter((n) => depth.get(n.id) === level).map((n) => layout.positions.get(n.id)!.y);
      const next = tree.filter((n) => depth.get(n.id) === level + 1).map((n) => layout.positions.get(n.id)!.y);
      expect(Math.max(...here)).toBeLessThan(Math.min(...next));
    }
  });
});

describe("the wrapped layout stays fast (C29)", () => {
  it.each([150])("lays %i concepts out in a 506 px canvas within 100 ms", (count) => {
    const { nodes: many, edges: links } = randomGraph(count);
    layoutConcepts(many, links, 506);
    const started = performance.now();
    layoutConcepts(many, links, 506);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("a hub's long links share one slot per row (P6 council round 3)", () => {
  const labels = [
    "Cell membrane",
    "Mitochondria and the electron transport chain",
    "Photosynthesis",
    "Osmosis",
    "Na⁺/K⁺ pump",
    "Concentration gradient",
    "Facilitated diffusion",
    "Lipid bilayer",
    "Carrier proteins",
    "Aquaporins",
    "Endoplasmic reticulum",
    "Golgi apparatus",
  ];
  const star = (n: number) => {
    const nodes = Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      label: i === 0 ? "Cell biology" : `${labels[i % labels.length]!} ${i}`,
    }));
    const edges = nodes.slice(1).map((x) => ({ from: "n0", to: x.id }));
    return { nodes, edges };
  };

  it.each([24, 30, 48])("shows a hub of %i concepts at Fit without a sideways scroll in both real canvases", (n) => {
    const { nodes, edges } = star(n);
    // 456 and 488: the measured canvases at 1100×760 and 1440×900, less the scrollbar room.
    for (const canvas of [456, 488]) {
      const layout = layoutConcepts(nodes, edges, canvas);
      expect(Math.round(layout.width * 0.85)).toBeLessThanOrEqual(canvas + 16);
    }
  });
});
