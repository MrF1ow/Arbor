export type LibraryRole = "owner" | "editor" | "viewer";
export type ProviderSource = "override" | "library" | "settings";

export const VIEWER_WRITE_REASON =
  "Viewers cannot run write jobs or push. Your role on this library is viewer. " +
  "An owner can change it in Settings → Library. " +
  "Arbor's check is advisory; the git host's permissions are what actually enforce access.";

export const LIBRARY_RECOMMENDATION_LABEL = "recommended by library";

export function viewerBlocksWrite(role: LibraryRole | null): boolean {
  return role === "viewer";
}

export function skillHasWritePermission(permissions: string[]): boolean {
  return permissions.some(
    (p) => p === "write_course_study" || p === "write_export_dir",
  );
}

export function upsertProviderOverride(
  overrides: { path: string; provider_id: string; model_id: string | null }[],
  path: string,
  provider_id: string,
  model_id: string | null,
): { path: string; provider_id: string; model_id: string | null }[] {
  return [...overrides.filter((o) => o.path !== path), { path, provider_id, model_id }];
}

export function effectiveProvider(input: {
  root: string | null;
  settingsProviderId: string;
  settingsModelId: string | null;
  overrides: { path: string; provider_id: string; model_id: string | null }[];
  libraryProvider: { id: string; model: string } | null;
}): { providerId: string; modelId: string | null; source: ProviderSource } {
  const { root, settingsProviderId, settingsModelId, overrides, libraryProvider } = input;
  if (root) {
    const override = overrides.find((o) => o.path === root);
    if (override) {
      return {
        providerId: override.provider_id,
        modelId: override.model_id,
        source: "override",
      };
    }
  }
  if (libraryProvider) {
    return {
      providerId: libraryProvider.id,
      modelId: libraryProvider.model,
      source: "library",
    };
  }
  return {
    providerId: settingsProviderId,
    modelId: settingsModelId,
    source: "settings",
  };
}
