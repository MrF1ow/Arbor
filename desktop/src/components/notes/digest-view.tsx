import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { citedRanges, sourceSummary, stripLeadingH1, withCitationChips } from "~/components/notes/citation-chips";
import { Chip } from "~/components/app/chip";
import { PreviewBarRight } from "~/components/workspace/preview-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { digestKey, nodesForDigest, parseConceptGraph } from "~/domain/concepts";
import { toCourseDigest } from "~/domain/lectures";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import {
  collapseSelectionText,
  digestNotesPath,
  digestSlugFromPath,
  headingForSelectionNode,
  pageForSelectionNode,
} from "~/domain/notes";
import { arborDigestTarget, headingId } from "~/domain/markdown";
import { READ_FRACTION } from "~/domain/reading";
import type { DigestInfo } from "~/domain/types";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useDigestStats } from "~/lib/queries/class-stats";
import { useLibrary } from "~/lib/queries/library";
import { useRenderedMarkdown } from "~/lib/queries/notes";
import { useReadingState, useWriteReadingState } from "~/lib/queries/reading-state";
import { useSettings } from "~/lib/queries/settings";
import { useAppendCardMutation, useStudyJson } from "~/lib/queries/study";
import { useSelectionStore } from "~/stores/selection-store";

const MakeCardDialog = lazy(() =>
  import("~/components/notes/make-card-dialog").then((m) => ({ default: m.MakeCardDialog })),
);

type SelectionSnapshot = {
  text: string;
  heading: string | null;
  page: string | null;
  digest: string;
  /** Viewport position the toolbar floats at, above the selected text. */
  top: number;
  left: number;
};

/** How far above the selection the toolbar floats, in px. */
const TOOLBAR_OFFSET = 48;

const TOOLBAR_BUTTON =
  "inline-flex h-control items-center rounded-lg px-3 text-small text-foreground transition-colors duration-fast ease-out-soft hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

function basename(path: string | null | undefined): string | null {
  const name = path?.split("/").pop();
  return name || null;
}

/** "Digest · 12 cards · never quizzed", from the lecture's digest-stats row. */
function metaLine(stats: { cards: number; quiz_correct: number; quiz_wrong: number } | undefined): string {
  if (!stats) {
    return "Digest";
  }
  const parts = ["Digest"];
  if (stats.cards > 0) {
    parts.push(stats.cards === 1 ? "1 card" : `${stats.cards} cards`);
  }
  const answers = stats.quiz_correct + stats.quiz_wrong;
  parts.push(answers === 0 ? "never quizzed" : `${answers} quiz ${answers === 1 ? "answer" : "answers"}`);
  return parts.join(" · ");
}

/**
 * Read (design "Class · Read"): one digest in the reading style, with slide citation chips, a
 * Make card / Ask about this toolbar over selected text, and scroll progress recorded as reading
 * state (it feeds the badges and Today's Continue reading).
 */
export function DigestView({
  course,
  digestSlug,
  digests,
  heading,
}: {
  course: string;
  digestSlug: string;
  digests: DigestInfo[];
  heading?: string;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const relativePath = digestNotesPath(course, digestSlug, digests);
  const markdown = useRenderedMarkdown(activeRoot, relativePath);
  const conceptsJson = useStudyJson(activeRoot, course, "concepts.json");
  const stats = useDigestStats(activeRoot, course);
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const appendCard = useAppendCardMutation(activeRoot, course);
  const setAskFocus = useSelectionStore((s) => s.setAskFocus);
  const reading = useReadingState(activeRoot);
  const { write: writeReading } = useWriteReadingState(activeRoot);

  const articleRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogOpenRef = useRef(false);
  /** The digest whose opening position is settled, so resuming runs once per open. */
  const positionedRef = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const digestMeta = digests.find((d) => digestSlugFromPath(d.path) === digestSlug);
  const digestPath = toCourseDigest(course, relativePath);
  const rendered = markdown.data;
  const title = digestMeta?.title ?? digestSlug;
  const sourceName = basename(digestMeta?.source_path);
  const statsRow = Object.entries(stats.data ?? {}).find(
    ([key]) => toCourseDigest(course, key) === digestPath,
  )?.[1];

  const closeDialog = (open: boolean) => {
    dialogOpenRef.current = open;
    setDialogOpen(open);
  };

  // Reading progress: how far down the pane the reader has got, throttled by the hook.
  const reportProgress = useCallback(() => {
    const pane = scrollRef.current;
    if (!pane) {
      return;
    }
    const height = pane.scrollHeight;
    const fraction = height > 0 ? Math.min(1, (pane.scrollTop + pane.clientHeight) / height) : 0;
    writeReading(digestPath, fraction);
  }, [digestPath, writeReading]);

  const html = rendered?.html;
  useEffect(() => {
    if (html !== undefined) {
      reportProgress();
    }
  }, [html, reportProgress]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (dialogOpenRef.current) {
        return;
      }
      const article = articleRef.current;
      if (!article) {
        return;
      }
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      if (!selection || selection.isCollapsed || !anchor || !article.contains(anchor)) {
        setSnapshot(null);
        return;
      }
      const text = collapseSelectionText(selection.toString(), 2000).trim();
      if (!text) {
        setSnapshot(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const digestRef = digestMeta ? digestKey(digestMeta.path) : `digests/${digestSlug}.md`;
      setSnapshot({
        text,
        heading: headingForSelectionNode(anchor, article),
        page: pageForSelectionNode(anchor, article),
        digest: digestRef,
        top: Math.max(rect.top - TOOLBAR_OFFSET, 0),
        left: Math.max(rect.left, 0),
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [digestSlug, digestMeta]);

  // A link to a section scrolls to it.
  useEffect(() => {
    const pane = scrollRef.current;
    const article = articleRef.current;
    const id = heading ? headingId(heading) : "";
    if (!pane || !article || !id) {
      return;
    }
    const target = article.querySelector(`#${CSS.escape(id)}`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start" });
      return;
    }
    pane.scrollTo(0, 0);
  }, [heading, html, digestSlug]);

  // With no section link, an unfinished lecture reopens where it was left (a read or never-opened
  // one starts at the top). It waits for the reading state, runs once per open, and never writes:
  // the store keeps the furthest fraction.
  const readingLoaded = reading.data !== undefined;
  const savedFraction = reading.data?.[digestPath]?.fraction;
  useEffect(() => {
    const pane = scrollRef.current;
    if (heading || html === undefined || !readingLoaded || !pane || positionedRef.current === digestPath) {
      return;
    }
    positionedRef.current = digestPath;
    if (savedFraction !== undefined && savedFraction > 0 && savedFraction < READ_FRACTION) {
      pane.scrollTo(0, Math.max(0, savedFraction * pane.scrollHeight - pane.clientHeight));
    } else {
      pane.scrollTo(0, 0);
    }
  }, [heading, html, digestPath, readingLoaded, savedFraction]);

  let conceptNodes: ReturnType<typeof nodesForDigest> = [];
  if (conceptsJson.data) {
    try {
      const graph = parseConceptGraph(conceptsJson.data);
      conceptNodes = nodesForDigest(graph, relativePath);
    } catch {
      conceptNodes = [];
    }
  }

  const onArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a[data-arbor-digest]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const href = anchor.getAttribute("href");
    const digestTarget = href ? arborDigestTarget(href) : null;
    if (!digestTarget) {
      return;
    }
    event.preventDefault();
    void navigate({
      to: "/course/$course/read/$digest",
      params: { course, digest: digestSlugFromPath(digestTarget) },
      search: {},
    });
  };

  const citationParts = snapshot
    ? [snapshot.digest, snapshot.heading, snapshot.page ? `p. ${snapshot.page}` : null].filter(Boolean)
    : [];

  if (markdown.isLoading) {
    return (
      <div className="min-h-0 flex-1 px-10 pt-6">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="mb-6 h-10 w-3/4" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (markdown.isError) {
    return (
      <div className="px-10 pt-6 text-reading text-muted-foreground">
        Could not load file:{" "}
        {markdown.error instanceof Error ? markdown.error.message : String(markdown.error)}
      </div>
    );
  }

  const bodyHtml = withCitationChips(stripLeadingH1(rendered?.html ?? ""), digestMeta?.source_path);

  return (
    <div
      ref={scrollRef}
      data-testid="digest-view"
      onScroll={() => {
        reportProgress();
        // The toolbar floats over the text, so it follows the selection while the page moves.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          setSnapshot((prev) =>
            prev ? { ...prev, top: Math.max(rect.top - TOOLBAR_OFFSET, 0), left: Math.max(rect.left, 0) } : prev,
          );
        }
      }}
      className="relative min-h-0 flex-1 overflow-y-auto px-10 pb-16 pt-6"
    >
      <PreviewBarRight>
        {sourceSummary(sourceName, rendered ? citedRanges(rendered.html) : null, digestMeta?.source_path)}
      </PreviewBarRight>
      <div className="w-full max-w-reading">
        <h1 className="text-reading-title break-words text-foreground">{title}</h1>
        <div className="mt-3 flex items-center gap-3 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{metaLine(statsRow)}</span>
          {sourceName ? (
            <span className="shrink-0 rounded-xs border border-info px-1 text-micro text-info">{sourceName}</span>
          ) : null}
        </div>
        {conceptNodes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {conceptNodes.map((node) => (
              <Chip
                key={node.id}
                variant={node.kind === "figure" ? "figure" : "default"}
                onClick={() => {
                  void navigate({
                    to: "/course/$course/map",
                    params: { course },
                    search: { concept: node.id },
                  });
                }}
              >
                {node.name}
              </Chip>
            ))}
          </div>
        ) : null}
        <article
          ref={articleRef}
          className="prose-arbor mt-5 break-words text-reading"
          onClick={onArticleClick}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </div>

      {snapshot && !dialogOpen ? (
        <div
          role="toolbar"
          aria-label="Selection"
          className="fixed z-floating flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-popover"
          style={{ top: snapshot.top, left: snapshot.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            disabled={viewerBlocked}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onClick={() => {
              if (viewerBlocked) {
                return;
              }
              setSaveError(null);
              setDialogMounted(true);
              closeDialog(true);
            }}
          >
            Make card
          </button>
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            onClick={() => {
              setAskFocus({
                digest: toCourseDigest(course, snapshot.digest),
                heading: snapshot.heading,
                text: snapshot.text,
              });
              void navigate({ to: "/course/$course/ask", params: { course }, search: {} });
            }}
          >
            Ask about this
          </button>
        </div>
      ) : null}

      {dialogMounted ? (
        <Suspense fallback={null}>
          <MakeCardDialog
            key={snapshot?.text ?? "make-card"}
            open={dialogOpen}
            onOpenChange={closeDialog}
            initialText={snapshot?.text ?? ""}
            citation={citationParts.join(" · ")}
            disabled={viewerBlocked}
            saving={appendCard.isPending}
            error={saveError}
            onSave={(front, back) => {
              if (!snapshot) {
                return;
              }
              setSaveError(null);
              appendCard.mutate(
                {
                  front,
                  back,
                  digest: snapshot.digest,
                  heading: snapshot.heading,
                  page: snapshot.page,
                },
                {
                  onSuccess: (card) => {
                    closeDialog(false);
                    void navigate({
                      to: "/course/$course/practice/cards",
                      params: { course },
                      search: { card: card.id },
                    });
                  },
                  onError: (error) => {
                    setSaveError(String(error));
                  },
                },
              );
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
