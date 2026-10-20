import { useNavigate } from "@tanstack/react-router";
import { Image, ListCollapse, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Chip } from "~/components/app/chip";
import { EmptyState } from "~/components/app/empty-state";
import { ListRow } from "~/components/app/list-row";
import { SectionLabel } from "~/components/app/section-label";
import { UnsavedBadge } from "~/components/app/unsaved-badge";
import { StudySourceChip } from "~/components/study/study-source-chip";
import { StudyUnverifiedBadge } from "~/components/study/study-unverified-badge";
import { Button, IconButton } from "~/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { courseDisplayName } from "~/domain/course";
import { failedIdsFor, parseCitationsReport } from "~/domain/citations";
import { neighbors, parseConceptGraph } from "~/domain/concepts";
import type { ConceptGraph, ConceptNode, DigestInfo } from "~/domain/types";
import { useNotesMainNarrow } from "~/hooks/use-notes-main-narrow";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { pickActiveRoot } from "~/lib/knowledge-root";
import {
  useStartConceptJobMutation,
  useStartDiagramJobMutation,
} from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";

function conceptRowTitle(node: ConceptNode): string {
  return node.kind === "figure" ? `Figure · ${node.name}` : node.name;
}

function ConceptListPane({
  graph,
  selectedId,
  failedIds,
  citationsReport,
  onSelect,
  className,
}: {
  graph: ConceptGraph;
  selectedId: string;
  failedIds: Set<string>;
  citationsReport: ReturnType<typeof parseCitationsReport> | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Concepts"
      className={cn(
        "flex h-full min-h-0 w-index shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background px-2 py-2",
        className,
      )}
    >
      {graph.nodes.map((node) => {
        const unverified = failedIds.has(node.id);
        const reason = unverified
          ? citationsReport?.failures.find(
              (f) => f.path === "study/concepts.json" && f.id === node.id,
            )?.reason
          : undefined;
        return (
          <ListRow
            key={node.id}
            title={conceptRowTitle(node)}
            icon={node.kind === "figure" ? Image : undefined}
            leadingDashed={node.kind === "figure"}
            active={node.id === selectedId}
            className="w-full"
            trailing={
              unverified ? <StudyUnverifiedBadge reason={reason} /> : undefined
            }
            onSelect={() => onSelect(node.id)}
          />
        );
      })}
    </nav>
  );
}

function ConceptListShowButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      icon={ListCollapse}
      label="Concepts"
      size="icon-sm"
      variant="ghost"
      className="absolute left-3 top-3 z-floating"
      onClick={onClick}
    />
  );
}

export function GraphView({
  course,
  digests,
  conceptParam,
  onConceptParamSync,
}: {
  course: string;
  digests: DigestInfo[];
  conceptParam?: string;
  onConceptParamSync: (conceptId: string | undefined) => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const conceptsQuery = useStudyJson(activeRoot, course, "concepts.json");
  const citationsQuery = useStudyJson(activeRoot, course, "citations.json");
  const staleQuery = useStudyArtifactStale(activeRoot, course, "concepts");
  const startConceptJob = useStartConceptJobMutation(activeRoot);
  const startDiagramJob = useStartDiagramJobMutation(activeRoot);

  const conceptLauncher = useStudyJobLauncher(activeRoot, {
    mutateAsync: startConceptJob.mutateAsync,
    isPending: startConceptJob.isPending,
    startedMessage: (jobId) => `Concept job ${jobId} started.`,
    failedMessage: "Concept generation failed to start",
  });

  const diagramLauncher = useStudyJobLauncher(activeRoot, {
    mutateAsync: startDiagramJob.mutateAsync,
    isPending: startDiagramJob.isPending,
    startedMessage: (jobId) => `Diagram job ${jobId} started.`,
    failedMessage: "Diagram generation failed to start",
  });

  const mainRef = useRef<HTMLDivElement>(null);
  const narrow = useNotesMainNarrow(mainRef);
  const [listSheetOpen, setListSheetOpen] = useState(false);

  if (!narrow && listSheetOpen) {
    setListSheetOpen(false);
  }

  const queriesSettled =
    (conceptsQuery.isSuccess || conceptsQuery.isError) && !conceptsQuery.isFetching;

  let parsedGraph: ConceptGraph | null = null;
  let parseFailed = false;
  let courseMismatch = false;
  if (conceptsQuery.data != null) {
    try {
      const graph = parseConceptGraph(conceptsQuery.data);
      if (graph.course !== course) {
        courseMismatch = true;
      } else {
        parsedGraph = graph;
      }
    } catch {
      parseFailed = true;
    }
  }

  const graphMissing =
    queriesSettled &&
    (conceptsQuery.data == null || parseFailed || courseMismatch || parsedGraph === null);

  const citationsReport = (() => {
    if (!citationsQuery.isSuccess || citationsQuery.data == null) {
      return null;
    }
    try {
      return parseCitationsReport(citationsQuery.data);
    } catch {
      return null;
    }
  })();

  const failedIds = failedIdsFor(citationsReport, "study/concepts.json");

  let selectedId: string | null = null;
  let paramSync: string | undefined | null = null;
  if (parsedGraph) {
    const firstId = parsedGraph.nodes[0]?.id ?? null;
    if (conceptParam && parsedGraph.nodes.some((n) => n.id === conceptParam)) {
      selectedId = conceptParam;
    } else {
      selectedId = firstId;
      if (conceptParam !== undefined && conceptParam !== firstId) {
        paramSync = firstId ?? undefined;
      }
    }
  }

  useLayoutEffect(() => {
    if (paramSync !== null) {
      onConceptParamSync(paramSync);
    }
  }, [paramSync, onConceptParamSync]);

  const hasGraph = parsedGraph !== null && selectedId !== null && !graphMissing;

  const selectConceptFromPointer = useCallback(
    (id: string) => {
      void navigate({
        to: "/course/$course/graph",
        params: { course },
        search: { concept: id },
        replace: true,
      });
      if (narrow) {
        setListSheetOpen(false);
      }
    },
    [course, narrow, navigate],
  );

  const selectConceptFromKeyboard = useCallback(
    (id: string) => {
      void navigate({
        to: "/course/$course/graph",
        params: { course },
        search: { concept: id },
        replace: true,
      });
    },
    [course, navigate],
  );

  const parsedGraphRef = useRef(parsedGraph);
  const selectedIdRef = useRef(selectedId);
  const selectConceptFromKeyboardRef = useRef(selectConceptFromKeyboard);

  useLayoutEffect(() => {
    parsedGraphRef.current = parsedGraph;
    selectedIdRef.current = selectedId;
    selectConceptFromKeyboardRef.current = selectConceptFromKeyboard;
  }, [parsedGraph, selectedId, selectConceptFromKeyboard]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target) || isDialogOpen()) {
        return;
      }
      const graphAtKey = parsedGraphRef.current;
      const idAtKey = selectedIdRef.current;
      if (!graphAtKey || !idAtKey) {
        return;
      }
      const nodes = graphAtKey.nodes;
      const index = nodes.findIndex((n) => n.id === idAtKey);
      if (index < 0) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = nodes[index + 1];
        if (next) {
          selectConceptFromKeyboardRef.current(next.id);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = nodes[index - 1];
        if (prev) {
          selectConceptFromKeyboardRef.current(prev.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const displayName = courseDisplayName(course);
  const queriesLoading = conceptsQuery.data == null && !queriesSettled;

  const anyJobDisabled =
    conceptLauncher.jobDisabled || diagramLauncher.jobDisabled;
  const modelHint = conceptLauncher.modelHint ?? diagramLauncher.modelHint;

  const launchConceptJob = (force: boolean) => {
    diagramLauncher.clearModelHint();
    void conceptLauncher.launchStudyJob(course, force);
  };

  const launchDiagramJob = (force: boolean) => {
    conceptLauncher.clearModelHint();
    void diagramLauncher.launchStudyJob(course, force);
  };

  const listSheetVisible = narrow && listSheetOpen;
  const showInlineList = !narrow && parsedGraph;
  const showListButton = narrow && parsedGraph && !listSheetVisible;

  const graph = hasGraph ? parsedGraph : null;
  const selected =
    graph && selectedId
      ? (graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0])
      : null;
  const neighborList = graph && selected ? neighbors(graph, selected.id) : [];

  return (
    <div
      ref={mainRef}
      data-testid="graph-view"
      className={cn(
        "flex h-full min-h-0 flex-1 overflow-hidden",
        hasGraph && "@container/graph-main",
      )}
    >
      {queriesLoading ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-8">
          <Skeleton className="mb-4 h-8 w-full max-w-reading" />
          <Skeleton className="h-48 w-full max-w-reading" />
        </div>
      ) : null}
      {!queriesLoading && (graphMissing || !parsedGraph || !selectedId) ? (
        <div className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8">
          <EmptyState
            title="No concept graph yet"
            description={`No concept graph yet for ${displayName}. Generate concepts from your digests.`}
            actions={
              <div className="flex flex-col items-center gap-2">
                {modelHint ? (
                  <p className="text-sm text-muted-foreground">{modelHint}</p>
                ) : null}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    disabled={anyJobDisabled}
                    title={
                      conceptLauncher.viewerBlocked
                        ? conceptLauncher.viewerWriteReason
                        : undefined
                    }
                    onClick={() => launchConceptJob(false)}
                  >
                    Generate concepts
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={anyJobDisabled}
                    title={
                      diagramLauncher.viewerBlocked
                        ? diagramLauncher.viewerWriteReason
                        : undefined
                    }
                    onClick={() => launchDiagramJob(false)}
                  >
                    Generate diagrams
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      ) : null}
      {graph && selected ? (
        <>
      {showInlineList ? (
        <ConceptListPane
          graph={graph}
          selectedId={selected.id}
          failedIds={failedIds}
          citationsReport={citationsReport}
          onSelect={selectConceptFromPointer}
        />
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {showListButton ? (
          <ConceptListShowButton onClick={() => setListSheetOpen(true)} />
        ) : null}
        <div className="notes-reading-pane min-h-0 flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto w-full max-w-reading">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{graph.nodes.length} concepts</span>
              {staleQuery.data ? (
                <span className="inline-flex items-center gap-1 text-faint-foreground">
                  <RefreshCw className="size-icon-sm" aria-hidden />
                  Digests updated since last generation.
                </span>
              ) : null}
              <UnsavedBadge />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={anyJobDisabled}
                title={
                  conceptLauncher.viewerBlocked
                    ? conceptLauncher.viewerWriteReason
                    : undefined
                }
                onClick={() => launchConceptJob(true)}
              >
                <RefreshCw className="size-icon-sm" />
                Refresh concepts
              </Button>
              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={anyJobDisabled}
                  title={
                    diagramLauncher.viewerBlocked
                      ? diagramLauncher.viewerWriteReason
                      : undefined
                  }
                  onClick={() => launchDiagramJob(false)}
                >
                  Generate diagrams
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={anyJobDisabled}
                  title={
                    diagramLauncher.viewerBlocked
                      ? diagramLauncher.viewerWriteReason
                      : undefined
                  }
                  onClick={() => launchDiagramJob(true)}
                >
                  Refresh diagrams
                </Button>
              </span>
              {modelHint ? <span>{modelHint}</span> : null}
            </div>

            <h1 className="mb-4 font-serif text-3xl font-medium leading-tight">
              {conceptRowTitle(selected)}
            </h1>
            <p className="font-serif text-read text-muted-foreground">{selected.summary}</p>

            <SectionLabel className="mb-2 mt-8">Neighbors</SectionLabel>
            {neighborList.length === 0 ? (
              <p className="text-sm text-faint-foreground">No linked concepts.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {neighborList.map((neighbor, index) => (
                  <Chip
                    key={`${neighbor.id}-${neighbor.relation}-${index}`}
                    onClick={() => selectConceptFromPointer(neighbor.id)}
                  >
                    {neighbor.name} · {neighbor.relation}
                  </Chip>
                ))}
              </div>
            )}

            <SectionLabel className="mb-2 mt-8">Sources</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {selected.sources.map((source, index) => (
                <StudySourceChip
                  key={`${source.digest}-${source.heading ?? ""}-${index}`}
                  course={course}
                  source={source}
                  digests={digests}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
          {narrow ? (
            <Sheet open={listSheetVisible} onOpenChange={setListSheetOpen}>
              <SheetContent side="left" className="w-index p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Concepts</SheetTitle>
                  <SheetDescription>Concept list for this course.</SheetDescription>
                </SheetHeader>
                <ConceptListPane
                  graph={graph}
                  selectedId={selected.id}
                  failedIds={failedIds}
                  citationsReport={citationsReport}
                  onSelect={selectConceptFromPointer}
                  className="h-full w-full border-r-0"
                />
              </SheetContent>
            </Sheet>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
