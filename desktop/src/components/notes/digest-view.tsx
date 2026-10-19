import { useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { Chip } from "~/components/app/chip";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { digestKey, nodesForDigest, parseConceptGraph } from "~/domain/concepts";
import { VIEWER_WRITE_REASON, viewerBlocksWrite } from "~/domain/library-role";
import {
  collapseSelectionText,
  digestNotesPath,
  digestSlugFromPath,
  headingForSelectionNode,
  pageForSelectionNode,
} from "~/domain/notes";
import { arborDigestTarget, headingId } from "~/domain/markdown";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useAppendCardMutation } from "~/lib/queries/study";
import { useLibrary } from "~/lib/queries/library";
import { useRenderedMarkdown } from "~/lib/queries/notes";
import { useStudyJson } from "~/lib/queries/study";
import { useSettings } from "~/lib/queries/settings";
import type { DigestInfo } from "~/domain/types";

const MakeCardDialog = lazy(() =>
  import("~/components/notes/make-card-dialog").then((m) => ({ default: m.MakeCardDialog })),
);

type SelectionSnapshot = {
  text: string;
  heading: string | null;
  page: string | null;
  digest: string;
};

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
  const library = useLibrary(activeRoot);
  const role = library.data?.present === true ? library.data.role : null;
  const viewerBlocked = viewerBlocksWrite(role);
  const appendCard = useAppendCardMutation(activeRoot, course);

  const articleRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const makeCardBtnRef = useRef<HTMLButtonElement>(null);
  const keepSnapshotRef = useRef(false);
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const digestMeta = digests.find((d) => digestSlugFromPath(d.path) === digestSlug);
  const rendered = markdown.data;

  useEffect(() => {
    const onSelectionChange = () => {
      const keepSnapshot =
        keepSnapshotRef.current ||
        dialogOpen ||
        Boolean(makeCardBtnRef.current?.matches(":active"));
      const article = articleRef.current;
      if (!article) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        if (!keepSnapshot) {
          setSnapshot(null);
        }
        return;
      }
      const anchor = selection.anchorNode;
      if (!anchor || !article.contains(anchor)) {
        if (!keepSnapshot) {
          setSnapshot(null);
        }
        return;
      }
      const text = collapseSelectionText(selection.toString(), 2000).trim();
      if (!text) {
        if (!keepSnapshot) {
          setSnapshot(null);
        }
        return;
      }
      const digestRef = digestMeta ? digestKey(digestMeta.path) : `digests/${digestSlug}.md`;
      setSnapshot({
        text,
        heading: headingForSelectionNode(selection.anchorNode, article),
        page: pageForSelectionNode(selection.anchorNode, article),
        digest: digestRef,
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [digestSlug, digestMeta, dialogOpen]);

  useEffect(() => {
    const pane = scrollRef.current;
    const article = articleRef.current;
    if (!pane || !article) {
      return;
    }
    const id = heading ? headingId(heading) : "";
    if (!id) {
      pane.scrollTo(0, 0);
      return;
    }
    const target = article.querySelector(`#${CSS.escape(id)}`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "start" });
      return;
    }
    pane.scrollTo(0, 0);
  }, [heading, rendered?.html, digestSlug]);

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
    if (!href) {
      return;
    }
    const digestTarget = arborDigestTarget(href);
    if (!digestTarget) {
      return;
    }
    event.preventDefault();
    const slug = digestSlugFromPath(digestTarget);
    void navigate({
      to: "/course/$course/notes/$digest",
      params: { course, digest: slug },
    });
  };

  const citationParts = snapshot
    ? [
        snapshot.digest,
        snapshot.heading,
        snapshot.page ? `p. ${snapshot.page}` : null,
      ].filter(Boolean)
    : [];

  if (markdown.isLoading) {
    return (
      <div className="mx-auto w-full max-w-reading px-8 py-9">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="mb-6 h-10 w-3/4" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (markdown.isError) {
    return (
      <div className="mx-auto w-full max-w-reading px-8 py-9 text-read text-muted-foreground">
        Could not load file:{" "}
        {markdown.error instanceof Error ? markdown.error.message : String(markdown.error)}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-testid="digest-view"
      className="notes-reading-pane relative min-h-0 flex-1 overflow-y-auto px-8 py-9 pb-16"
    >
      <div className="mx-auto w-full max-w-reading">
        <div className="notes-eyebrow">
          <FileText className="size-icon-sm" aria-hidden />
          <span>{digestMeta ? `${digestMeta.date}` : "Digest"}</span>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <div className="mr-auto flex flex-wrap gap-1.5">
            {rendered?.pageChip ? (
              <Chip variant="plain" data-arbor-page={rendered.pageChipRange ?? undefined}>
                Pages {rendered.pageChip}
              </Chip>
            ) : null}
            {conceptNodes.map((node) => (
              <Chip
                key={node.id}
                variant={node.kind === "figure" ? "figure" : "default"}
                onClick={() => {
                  void navigate({
                    to: "/course/$course/graph",
                    params: { course },
                    search: { concept: node.id },
                  });
                }}
              >
                {node.name}
              </Chip>
            ))}
          </div>
          <Button
            ref={makeCardBtnRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={!snapshot || viewerBlocked}
            title={viewerBlocked ? VIEWER_WRITE_REASON : undefined}
            onMouseEnter={() => {
              keepSnapshotRef.current = true;
            }}
            onMouseLeave={() => {
              if (!dialogOpen) {
                keepSnapshotRef.current = false;
              }
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              keepSnapshotRef.current = true;
            }}
            onMouseUp={() => {
              if (!dialogOpen) {
                keepSnapshotRef.current = false;
              }
            }}
            onClick={() => {
              if (viewerBlocked || !snapshot) {
                return;
              }
              setSaveError(null);
              setDialogMounted(true);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-icon-sm" />
            Make card
          </Button>
        </div>
        <article
          ref={articleRef}
          className="prose-arbor"
          onClick={onArticleClick}
          dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
        />
      </div>
      {dialogMounted ? (
        <Suspense fallback={null}>
          <MakeCardDialog
            key={snapshot?.text ?? "make-card"}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
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
                    setDialogOpen(false);
                    void navigate({
                      to: "/course/$course/flashcards",
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
