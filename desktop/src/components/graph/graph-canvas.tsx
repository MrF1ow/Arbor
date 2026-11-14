import { Minus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button, IconButton } from "~/components/ui/button";
import {
  DEFAULT_CANVAS_WIDTH,
  fitScale,
  layoutConcepts,
  revealScroll,
  type LayoutEdge,
} from "~/components/graph/graph-layout";
import { cn } from "~/lib/utils";

export type CanvasNode = { id: string; label: string; figure: boolean };
const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;

const clamp = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
/** Room a vertical scrollbar can take from the viewport: the layout leaves it free, so a tall map never scrolls sideways. */
const SCROLLBAR_ROOM = 16;
/** The measured width is rounded down to a multiple of this, so a resize does not lay the map out again on every pixel. */
const WIDTH_STEP = 8;

/**
 * The concept map: a pill per concept on a laid-out canvas, links between neighbours, and the
 * design's zoom controls (- + Fit). Until the user zooms, the map is fitted to the card, but never
 * smaller than a readable size: a bigger map scrolls. `highlighted` is the set of concepts to
 * emphasise (Show on map), null when nothing is ticked; `legend` is a small note under the controls.
 * The map is laid out for the measured width of the canvas, so its rows wrap inside it; the layout is
 * computed again only when the graph or the rounded width changes, not on a click.
 */
export function GraphCanvas({
  edges,
  nodes,
  selectedId,
  highlighted,
  legend,
  onSelect,
}: {
  edges: LayoutEdge[];
  nodes: CanvasNode[];
  selectedId: string;
  highlighted: ReadonlySet<string> | null;
  legend?: string;
  onSelect: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [manual, setManual] = useState<number | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
      // The full width less room for a scrollbar, so the layout does not depend on whether one shows.
      const room = Math.floor((el.offsetWidth - SCROLLBAR_ROOM) / WIDTH_STEP) * WIDTH_STEP;
      if (room > 0) {
        setCanvasWidth(room);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutConcepts(nodes, edges, canvasWidth), [nodes, edges, canvasWidth]);

  const fit = size.width > 0 && size.height > 0 ? fitScale(size, layout) : 1;
  const scale = manual ?? fit;
  const shownWidth = layout.width * scale;
  const shownHeight = layout.height * scale;

  // A concept picked elsewhere (Neighbors, arrow keys, Show on map, ?concept=) scrolls into view.
  // The zoom is read when the selection or the viewport changes, not on every zoom step.
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  });
  useEffect(() => {
    const el = viewportRef.current;
    const box = layout.positions.get(selectedId);
    if (!el || !box || el.clientWidth === 0 || el.clientHeight === 0 || typeof el.scrollTo !== "function") {
      return;
    }
    const to = revealScroll(
      box,
      scaleRef.current,
      { width: el.clientWidth, height: el.clientHeight },
      { left: el.scrollLeft, top: el.scrollTop },
    );
    if (to.left !== el.scrollLeft || to.top !== el.scrollTop) {
      el.scrollTo({ left: to.left, top: to.top });
    }
  }, [layout, selectedId, size]);

  return (
    <div
      data-testid="concept-canvas"
      data-zoom={scale.toFixed(3)}
      className="relative flex h-112 min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card @3xl/graph-main:h-auto @3xl/graph-main:min-h-96 @3xl/graph-main:flex-1"
    >
      <div className="flex shrink-0 items-center gap-1 px-4 pb-1 pt-4">
        <IconButton
          icon={Minus}
          label="Zoom out"
          size="icon-sm"
          variant="outline"
          tooltip={false}
          onClick={() => setManual(clamp(scale / ZOOM_STEP))}
        />
        <IconButton
          icon={Plus}
          label="Zoom in"
          size="icon-sm"
          variant="outline"
          tooltip={false}
          onClick={() => setManual(clamp(scale * ZOOM_STEP))}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setManual(null)}>
          Fit
        </Button>
        {legend ? <span className="ml-auto truncate text-caption text-faint-foreground">{legend}</span> : null}
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto"
          style={{ width: shownWidth, height: shownHeight }} // style-allow: scaled canvas size
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }} // style-allow: layout size and live zoom
          >
            <svg
              aria-hidden
              className="absolute left-0 top-0 stroke-border"
              width={layout.width}
              height={layout.height}
              strokeWidth={1.5}
            >
              {layout.routes.map((route, i) => (
                <polyline
                  key={`${route.from}-${route.to}-${i}`}
                  fill="none"
                  points={route.points.map(([x, y]) => `${x},${y}`).join(" ")}
                />
              ))}
            </svg>
            {nodes.map((node) => {
              const box = layout.positions.get(node.id)!;
              const selected = node.id === selectedId;
              const lit = highlighted?.has(node.id) ?? false;
              return (
                <button
                  key={node.id}
                  type="button"
                  data-highlighted={lit ? "true" : "false"}
                  aria-pressed={selected}
                  onClick={() => onSelect(node.id)}
                  style={{ left: box.x, top: box.y, width: box.width }} // style-allow: laid-out position
                  className={cn(
                    "absolute inline-flex h-8.25 items-center justify-center whitespace-nowrap rounded-full border px-3 text-small transition-colors duration-fast ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    node.figure && "border-dashed",
                    selected
                      ? "border-primary bg-primary font-medium text-primary-foreground"
                      : lit
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-background hover:bg-muted",
                    highlighted && !selected && !lit ? "text-faint-foreground" : !selected && !lit && "text-foreground",
                  )}
                >
                  {node.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
