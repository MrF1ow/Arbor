import type { Settings } from "~/domain/types";

export function pickActiveRoot(settings: Settings | undefined): string | null {
  if (!settings) {
    return null;
  }
  return (
    settings.active_root ??
    settings.knowledge_root ??
    settings.knowledge_roots?.[0]?.path ??
    null
  );
}

export function hasAnyKnowledgeRoot(settings: Settings | undefined): boolean {
  if (!settings) {
    return false;
  }
  if (settings.knowledge_roots?.length) {
    return true;
  }
  return Boolean(settings.knowledge_root ?? settings.active_root);
}
