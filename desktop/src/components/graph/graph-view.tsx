import { useNavigate } from "@tanstack/react-router";
import { ImagePlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Chip } from "~/components/app/chip";
import { EmptyState } from "~/components/app/empty-state";
import { UnsavedBadge } from "~/components/app/unsaved-badge";
import { GraphCanvas } from "~/components/graph/graph-canvas";
import { inScope } from "~/components/study/study-scope";
import { StudyUnverifiedBadge } from "~/components/study/study-unverified-badge";
import { useStudyScope } from "~/components/study/use-study-scope";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { PreviewBarRight } from "~/components/workspace/preview-bar";
import { failedIdsFor, parseCitationsReport } from "~/domain/citations";
import { courseDisplayName } from "~/domain/course";
import { digestKey, neighbors, parseConceptGraph } from "~/domain/concepts";
import { formatStudySourceLabel, resolveDigestSlug } from "~/domain/notes";
import type { ConceptGraph, ConceptNode, ConceptSource, DigestInfo } from "~/domain/types";
import { useStudyJobLauncher } from "~/hooks/use-study-job-launcher";
import { classPath } from "~/lib/class-path";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useStartConceptJobMutation, useStartDiagramJobMutation } from "~/lib/queries/jobs";
import { useSettings } from "~/lib/queries/settings";
import { useStudyArtifactStale, useStudyJson } from "~/lib/queries/study";
import { isDialogOpen, isEditableTarget } from "~/lib/shortcuts";

function conceptRowTitle(node: ConceptNode): string {
  return node.kind === "figure" ? `Figure · ${node.name}` : node.name;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "14 concepts · 21 links · from 13 digests": the totals stay put while lectures are ticked. */
function summaryLine(graph: ConceptGraph): string {
  const digests = new Set(graph.nodes.flatMap((node) => node.sources.map((s) => digestKey(s.digest))));
  return [
    plural(graph.nodes.length, "concept", "concepts"),
    plural(graph.edges.length, "link", "links"),
    `from ${plural(digests.size, "digest", "digests")}`,
  ].join(" · ");
}

/** "11 of 14 concepts in the 3 selected lectures": the legend of the highlighted pills. */
function scopeLine(graph: ConceptGraph, litCount: number, scopeSize: number): string {
  return `${litCount} of ${graph.nodes.length} concepts in the ${
    scopeSize === 1 ? "selected lecture" : `${scopeSize} selected lectures`
  }`;
}

const PANEL = "flex flex-col gap-2 rounded-lg border border-border bg-card p-4";
const PANEL_LABEL = "text-label text-faint-foreground";

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
  const scope = useStudyScope(course);
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

  const queriesSettled =
    (conceptsQuery.isSuccess || conceptsQuery.isError) && !conceptsQuery.isFetching;

  // Parsed once per payload: a new object on every render would lay the map out again on each click.
  const { parsedGraph, parseFailed, courseMismatch } = useMemo(() => {
    if (conceptsQuery.data == null) {
      return { parsedGraph: null, parseFailed: false, courseMismatch: false };
    }
    try {
      const graph = parseConceptGraph(conceptsQuery.data);
      return graph.course !== course
        ? { parsedGraph: null, parseFailed: false, courseMismatch: true }
        : { parsedGraph: graph, parseFailed: false, courseMismatch: false };
    } catch {
      return { parsedGraph: null, parseFailed: true, courseMismatch: false };
    }
  }, [conceptsQuery.data, course]);

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

  const selectConcept = useCallback(
    (id: string) => {
      void navigate({ ...classPath(course, "map"), search: { concept: id }, replace: true });
    },
    [course, navigate],
  );

  const parsedGraphRef = useRef(parsedGraph);
  const selectedIdRef = useRef(selectedId);
  const selectConceptRef = useRef(selectConcept);

  useLayoutEffect(() => {
    parsedGraphRef.current = parsedGraph;
    selectedIdRef.current = selectedId;
    selectConceptRef.current = selectConcept;
  }, [parsedGraph, selectedId, selectConcept]);

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
          selectConceptRef.current(next.id);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = nodes[index - 1];
        if (prev) {
          selectConceptRef.current(prev.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const graph = hasGraph ? parsedGraph : null;
  const canvasNodes = useMemo(
    () =>
      (graph?.nodes ?? []).map((node) => ({
        id: node.id,
        label: conceptRowTitle(node),
        figure: node.kind === "figure",
      })),
    [graph],
  );

  // Show on map: the concepts that cite a ticked lecture.
  const lit = useMemo(() => {
    if (!graph || scope.digests.length === 0) {
      return null;
    }
    return new Set(
      graph.nodes
        .filter((node) => node.sources.some((source) => inScope(course, source.digest, scope.digests)))
        .map((node) => node.id),
    );
  }, [course, graph, scope.digests]);

  const displayName = courseDisplayName(course);
  const queriesLoading = conceptsQuery.data == null && !queriesSettled;

  const anyJobDisabled = conceptLauncher.jobDisabled || diagramLauncher.jobDisabled;
  const modelHint = conceptLauncher.modelHint ?? diagramLauncher.modelHint;

  const launchConceptJob = (force: boolean) => {
    diagramLauncher.clearModelHint();
    void conceptLauncher.launchStudyJob(course, force);
  };

  const launchDiagramJob = (force: boolean) => {
    conceptLauncher.clearModelHint();
    void diagramLauncher.launchStudyJob(course, force);
  };

  const selected =
    graph && selectedId ? (graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0]) : null;
  const neighborList = graph && selected ? neighbors(graph, selected.id) : [];

  const openSource = (source: ConceptSource) => {
    void navigate({
      ...classPath(course, "read", resolveDigestSlug(source.digest, digests)),
      search: source.heading ? { heading: source.heading } : {},
    });
  };

  return (
    <div
      data-testid="graph-view"
      className="@container/graph-main flex h-full min-h-0 flex-1 flex-col"
    >
      {queriesLoading ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-10 py-6">
          <Skeleton className="mb-4 h-8 w-full max-w-reading" />
          <Skeleton className="h-48 w-full max-w-reading" />
        </div>
      ) : null}
      {!queriesLoading && (graphMissing || !parsedGraph || !selectedId) ? (
        <div className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-10 py-6">
          <EmptyState
            title="No concept graph yet"
            description={`No concept graph yet for ${displayName}. Generate concepts from your digests.`}
            actions={
              <div className="flex flex-col items-center gap-2">
                {modelHint ? <p className="text-sm text-muted-foreground">{modelHint}</p> : null}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    disabled={anyJobDisabled}
                    title={
                      conceptLauncher.viewerBlocked ? conceptLauncher.viewerWriteReason : undefined
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
                      diagramLauncher.viewerBlocked ? diagramLauncher.viewerWriteReason : undefined
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
          <PreviewBarRight>{summaryLine(graph)}</PreviewBarRight>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-6 @3xl/graph-main:flex-row @3xl/graph-main:overflow-hidden @3xl/graph-main:px-10 @3xl/graph-main:pb-4">
            <GraphCanvas
              nodes={canvasNodes}
              edges={graph.edges}
              selectedId={selected.id}
              highlighted={lit}
              legend={lit ? scopeLine(graph, lit.size, scope.digests.length) : undefined}
              onSelect={selectConcept}
            />
            <div className="flex w-full shrink-0 flex-col gap-4 @3xl/graph-main:min-h-0 @3xl/graph-main:w-65 @3xl/graph-main:overflow-y-auto">
              <section aria-label="Concept" className={PANEL}>
                <span className={PANEL_LABEL}>Concept</span>
                <h2 className="font-serif text-heading text-foreground">{conceptRowTitle(selected)}</h2>
                <p className="text-small text-muted-foreground">{selected.summary}</p>
                {failedIds.has(selected.id) ? (
                  <div>
                    <StudyUnverifiedBadge
                      reason={
                        citationsReport?.failures.find(
                          (f) => f.path === "study/concepts.json" && f.id === selected.id,
                        )?.reason
                      }
                    />
                  </div>
                ) : null}
              </section>

              <section aria-label="Neighbors" className={PANEL}>
                <span className={PANEL_LABEL}>Neighbors</span>
                {neighborList.length === 0 ? (
                  <p className="text-small text-faint-foreground">No linked concepts.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {neighborList.map((neighbor, index) => (
                      <li key={`${neighbor.id}-${neighbor.relation}-${index}`}>
                        <button
                          type="button"
                          onClick={() => selectConcept(neighbor.id)}
                          className="flex w-full items-center gap-2 rounded-sm py-0.5 text-left text-small text-foreground transition-colors duration-fast ease-out-soft hover:text-primary"
                        >
                          <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                          <span className="min-w-0 flex-1 truncate">{neighbor.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label="Sources" className={PANEL}>
                <span className={PANEL_LABEL}>Sources</span>
                {selected.sources.length === 0 ? (
                  <p className="text-small text-faint-foreground">No sources.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {selected.sources.map((source, index) => (
                      <li
                        key={`${source.digest}-${source.heading ?? ""}-${index}`}
                        className="flex items-center justify-between gap-2 text-small text-foreground"
                      >
                        <span className="min-w-0 truncate">
                          {formatStudySourceLabel({ digest: source.digest }, digests)}
                        </span>
                        <Chip variant="plain" className="h-auto shrink-0 border-info px-1 text-micro text-info hover:bg-muted" onClick={() => openSource(source)}>
                          {source.heading ?? "Open"}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
                {selected.sources[0] ? (
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => openSource(selected.sources[0]!)}>
                      Read in digest
                    </Button>
                  </div>
                ) : null}
              </section>

              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
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
                  title={conceptLauncher.viewerBlocked ? conceptLauncher.viewerWriteReason : undefined}
                  onClick={() => launchConceptJob(true)}
                >
                  <RefreshCw className="size-icon-sm" aria-hidden />
                  Refresh concepts
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={anyJobDisabled}
                  title={diagramLauncher.viewerBlocked ? diagramLauncher.viewerWriteReason : undefined}
                  onClick={() => launchDiagramJob(false)}
                >
                  <ImagePlus className="size-icon-sm" aria-hidden />
                  Generate diagrams
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={anyJobDisabled}
                  title={diagramLauncher.viewerBlocked ? diagramLauncher.viewerWriteReason : undefined}
                  onClick={() => launchDiagramJob(true)}
                >
                  <RefreshCw className="size-icon-sm" aria-hidden />
                  Refresh diagrams
                </Button>
                {modelHint ? <span>{modelHint}</span> : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
