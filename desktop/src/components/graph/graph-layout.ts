/**
 * Concept map layout: a layered, top-down tree. A concept with the most links sits on the first row
 * of its group, what it links to goes on the rows below, and a link that skips a row bends through a
 * reserved gap, so no link crosses a pill. A link between two concepts on one row arcs through the
 * gap above that row instead of adding a row. Separate groups stack one under the other. Pure and
 * deterministic: ties break on input order, so the map does not jump on re-render. Sizes are in layout units (1 unit = 1 px at 100% zoom).
 */
export const NODE_HEIGHT = 33;
/** The smallest zoom Fit goes to: 13 px pill text stays above ~11 px, and the canvas scrolls instead. */
export const FIT_MIN_SCALE = 0.85;
const PAD = 24;
const GAP = 18;
const ROW_GAP = 56;
/** Arcs between concepts of one row run in lanes of the gap above it: the first lane, then each step up. */
const LANE_FIRST = 10;
const LANE_STEP = 6;
const LANES_IN_GAP = Math.floor((ROW_GAP - 2 * LANE_FIRST) / LANE_STEP) + 1;
/** Spacing of the points where arcs leave one pill's top edge. */
const PORT_STEP = 7;
const ROW_PITCH = NODE_HEIGHT + ROW_GAP;
/**
 * A link that skips a row passes through a thin slot in it, between two pills: the slot is a line,
 * so it asks only for itself and a little clearance on each side, not for a pill's room.
 */
const DUMMY_WIDTH = 6;
const DUMMY_CLEARANCE = 9;
/** What a slot adds to the used width of a row while rows are assigned. */
const DUMMY_ROOM = DUMMY_WIDTH + 6;
const CHAR_WIDTH = 7.4;
/** Full-width characters (CJK, kana, Hangul, full-width forms) are about one em of the 13 px pill font. */
const WIDE_CHAR_WIDTH = 13.5;
/** Emoji and other symbols outside the basic plane draw wider than an em. */
const SYMBOL_CHAR_WIDTH = 16;
/** Characters that run wider than the 7.4 px average at the 13 px pill font. */
const WIDE_LATIN: Record<string, number> = {
  W: 14,
  M: 12.5,
  "@": 12,
  "%": 11,
  "\u00c6": 12,
  "\u0152": 12,
  m: 11,
  w: 11,
  O: 10.5,
  Q: 10.5,
  G: 10,
  D: 10,
  H: 10,
  N: 10,
  U: 10,
  C: 9.5,
  B: 9.5,
  R: 9.5,
  X: 9.5,
  A: 9.5,
  V: 9.5,
  Y: 9.5,
  K: 9.5,
};
/** Greek capitals (U+0391 to U+03A9) are as wide as the widest Latin ones, Cyrillic capitals (U+0410 to U+042F) wider. */
const GREEK_CAPITAL_WIDTH = 11;
const CYRILLIC_CAPITAL_WIDTH = 12;
const NODE_PADDING = 26;
const SWEEPS = 6;
/** A map with this many items (concepts and slots) gets fewer ordering and placement passes: it is tall, and the time stays bounded. */
const BIG_ITEM_COUNT = 1200;
const ROW_FIT_ATTEMPTS = 40;
const ROW_SLACK = 8;
/** How strongly the axis of a group pulls its rows towards the middle, in neighbours' worth. */
const AXIS_PULL = 0.6;
const PLACEMENT_PASSES = 8;
/**
 * The canvas width the layout assumes until the real one is measured: the Map canvas is about 506 px
 * wide in a 1440 px window and 474 px in the default 1100 px one (less the scrollbar).
 */
export const DEFAULT_CANVAS_WIDTH = 490;
/** No row budget goes below this, however narrow the canvas: a pill and its neighbour still sit side by side. */
const MIN_ROW_WIDTH = 240;

/**
 * How wide a row of pills may be so the whole map shows at the Fit floor without a sideways scroll in
 * a canvas this wide (`canvasWidth` is the width of the scrolling viewport, in screen px).
 */
export function rowBudget(canvasWidth: number): number {
  return Math.max(MIN_ROW_WIDTH, Math.floor(canvasWidth / FIT_MIN_SCALE) - PAD * 2);
}

export type LayoutNode = { id: string; label: string };
export type LayoutEdge = { from: string; to: string };
export type NodeBox = { x: number; y: number; width: number };
/** A link as a polyline: from one pill's bottom edge to the other's top edge, bending through gaps. */
export type LayoutRoute = { from: string; to: string; points: [number, number][] };
export type GraphLayout = {
  positions: Map<string, NodeBox>;
  routes: LayoutRoute[];
  width: number;
  height: number;
};

/** Whether a code point draws one em wide: CJK, kana, Hangul, and the full-width and half-width forms. */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** A label's text width at the pill font, estimated per character (no font needed, so the layout stays deterministic). */
export function textWidth(label: string): number {
  let width = 0;
  for (const char of label) {
    const code = char.codePointAt(0)!;
    width += isWideChar(code) ? WIDE_CHAR_WIDTH : code > 0xffff || (code >= 0x2600 && code <= 0x27bf) ? SYMBOL_CHAR_WIDTH : (WIDE_LATIN[char] ?? (code >= 0x391 && code <= 0x3a9 ? GREEK_CAPITAL_WIDTH : code >= 0x410 && code <= 0x42f ? CYRILLIC_CAPITAL_WIDTH : CHAR_WIDTH));
  }
  return width;
}

/** Width of a concept pill: its label's estimated text width plus the pill's padding. */
export function nodeWidth(label: string): number {
  return Math.round(textWidth(label) + NODE_PADDING);
}

/**
 * The zoom that fits the whole layout in the viewport (never above 100%). It stops at
 * FIT_MIN_SCALE: below that the pill text is too small to read, so the canvas scrolls instead.
 */
export function fitScale(viewport: { width: number; height: number }, layout: GraphLayout): number {
  const fit = Math.min(viewport.width / layout.width, viewport.height / layout.height, 1);
  return Math.max(FIT_MIN_SCALE, fit);
}

/** Room kept around a pill when the canvas scrolls to show it. */
const REVEAL_MARGIN = 16;

/**
 * Where a scrolling canvas must scroll to show one pill, moving as little as possible (the
 * `nearest` rule): the current scroll when the pill is in view, else just far enough to bring its
 * edge in, with a margin. `scale` is the zoom; the box is in layout units.
 */
export function revealScroll(
  box: { x: number; y: number; width: number },
  scale: number,
  viewport: { width: number; height: number },
  scroll: { left: number; top: number },
): { left: number; top: number } {
  const nearest = (start: number, end: number, current: number, size: number) => {
    if (start - REVEAL_MARGIN < current) {
      return Math.max(0, start - REVEAL_MARGIN);
    }
    if (end + REVEAL_MARGIN > current + size) {
      return Math.max(0, end + REVEAL_MARGIN - size);
    }
    return current;
  };
  return {
    left: nearest(box.x * scale, (box.x + box.width) * scale, scroll.left, viewport.width),
    top: nearest(box.y * scale, (box.y + NODE_HEIGHT) * scale, scroll.top, viewport.height),
  };
}

/** Least-squares placement of one row: as close as possible to `wanted`, in order, `spacing` apart. */
function placeRow(wanted: number[], spacing: number[]): number[] {
  const count = wanted.length;
  const offset = new Array<number>(count).fill(0);
  for (let i = 1; i < count; i++) {
    offset[i] = offset[i - 1]! + spacing[i - 1]!;
  }
  // Pool adjacent violators on (wanted - offset), which must come out non-decreasing.
  const sums: number[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    sums.push(wanted[i]! - offset[i]!);
    sizes.push(1);
    while (sums.length > 1 && sums[sums.length - 2]! / sizes[sizes.length - 2]! > sums[sums.length - 1]! / sizes[sizes.length - 1]!) {
      const sum = sums.pop()!;
      const size = sizes.pop()!;
      sums[sums.length - 1]! += sum;
      sizes[sizes.length - 1]! += size;
    }
  }
  const out: number[] = [];
  for (let block = 0; block < sums.length; block++) {
    const value = sums[block]! / sizes[block]!;
    for (let k = 0; k < sizes[block]!; k++) {
      out.push(value + offset[out.length]!);
    }
  }
  return out;
}

type Link = { a: number; b: number; from: string; to: string };
type Block = {
  /** Pill boxes by member index, relative to the block's top-left corner. */
  boxes: Map<number, NodeBox>;
  routes: LayoutRoute[];
  width: number;
  height: number;
};

/** One connected group of concepts as layered rows (members in breadth-first order, root first). */
function layoutGroup(
  members: number[],
  links: Link[],
  widthOf: (member: number) => number,
  maxRowWidth: number,
): Block {
  const m = members.length;
  const local = new Map(members.map((member, i) => [member, i]));
  const widths = members.map(widthOf);
  const neighbours: number[][] = members.map(() => []);
  const pairs = links.map((link) => ({ a: local.get(link.a)!, b: local.get(link.b)!, link }));
  for (const { a, b } of pairs) {
    neighbours[a]!.push(b);
    neighbours[b]!.push(a);
  }
  for (const list of neighbours) {
    list.sort((x, y) => x - y);
  }

  // Depth from the root (local 0), breadth-first.
  const depth = new Array<number>(m).fill(-1);
  depth[0] = 0;
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    for (const next of neighbours[at]!) {
      if (depth[next]! < 0) {
        depth[next] = depth[at]! + 1;
        queue.push(next);
      }
    }
  }

  // Rows: the longest chain of links from a shallower concept above each concept. A link between
  // two concepts of one depth does not add a row: it stays on the row (or crosses rows when a full
  // row pushed one down) and is drawn as an arc. A row that is full pushes the next concept down a
  // row, so a big group grows downwards instead of sideways.
  // The slots of a link that skips rows take room in those rows too, but a row is filled before the
  // later concepts that skip it are placed, so a row can end up wider than a full row. The rows
  // are assigned again with a smaller budget for each row that came out too wide, until every row
  // fits: the map never grows wider than the canvas, it grows taller.
  // The estimate of a row's used width can be a few px short of its packed width: keep some in hand.
  const rowLimit = maxRowWidth - ROW_SLACK;
  const budget = new Array<number>(m + 1).fill(rowLimit);
  const depthOrder = [...queue].sort((x, y) => depth[x]! - depth[y]! || x - y);
  let row = new Array<number>(m).fill(0);
  let rowCap = Infinity;
  let narrowest = Infinity;
  for (let attempt = 0; attempt < ROW_FIT_ATTEMPTS; attempt++) {
    const tried = new Array<number>(m).fill(0);
    const rowUsed: number[] = [];
    const placed = new Array<boolean>(m).fill(false);
    // A concept's links that skip a row share one slot there (a trunk), so a hub's many long links
    // take the room of one line in each row they pass, not one line each.
    const trunk = new Set<number>();
    // The last row each depth reaches: a depth never starts above where the one before it ended, so
    // rows follow depth also when a depth wraps onto several rows.
    const lastRowOfDepth: number[] = [];
    for (const v of depthOrder) {
      let r = depth[v]! > 0 ? (lastRowOfDepth[depth[v]! - 1] ?? 0) + 1 : 0;
      for (const u of neighbours[v]!) {
        if (depth[u]! < depth[v]!) {
          r = Math.max(r, tried[u]! + 1);
        }
      }
      while ((rowUsed[r] ?? 0) > 0 && (rowUsed[r] ?? 0) + widths[v]! > budget[Math.min(r, m)]!) {
        r++;
      }
      tried[v] = r;
      lastRowOfDepth[depth[v]!] = Math.max(lastRowOfDepth[depth[v]!] ?? 0, r);
      rowUsed[r] = (rowUsed[r] ?? 0) + widths[v]! + GAP;
      // A link to a shallower concept, or to one of its own depth placed before it, passes through
      // the rows between the two.
      for (const u of neighbours[v]!) {
        if (depth[u]! < depth[v]! || (depth[u]! === depth[v]! && placed[u])) {
          const top = tried[u]! <= r ? u : v;
          for (let skipped = Math.min(tried[u]!, r) + 1; skipped < Math.max(tried[u]!, r); skipped++) {
            const key = top * (m + 1) + skipped;
            if (!trunk.has(key)) {
              trunk.add(key);
              rowUsed[skipped] = (rowUsed[skipped] ?? 0) + DUMMY_ROOM;
            }
          }
        }
      }
      placed[v] = true;
    }
    const rowsTried = Math.max(...tried) + 1;
    if (attempt === 0) {
      rowCap = Math.ceil(rowsTried * 1.5) + 4;
    } else if (rowsTried > rowCap) {
      // A map whose long links fill every row cannot be made narrow: keep the narrowest attempt so far.
      break;
    }
    let worst = 0;
    rowUsed.forEach((used, r) => {
      const over = used - GAP - rowLimit;
      if (over > 0) {
        worst = Math.max(worst, over);
        // A step past the overshoot, growing with each attempt: the pill that must move is often wider.
        budget[Math.min(r, m)] = Math.max(0, budget[Math.min(r, m)]! - over - 12 - 4 * attempt);
      }
    });
    if (worst < narrowest) {
      narrowest = worst;
      row = tried;
    }
    if (worst === 0) {
      break;
    }
  }

  // Items are the concepts (0..m-1) and the dummy slots a long link passes through.
  const itemRow: number[] = [...row];
  const itemWidth: number[] = [...widths];
  const itemKey: number[] = members.map((_, i) => i);
  const up: number[][] = members.map(() => []);
  const down: number[][] = members.map(() => []);
  /** Item chain of each link, top to bottom; null for a link between two concepts of one row. */
  const chains: (number[] | null)[] = [];
  const arcs: { k: number; a: number; b: number }[] = [];
  /** The shared slot of a concept's long links in a row: one trunk per (top concept, row). */
  const trunkSlot = new Map<number, number>();
  for (const [k, { a, b }] of pairs.entries()) {
    if (row[a] === row[b]) {
      chains.push(null);
      arcs.push({ k, a, b });
      continue;
    }
    const top = row[a]! < row[b]! ? a : b;
    const bottom = top === a ? b : a;
    const chain = [top];
    let previous = top;
    for (let r = row[top]! + 1; r < row[bottom]!; r++) {
      const key = top * (m + 1) + r;
      let dummy = trunkSlot.get(key);
      if (dummy === undefined) {
        dummy = itemRow.length;
        trunkSlot.set(key, dummy);
        itemRow.push(r);
        itemWidth.push(DUMMY_WIDTH);
        itemKey.push(top + 0.5 + dummy * 1e-6);
        up.push([]);
        down.push([]);
        down[previous]!.push(dummy);
        up[dummy]!.push(previous);
      }
      chain.push(dummy);
      previous = dummy;
    }
    down[previous]!.push(bottom);
    up[bottom]!.push(previous);
    chain.push(bottom);
    chains.push(chain);
  }

  const rowCount = Math.max(...row) + 1;
  const rows: number[][] = Array.from({ length: rowCount }, () => []);
  itemRow.forEach((r, item) => rows[r]!.push(item));
  const slot = new Array<number>(itemRow.length).fill(0);
  const reindex = (r: number) => rows[r]!.forEach((item, k) => (slot[item] = k));
  for (let r = 0; r < rowCount; r++) {
    rows[r]!.sort((x, y) => itemKey[x]! - itemKey[y]! || x - y);
    // The slots of links that skip this row start in the middle of it, not at its left end: a hub
    // whose neighbours wrap onto a second row keeps both rows centred under it instead of one
    // row pushed right by the slots and the other pulled left to meet them.
    const concepts = rows[r]!.filter((item) => item < m);
    const slots = rows[r]!.filter((item) => item >= m);
    if (slots.length > 0 && concepts.length > 0) {
      const middle = Math.floor(concepts.length / 2);
      rows[r] = [...concepts.slice(0, middle), ...slots, ...concepts.slice(middle)];
    }
    reindex(r);
  }

  // Order each row by the mean slot of its neighbours, sweeping down and up (fewer crossings).
  const reorder = (r: number, towards: number[][]) => {
    // Slots are compared as shares of their row (0 = left end, 1 = right end): rows of different
    // sizes then line up, and the slots of a link that skips this row stay near the middle of it
    // instead of being pulled to the left end by the first few concepts of a wrapped row below.
    const share = (item: number) => {
      const size = rows[itemRow[item]!]!.length;
      return size > 1 ? slot[item]! / (size - 1) : 0.5;
    };
    const barycentre = (item: number) => {
      const around = towards[item]!;
      if (around.length === 0) {
        return share(item);
      }
      return around.reduce((sum, other) => sum + share(other), 0) / around.length;
    };
    const keyed = rows[r]!.map((item) => ({ item, at: barycentre(item) }));
    keyed.sort((x, y) => x.at - y.at || slot[x.item]! - slot[y.item]!);
    rows[r] = keyed.map((entry) => entry.item);
    reindex(r);
  };
  for (let sweep = 0; sweep < (itemRow.length > BIG_ITEM_COUNT ? 2 : SWEEPS); sweep++) {
    for (let r = 1; r < rowCount; r++) {
      reorder(r, up);
    }
    for (let r = rowCount - 2; r >= 0; r--) {
      reorder(r, down);
    }
  }

  // Place the rows: packed and centred first, then pulled towards their neighbours' middles, but
  // never so far that a row is wider than the width budget (a row too wide for it is blended back
  // towards its packed, centred placement) or leaves the budget's window around the middle.
  const centre = new Array<number>(itemRow.length).fill(0);
  const spacingOf = (items: number[]) =>
    items.slice(1).map((item, k) => {
      const before = items[k]!;
      const gap = before >= m && item >= m ? 0 : before >= m || item >= m ? DUMMY_CLEARANCE : GAP;
      return (itemWidth[before]! + itemWidth[item]!) / 2 + gap;
    });
  const packedOf = (items: number[]) => {
    const packed = placeRow(
      items.map(() => 0),
      spacingOf(items),
    );
    const middle = (packed[0]! + packed[packed.length - 1]!) / 2;
    return packed.map((x) => x - middle);
  };
  const edgeSpan = (items: number[], at: number[]) =>
    at[at.length - 1]! - at[0]! + (itemWidth[items[0]!]! + itemWidth[items[items.length - 1]!]!) / 2;
  // The widest row, packed, can be wider than the budget when one concept (or a row of slots) is.
  const packedRows = rows.map((items) => packedOf(items));
  const bound = Math.max(maxRowWidth - 1, ...rows.map((items, r) => edgeSpan(items, packedRows[r]!)));
  for (let r = 0; r < rowCount; r++) {
    const items = rows[r]!;
    packedRows[r]!.forEach((x, k) => (centre[items[k]!] = x));
  }
  for (let pass = 0; pass < (itemRow.length > BIG_ITEM_COUNT ? 4 : PLACEMENT_PASSES); pass++) {
    const order = pass % 2 === 0 ? [...rows.keys()] : [...rows.keys()].reverse();
    for (const r of order) {
      const items = rows[r]!;
      const wanted = items.map((item) => {
        const around = [...up[item]!, ...down[item]!];
        // The middle of the neighbours, with the map's axis counted as one more neighbour of weight
        // AXIS_PULL: a chain of slots then does not drift to one side, so rows stay centred.
        return around.length === 0
          ? centre[item]!
          : around.reduce((sum, other) => sum + centre[other]!, 0) / (around.length + AXIS_PULL);
      });
      let at = placeRow(wanted, spacingOf(items));
      const span = edgeSpan(items, at);
      if (span > bound) {
        const packed = packedRows[r]!;
        const t = Math.min(1, (span - bound) / Math.max(1e-6, span - edgeSpan(items, packed)));
        at = at.map((x, k) => x * (1 - t) + packed[k]! * t);
      }
      const leftEdge = at[0]! - itemWidth[items[0]!]! / 2;
      const rightEdge = at[at.length - 1]! + itemWidth[items[items.length - 1]!]! / 2;
      const shift = leftEdge < -bound / 2 ? -bound / 2 - leftEdge : rightEdge > bound / 2 ? bound / 2 - rightEdge : 0;
      at.forEach((x, k) => (centre[items[k]!] = x + shift));
    }
  }

  let minLeft = Infinity;
  let maxRight = -Infinity;
  for (let item = 0; item < itemRow.length; item++) {
    minLeft = Math.min(minLeft, centre[item]! - itemWidth[item]! / 2);
    maxRight = Math.max(maxRight, centre[item]! + itemWidth[item]! / 2);
  }

  const left = itemRow.map((_, item) => Math.round(centre[item]! - itemWidth[item]! / 2 - minLeft));

  // Arcs: each runs in a lane of the gap above its row. A shorter arc takes the lowest free lane,
  // so nested arcs stay inside each other. At a pill the arcs leave side by side, off its centre
  // (where the link from the row above arrives), the farther partner on the outer side.
  const spanOf = (arc: { a: number; b: number }) => Math.abs(left[arc.a]! + itemWidth[arc.a]! / 2 - left[arc.b]! - itemWidth[arc.b]! / 2);
  const portsOf = new Map<number, Map<number, number>>();
  const arcsOf: { k: number; a: number; b: number }[][] = Array.from({ length: m }, () => []);
  for (const arc of arcs) {
    arcsOf[arc.a]!.push(arc);
    arcsOf[arc.b]!.push(arc);
  }
  for (let member = 0; member < m; member++) {
    const mine = arcsOf[member]!
      .map((arc) => {
        const other = arc.a === member ? arc.b : arc.a;
        const dx = left[other]! + itemWidth[other]! / 2 - left[member]! - itemWidth[member]! / 2;
        return { arc, dx };
      })
      .sort((x, y) => (x.dx < 0 ? 0 : 1) - (y.dx < 0 ? 0 : 1) || (x.dx < 0 ? -x.dx - -y.dx : y.dx - x.dx) || x.arc.k - y.arc.k);
    if (mine.length === 0) {
      continue;
    }
    const reach = Math.max(0, itemWidth[member]! / 2 - 6);
    const shift = mine.length % 2 === 1 ? PORT_STEP / 2 : 0;
    const ports = new Map<number, number>();
    mine.forEach(({ arc }, i) => {
      const offset = (i - (mine.length - 1) / 2) * PORT_STEP + shift;
      ports.set(arc.k, left[member]! + itemWidth[member]! / 2 + Math.max(-reach, Math.min(reach, offset)));
    });
    portsOf.set(member, ports);
  }
  const lanes: { lo: number; hi: number; lane: number }[][] = Array.from({ length: rowCount }, () => []);
  const laneOf = new Map<number, number>();
  for (const arc of [...arcs].sort((x, y) => spanOf(x) - spanOf(y) || x.k - y.k)) {
    const xa = portsOf.get(arc.a)!.get(arc.k)!;
    const xb = portsOf.get(arc.b)!.get(arc.k)!;
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    const taken = lanes[row[arc.a]!]!;
    let lane = 0;
    while (taken.some((t) => t.lane === lane && lo < t.hi + PORT_STEP && t.lo < hi + PORT_STEP)) {
      lane++;
    }
    taken.push({ lo, hi, lane });
    laneOf.set(arc.k, lane);
  }
  // A row with more lanes than its gap holds moves down: its gap grows by the missing lanes.
  const rowY: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    const used = lanes[r]!.reduce((most, t) => Math.max(most, t.lane + 1), 0);
    const extra = Math.max(0, used - LANES_IN_GAP) * LANE_STEP;
    rowY.push(r === 0 ? 0 : rowY[r - 1]! + ROW_PITCH + extra);
  }

  const boxes = new Map<number, NodeBox>();
  const dummyAt = new Map<number, { x: number; y: number }>();
  for (let item = 0; item < itemRow.length; item++) {
    const y = rowY[itemRow[item]!]!;
    const x = left[item]!;
    if (item < m) {
      boxes.set(members[item]!, { x, y, width: itemWidth[item]! });
    } else {
      dummyAt.set(item, { x: x + itemWidth[item]! / 2, y });
    }
  }

  const routes: LayoutRoute[] = pairs.map(({ link, a, b }, k) => {
    const points: [number, number][] = [];
    const chain = chains[k];
    if (!chain) {
      const y = boxes.get(members[a]!)!.y;
      const lane = y - LANE_FIRST - laneOf.get(k)! * LANE_STEP;
      const xa = portsOf.get(a)!.get(k)!;
      const xb = portsOf.get(b)!.get(k)!;
      points.push([xa, y], [xa, lane], [xb, lane], [xb, y]);
      return { from: link.from, to: link.to, points };
    }
    for (const item of chain) {
      if (item < m) {
        const box = boxes.get(members[item]!)!;
        const first = points.length === 0;
        points.push([box.x + box.width / 2, first ? box.y + NODE_HEIGHT : box.y]);
      } else {
        const at = dummyAt.get(item)!;
        points.push([at.x, at.y], [at.x, at.y + NODE_HEIGHT]);
      }
    }
    return { from: link.from, to: link.to, points };
  });
  return {
    boxes,
    routes,
    width: Math.ceil(maxRight - minLeft),
    height: rowY[rowCount - 1]! + NODE_HEIGHT,
  };
}

/**
 * Lays the concepts out for a canvas `canvasWidth` px wide (the scrolling viewport; the default is
 * the real Map canvas at a 1440 px window). Rows wrap inside the width that still shows the whole
 * map at the Fit floor, so a map grows downwards, not sideways.
 */
export function layoutConcepts(nodes: LayoutNode[], edges: LayoutEdge[], canvasWidth: number = DEFAULT_CANVAS_WIDTH): GraphLayout {
  const n = nodes.length;
  if (n === 0) {
    return { positions: new Map(), routes: [], width: PAD * 2, height: PAD * 2 };
  }
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const widths = nodes.map((node) => nodeWidth(node.label));

  // Unique links between known concepts, in input order.
  const links: Link[] = [];
  const seenLinks = new Set<string>();
  const neighbours: number[][] = nodes.map(() => []);
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenLinks.has(key)) {
      continue;
    }
    seenLinks.add(key);
    links.push({ a, b, from: edge.from, to: edge.to });
    neighbours[a]!.push(b);
    neighbours[b]!.push(a);
  }
  for (const list of neighbours) {
    list.sort((x, y) => x - y);
  }

  // Groups of linked concepts, each rooted at its most-linked concept; members in breadth-first order.
  const group = new Array<number>(n).fill(-1);
  const groups: number[][] = [];
  const roots = nodes
    .map((_, i) => i)
    .filter((i) => neighbours[i]!.length > 0)
    .sort((x, y) => neighbours[y]!.length - neighbours[x]!.length || x - y);
  for (const root of roots) {
    if (group[root]! >= 0) {
      continue;
    }
    const members = [root];
    group[root] = groups.length;
    for (let head = 0; head < members.length; head++) {
      for (const next of neighbours[members[head]!]!) {
        if (group[next]! < 0) {
          group[next] = groups.length;
          members.push(next);
        }
      }
    }
    groups.push(members);
  }
  const lonely = nodes.map((_, i) => i).filter((i) => group[i]! < 0);

  // A full row pushes concepts down: big maps grow downwards.
  const maxRowWidth = rowBudget(canvasWidth);
  const blocks = groups.map((members) =>
    layoutGroup(
      members,
      links.filter((link) => group[link.a] === group[members[0]!]),
      (member) => widths[member]!,
      maxRowWidth,
    ),
  );

  // Concepts without links wait in rows of their own at the bottom, centred and wrapped.
  // A concept wider than the rest sets the width itself, so no pill starts left of the canvas.
  const lonelyTotal = lonely.reduce((sum, i) => sum + widths[i]! + GAP, 0) - GAP;
  const innerWidth = Math.max(
    Math.min(maxRowWidth, lonelyTotal),
    ...blocks.map((b) => b.width),
    ...lonely.map((i) => widths[i]!),
  );
  const lonelyRows: number[][] = [];
  let used = 0;
  for (const i of lonely) {
    const current = lonelyRows[lonelyRows.length - 1];
    if (!current || used + GAP + widths[i]! > innerWidth) {
      lonelyRows.push([i]);
      used = widths[i]!;
    } else {
      current.push(i);
      used += GAP + widths[i]!;
    }
  }

  const positions = new Map<string, NodeBox>();
  const routes: LayoutRoute[] = [];
  let y = PAD;
  for (const block of blocks) {
    const dx = PAD + Math.round((innerWidth - block.width) / 2);
    for (const [member, box] of block.boxes) {
      positions.set(nodes[member]!.id, { x: box.x + dx, y: box.y + y, width: box.width });
    }
    for (const route of block.routes) {
      routes.push({ ...route, points: route.points.map(([px, py]) => [px + dx, py + y] as [number, number]) });
    }
    y += block.height + ROW_GAP;
  }
  for (const items of lonelyRows) {
    const rowWidth = items.reduce((sum, i) => sum + widths[i]!, 0) + GAP * (items.length - 1);
    let x = PAD + (innerWidth - rowWidth) / 2;
    for (const i of items) {
      positions.set(nodes[i]!.id, { x: Math.round(x), y, width: widths[i]! });
      x += widths[i]! + GAP;
    }
    y += NODE_HEIGHT + GAP;
  }
  // `y` is one step past the last row; drop that step and add the bottom padding.
  const lastStep = lonelyRows.length > 0 ? GAP : ROW_GAP;
  return { positions, routes, width: innerWidth + PAD * 2, height: y - lastStep + PAD };
}
