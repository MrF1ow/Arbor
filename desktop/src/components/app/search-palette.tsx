import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { courseDisplayName } from "~/domain/course";
import { resolveDigestSlug } from "~/domain/notes";
import {
  groupSearchHitsByCourse,
  resolveSearchHitNavigation,
  searchHitItemValue,
  searchHitMeta,
} from "~/domain/search-hit";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useSearch, useSemanticSearch } from "~/lib/queries/search";
import { useSettings } from "~/lib/queries/settings";
import { cn } from "~/lib/utils";
import { useUiStore } from "~/stores/ui-store";

const DEBOUNCE_MS = 250;

function SearchHitRow({ hit }: { hit: import("~/domain/types").SearchHit }) {
  const showKindBadge = hit.kind !== "digest";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium">{hit.title}</span>
        {showKindBadge ? (
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-2xs capitalize">
            {hit.kind}
          </Badge>
        ) : null}
      </div>
      <span className="text-2xs text-faint-foreground">{searchHitMeta(hit)}</span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</span>
    </div>
  );
}

function SearchPaletteBody({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const searchSemantic = useUiStore((s) => s.searchSemantic);
  const setSearchSemantic = useUiStore((s) => s.setSearchSemantic);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset palette text when closed or the root changes
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open, activeRoot]);

  const textSearch = useSearch(activeRoot, searchSemantic ? "" : debouncedQuery);
  const semanticSearch = useSemanticSearch(activeRoot, searchSemantic ? debouncedQuery : "");
  const active = searchSemantic ? semanticSearch : textSearch;
  const hits = active.data ?? [];
  const grouped = groupSearchHitsByCourse(hits);
  const multiCourse = grouped.length > 1;

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
  }, [open, activeRoot]);

  const openHit = (hit: import("~/domain/types").SearchHit) => {
    onOpenChange(false);
    const navigation = resolveSearchHitNavigation(hit);
    switch (navigation.kind) {
      case "digest": {
        const slug = resolveDigestSlug(navigation.digestRef, []);
        void navigate({
          to: "/course/$course/notes/$digest",
          params: { course: navigation.course, digest: slug },
        });
        break;
      }
      case "overview":
        void navigate({ to: "/course/$course/notes", params: { course: navigation.course } });
        break;
      case "plan":
        void navigate({
          to: "/course/$course/notes",
          params: { course: navigation.course },
          search: { heading: "Study plan" },
        });
        break;
      case "overview_with_toast":
        void navigate({ to: "/course/$course/notes", params: { course: navigation.course } });
        toast.info(`Opened ${courseDisplayName(navigation.course)}`);
        break;
    }
  };

  const showEmptyHint = Boolean(activeRoot) && !debouncedQuery.trim();
  const showNoResults =
    Boolean(activeRoot) &&
    debouncedQuery.trim().length > 0 &&
    !active.isLoading &&
    !active.isError &&
    hits.length === 0;
  const showLoading = Boolean(activeRoot) && debouncedQuery.trim().length > 0 && active.isLoading;
  const showError = Boolean(activeRoot) && active.isError;

  const renderHits = (list: import("~/domain/types").SearchHit[]) =>
    list.map((hit) => (
      <CommandItem
        key={searchHitItemValue(hit)}
        value={searchHitItemValue(hit)}
        className="min-h-0 items-start py-2"
        onSelect={() => openHit(hit)}
      >
        <SearchHitRow hit={hit} />
      </CommandItem>
    ));

  return (
    <Command shouldFilter={false}>
      <div className="flex items-center gap-2 border-b border-border p-1 pb-0">
        <div className="min-w-0 flex-1">
          <CommandInput
            ref={inputRef}
            placeholder="Search digests…"
            value={query}
            onValueChange={setQuery}
            aria-label="Search digests"
          />
        </div>
        <Label className="flex shrink-0 items-center gap-1.5 pr-2 text-2xs text-muted-foreground">
          <span>Semantic</span>
          <Switch
            checked={searchSemantic}
            onCheckedChange={setSearchSemantic}
            aria-label="Semantic search"
          />
        </Label>
      </div>
      <CommandList>
        {!activeRoot ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Choose a Knowledge folder first.
          </p>
        ) : null}
        {showEmptyHint ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Type to search digests</p>
        ) : null}
        {showLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-icon-sm" />
            Searching…
          </div>
        ) : null}
        {showError ? (
          <p className="px-3 py-6 text-center text-xs text-destructive">
            {active.error instanceof Error ? active.error.message : String(active.error)}
          </p>
        ) : null}
        {showNoResults ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No results</p>
        ) : null}
        {hits.length > 0 && !multiCourse
          ? renderHits(hits)
          : null}
        {hits.length > 0 && multiCourse
          ? grouped.map(([course, courseHits]) => (
              <CommandGroup key={course} heading={courseDisplayName(course)}>
                {renderHits(courseHits)}
              </CommandGroup>
            ))
          : null}
      </CommandList>
    </Command>
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
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search knowledge digests"
      className={cn("max-w-reading")}
      showCloseButton={false}
    >
      <SearchPaletteBody key={rootKey} open={open} onOpenChange={onOpenChange} />
    </CommandDialog>
  );
}
