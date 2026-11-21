import { useQueries } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CourseSwatch } from "~/components/app/course-swatch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Kbd } from "~/components/ui/kbd";
import { Spinner } from "~/components/ui/spinner";
import { courseDisplayName } from "~/domain/course";
import { resolveDigestSlug } from "~/domain/notes";
import { resolveSearchHitNavigation } from "~/domain/search-hit";
import type { SearchHit } from "~/domain/types";
import { invoke } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useOpenClass, type OpenClassSearch, type OpenClassTarget } from "~/lib/open-class";
import { useCourseMeta } from "~/lib/queries/course-meta";
import { qk } from "~/lib/queries/keys";
import { useSettings } from "~/lib/queries/settings";
import { modShortcut } from "~/lib/shortcuts";

const DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

/** What the search commands return: a `SearchHit`, plus the card, question or concept id for study rows. */
export type PaletteHit = SearchHit & { item_id?: string | null };

/** A hit and the library it came from: the palette searches every library. */
export type RootHit = { root: string; hit: PaletteHit };

type GroupKey = "digests" | "cards" | "concepts" | "overview";

const GROUPS: { key: GroupKey; heading: string }[] = [
  { key: "digests", heading: "Digests" },
  { key: "cards", heading: "Cards" },
  { key: "concepts", heading: "Concepts" },
  { key: "overview", heading: "Overview" },
];

function groupKeyOf(kind: string): GroupKey {
  switch (kind) {
    case "digest":
      return "digests";
    case "card":
    case "question":
      return "cards";
    case "concept":
      return "concepts";
    default:
      return "overview";
  }
}

/** Hits under Digests, Cards, Concepts and (class overview, plan, anything else) Overview, in that order. */
export function groupRootHits(hits: RootHit[]) {
  return GROUPS.map(({ key, heading }) => ({
    key,
    heading,
    hits: hits.filter((entry) => groupKeyOf(entry.hit.kind) === key),
  })).filter((group) => group.hits.length > 0);
}

/** "4 results in 2 classes": a class is one class of one library. */
export function resultCountLabel(hits: RootHit[]): string {
  const classes = new Set(hits.map(({ root, hit }) => `${root}\u0000${hit.course}`)).size;
  const results = `${hits.length} ${hits.length === 1 ? "result" : "results"}`;
  return `${results} in ${classes} ${classes === 1 ? "class" : "classes"}`;
}

const KIND_WORD: Record<string, string> = {
  card: "card",
  question: "question",
  concept: "concept",
  plan: "plan",
  course_md: "overview",
};

function hitMeta(hit: PaletteHit): string {
  const name = courseDisplayName(hit.course);
  if (hit.kind === "digest") {
    return name;
  }
  return `${name} · ${KIND_WORD[hit.kind] ?? hit.kind}`;
}

function hitValue({ root, hit }: RootHit, index: number): string {
  return `${root}:${hit.course}:${hit.path}:${hit.kind}:${index}`;
}

function RootSwatch({ root, course }: { root: string; course: string }) {
  const meta = useCourseMeta(root);
  return <CourseSwatch meta={meta.data} course={course} className="mt-1.5" />;
}

function SearchHitRow({ entry }: { entry: RootHit }) {
  const { root, hit } = entry;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-start gap-2">
        <RootSwatch root={root} course={hit.course} />
        <span className="min-w-0 flex-1 truncate text-small font-semibold">{hit.title}</span>
        <span className="shrink-0 text-caption text-faint-foreground">{hitMeta(hit)}</span>
      </div>
      <span className="line-clamp-2 pl-4.5 text-caption text-muted-foreground">{hit.snippet}</span>
    </div>
  );
}

/** The phrase the full-text search looks for: quotes dropped, whitespace collapsed (as the Rust side does). */
function searchPhrase(query: string): string {
  return query.replaceAll('"', "").split(/\s+/).filter(Boolean).join(" ");
}

/** One search per library, in parallel; the active library's hits come first. */
function useSearchAll(roots: string[], query: string) {
  const trimmed = query.trim();
  const results = useQueries({
    queries: roots.map((root) => ({
      queryKey: qk.search(root, trimmed),
      enabled: trimmed.length > 0,
      queryFn: () =>
        invoke<PaletteHit[]>("search_knowledge", {
          root,
          query: trimmed,
          limit: SEARCH_LIMIT,
        }),
    })),
  });
  const hits: RootHit[] = results.flatMap((result, index) =>
    (result.data ?? []).map((hit) => ({ root: roots[index]!, hit })),
  );
  const failed = results.find((result) => result.isError);
  const failedRoots = roots.filter((_, index) => results[index]?.isError);
  return {
    hits,
    failedRoots,
    isLoading: trimmed.length > 0 && results.some((result) => result.isLoading),
    error: failed?.error ?? null,
    settled: trimmed.length > 0 && results.every((result) => !result.isLoading),
  };
}

function SearchPaletteBody({
  open,
  onOpenChange,
  query,
  setQuery,
  debouncedQuery,
  setDebouncedQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  setDebouncedQuery: (query: string) => void;
}) {
  const settings = useSettings();
  const openClass = useOpenClass();
  const activeRoot = pickActiveRoot(settings.data);

  const configured = (settings.data?.knowledge_roots ?? []).map((entry) => entry.path);
  const roots = activeRoot
    ? [activeRoot, ...configured.filter((root) => root !== activeRoot)]
    : configured;

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open, setDebouncedQuery]);

  const search = useSearchAll(roots, debouncedQuery);
  const { hits } = search;
  const groups = groupRootHits(hits);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const openHit = ({ root, hit }: RootHit) => {
    onOpenChange(false);
    let to: OpenClassTarget;
    let searchParams: OpenClassSearch | undefined;
    let notice: string | null = null;
    switch (hit.kind) {
      case "card":
        to = "cards";
        searchParams = hit.item_id ? { card: hit.item_id } : undefined;
        break;
      case "question":
        // The quiz route takes no question param, so the hit opens the quiz tab.
        to = "quiz";
        break;
      case "concept":
        to = "map";
        searchParams = hit.item_id ? { concept: hit.item_id } : undefined;
        break;
      default: {
        const navigation = resolveSearchHitNavigation(hit);
        if (navigation.kind === "digest") {
          to = { tab: "read", digest: resolveDigestSlug(navigation.digestRef, []) };
        } else {
          to = "overview";
          if (navigation.kind === "plan") {
            // The overview route reads `heading` to scroll to the plan.
            searchParams = { heading: "Study plan" };
          }
          if (navigation.kind === "overview_with_toast") {
            notice = `Opened ${courseDisplayName(hit.course)}`;
          }
        }
      }
    }
    void openClass(root, hit.course, to, searchParams).then(() => {
      if (notice) {
        toast.info(notice);
      }
    });
  };

  const hasRoot = roots.length > 0;
  const typed = debouncedQuery.trim().length > 0;
  const showEmptyHint = hasRoot && !typed;
  const showLoading = hasRoot && typed && hits.length === 0 && search.isLoading;
  const showError = hasRoot && typed && hits.length === 0 && !search.isLoading && search.error !== null;
  const showNoResults = hasRoot && typed && hits.length === 0 && search.settled && search.error === null;

  const failedLibraries = search.failedRoots.map((root) => {
    const entry = settings.data?.knowledge_roots.find((candidate) => candidate.path === root);
    return entry?.name || root.split("/").filter(Boolean).pop() || root;
  });
  const showFailedNotice = typed && hits.length > 0 && failedLibraries.length > 0;

  const phrase = searchPhrase(debouncedQuery);
  const phraseMissed = phrase.includes(" ");

  const ordered = groups.flatMap((group) => group.hits);

  return (
    <CommandPrimitive
      shouldFilter={false}
      className="flex min-w-0 flex-col text-popover-foreground"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.25">
        <Search className="size-icon-sm shrink-0 text-faint-foreground" aria-hidden />
        <CommandPrimitive.Input
          ref={inputRef}
          placeholder="Search notes, concepts, and cards in every class"
          value={query}
          onValueChange={setQuery}
          aria-label="Search digests"
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-hidden placeholder:text-muted-foreground"
        />
        <Kbd className="border-border bg-background text-kbd">{modShortcut("K")}</Kbd>
      </div>
      <CommandPrimitive.List data-slot="command-list" className="max-h-80 overflow-x-hidden overflow-y-auto p-2 outline-none">
        {!hasRoot ? (
          <p className="py-6 text-center text-caption text-muted-foreground">Choose a Knowledge folder first.</p>
        ) : null}
        {showEmptyHint ? (
          <p className="py-6 text-center text-caption text-muted-foreground">Type to search every class</p>
        ) : null}
        {showLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-caption text-muted-foreground">
            <Spinner className="size-icon-sm" />
            Searching…
          </div>
        ) : null}
        {showError ? (
          <p className="px-3 py-6 text-center text-caption text-destructive">
            {search.error instanceof Error ? search.error.message : String(search.error)}
          </p>
        ) : null}
        {showNoResults && phraseMissed ? (
          <div className="flex flex-col gap-1 px-3 py-6 text-center text-caption text-muted-foreground">
            <p className="break-words">{`No notes contain "${phrase}"`}</p>
            <p>Ask your class a question instead.</p>
          </div>
        ) : null}
        {showNoResults && !phraseMissed ? (
          <p className="py-6 text-center text-caption text-muted-foreground">No results</p>
        ) : null}
        {showFailedNotice ? (
          <p role="status" className="px-3 py-1.5 text-caption text-muted-foreground">
            Couldn&apos;t search {failedLibraries.join(", ")}
          </p>
        ) : null}
        {groups.map((group) => (
          <CommandPrimitive.Group
            key={group.key}
            heading={group.heading}
            className="pb-2 **:[[cmdk-group-heading]]:px-0.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-label **:[[cmdk-group-heading]]:text-faint-foreground"
          >
            {group.hits.map((entry) => {
              const value = hitValue(entry, ordered.indexOf(entry));
              return (
                <CommandPrimitive.Item
                  key={value}
                  value={value}
                  onSelect={() => openHit(entry)}
                  className="flex cursor-default flex-col rounded-md px-2.5 py-2 outline-hidden select-none data-[selected=true]:bg-selected"
                >
                  <SearchHitRow entry={entry} />
                </CommandPrimitive.Item>
              );
            })}
          </CommandPrimitive.Group>
        ))}
      </CommandPrimitive.List>
      <div className="flex items-center gap-1 border-t border-border px-4 py-2.25 text-caption text-faint-foreground">
        <ArrowUp className="size-3" aria-hidden />
        <ArrowDown className="size-3" aria-hidden />
        <span>move · Enter opens</span>
        <span className="ml-auto">{hits.length > 0 ? resultCountLabel(hits) : null}</span>
      </div>
    </CommandPrimitive>
  );
}

export function SearchPalette({
  open,
  onOpenChange,
  rootKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootKey: string;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remount search state when the knowledge root changes
    setQuery("");
    setDebouncedQuery("");
  }, [rootKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-palette-top max-w-reading translate-y-0 gap-0 overflow-hidden rounded-xl p-0 shadow-popover"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Search notes, concepts, and cards in every class</DialogDescription>
        </DialogHeader>
        <SearchPaletteBody
          open={open}
          onOpenChange={onOpenChange}
          query={query}
          setQuery={setQuery}
          debouncedQuery={debouncedQuery}
          setDebouncedQuery={setDebouncedQuery}
        />
      </DialogContent>
    </Dialog>
  );
}
