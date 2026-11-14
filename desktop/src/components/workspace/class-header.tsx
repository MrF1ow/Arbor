import { X } from "lucide-react";

import { ClassTabs, PracticeTabs } from "~/components/workspace/class-tabs";
import type { WorkspaceLocation } from "~/components/workspace/workspace-mode";
import { courseDisplayName } from "~/domain/course";

/**
 * The full-width class header Practice and Ask use (they have no lecture column to carry the
 * title): the class title, Read / Practice / Map / Ask, and on Practice the Cards / Quiz sub-tabs
 * with the "Studying <scope> ×" chip.
 */
export function ClassHeader({
  course,
  location,
  readSlug,
  scope,
  onClearScope,
}: {
  course: string;
  location: WorkspaceLocation;
  readSlug: string | null;
  /** "Unit 2 · 3 lectures" while lectures are ticked. */
  scope: string | null;
  onClearScope: () => void;
}) {
  const practice = location.mode === "practice";
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
      <h1 className="min-w-0 truncate text-title text-foreground">{courseDisplayName(course)}</h1>
      <ClassTabs course={course} mode={location.mode} readSlug={readSlug} />
      {practice ? <PracticeTabs course={course} active={location.practiceTab} /> : null}
      <div className="flex-1" />
      {practice && scope ? (
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <span>Studying</span>
          <button
            type="button"
            aria-label={`Stop studying ${scope}`}
            onClick={onClearScope}
            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent px-2.5 text-caption text-accent-foreground transition-colors duration-fast ease-out-soft hover:bg-selected"
          >
            <span>{scope}</span>
            <X className="size-icon-sm" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
