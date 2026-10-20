import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { Chip } from "~/components/app/chip";
import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  permissionsConfirmed,
  upsertSkillGrant,
  removeSkillGrantsForId,
} from "~/domain/skill-permissions";
import {
  skillHasWritePermission,
  VIEWER_WRITE_REASON,
  viewerBlocksWrite,
} from "~/domain/library-role";
import type { SkillIndexPackage } from "~/domain/types";
import { openDialog } from "~/lib/ipc";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { useLibrary } from "~/lib/queries/library";
import { usePersistSettingsMutation, useSettings } from "~/lib/queries/settings";
import {
  useSkillIndex,
  useSkillInstallMutation,
  useSkillRunMutation,
  useSkillUninstallMutation,
} from "~/lib/queries/skills";
import { useUiStore } from "~/stores/ui-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";

const SkillPermissionsDialog = lazy(() =>
  import("~/components/settings/skill-permissions-dialog").then((m) => ({
    default: m.SkillPermissionsDialog,
  })),
);

export function SettingsSkillsPanel() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const libraryRole = library.data?.present === true ? library.data.role : null;
  const persistSettings = usePersistSettingsMutation();
  const skillIndex = useSkillIndex();
  const installSkill = useSkillInstallMutation();
  const runSkill = useSkillRunMutation();
  const uninstallSkill = useSkillUninstallMutation();

  const [indexSource, setIndexSource] = useState("");
  const [indexRef, setIndexRef] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [browsePackages, setBrowsePackages] = useState<SkillIndexPackage[]>([]);
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<SkillIndexPackage | null>(null);
  const [permAction, setPermAction] = useState<"install" | "run">("install");
  const [uninstallTarget, setUninstallTarget] = useState<SkillIndexPackage | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror saved index settings into inputs
    setIndexSource(settings.data?.skill_index_source?.trim() ?? "");
    setIndexRef(settings.data?.skill_index_ref?.trim() ?? "");
  }, [settings.data?.skill_index_ref, settings.data?.skill_index_source]);

  const grants = settings.data?.skill_grants ?? [];

  const refreshBrowsePackages = async () => {
    const result = await skillIndex.refetch();
    if (result.isError) {
      return;
    }
    setBrowsePackages(result.data?.packages ?? []);
  };

  const onSaveIndex = async () => {
    try {
      await persistSettings.mutateAsync((current) => ({
        ...current,
        skill_index_source: indexSource.trim(),
        skill_index_ref: indexRef.trim(),
      }));
      setStatusLine("Index settings saved.");
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onBrowse = async () => {
    setStatusLine("");
    const result = await skillIndex.refetch();
    if (result.isError) {
      setBrowsePackages([]);
      const message = String(result.error);
      setStatusLine(message);
      toast.error(message);
      return;
    }
    setBrowsePackages(result.data?.packages ?? []);
  };

  const ensurePermissions = (pkg: SkillIndexPackage, action: "install" | "run") => {
    if (permissionsConfirmed(grants, pkg)) {
      return true;
    }
    setPermTarget(pkg);
    setPermAction(action);
    setPermDialogOpen(true);
    return false;
  };

  const onAcceptPermissions = async () => {
    if (!permTarget) {
      return;
    }
    try {
      await persistSettings.mutateAsync((current) => ({
        ...current,
        skill_grants: upsertSkillGrant(current.skill_grants ?? [], permTarget),
      }));
      setPermDialogOpen(false);
      if (permAction === "install") {
        await onInstall(permTarget, true);
      } else {
        await onRun(permTarget, true);
      }
    } catch (error) {
      toast.error(String(error));
    }
  };

  const onInstall = async (pkg: SkillIndexPackage, skipPermCheck = false) => {
    if (pkg.kind !== "skill") {
      return;
    }
    if (!skipPermCheck && !ensurePermissions(pkg, "install")) {
      return;
    }
    try {
      const result = await installSkill.mutateAsync(pkg.id);
      setStatusLine(`Installed ${result.commit}`);
      await refreshBrowsePackages();
    } catch (error) {
      setStatusLine(String(error));
      toast.error(String(error));
    }
  };

  const viewerBlocksSkillRun = (pkg: SkillIndexPackage) =>
    viewerBlocksWrite(libraryRole) && skillHasWritePermission(pkg.permissions);

  const onRun = async (pkg: SkillIndexPackage, skipPermCheck = false) => {
    const root = pickActiveRoot(settings.data);
    if (!root) {
      setStatusLine("Choose a knowledge folder first");
      return;
    }
    const lastCourse = useUiStore.getState().lastCourse;
    const course =
      lastCourse && lastCourse.root === root ? lastCourse.course : null;
    if (!course) {
      setStatusLine("Choose a course first");
      return;
    }
    if (viewerBlocksSkillRun(pkg)) {
      setStatusLine(VIEWER_WRITE_REASON);
      return;
    }
    if (!skipPermCheck && !ensurePermissions(pkg, "run")) {
      return;
    }
    const exportDir = await openDialog({ directory: true, multiple: false });
    if (typeof exportDir !== "string") {
      return;
    }
    try {
      await runSkill.mutateAsync({
        root,
        id: pkg.id,
        commit: pkg.commit,
        course,
        exportDir,
        confirmed: true,
      });
      setStatusLine("Skill run started.");
    } catch (error) {
      setStatusLine(String(error));
      toast.error(String(error));
    }
  };

  const onUninstall = async (pkg: SkillIndexPackage) => {
    try {
      await uninstallSkill.mutateAsync(pkg.id);
      await persistSettings.mutateAsync((current) => ({
        ...current,
        skill_grants: removeSkillGrantsForId(current.skill_grants ?? [], pkg.id),
      }));
      setStatusLine("Uninstalled");
      setUninstallTarget(null);
      await refreshBrowsePackages();
    } catch (error) {
      setStatusLine(String(error));
      toast.error(String(error));
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-skills">
      <SettingsSection title="Skills">
        <SettingRow
          label="Index source"
          control={
            <Input
              aria-label="Index source"
              value={indexSource}
              onChange={(e) => setIndexSource(e.target.value)}
              placeholder="Default: marketplace/index.json in this repo"
              className="w-64"
              autoComplete="off"
              spellCheck={false}
            />
          }
        />
        <SettingRow
          label="Index ref"
          control={
            <Input
              aria-label="Index ref"
              value={indexRef}
              onChange={(e) => setIndexRef(e.target.value)}
              placeholder="Branch, tag, or commit"
              className="w-44"
              autoComplete="off"
              spellCheck={false}
            />
          }
        />
        <SettingRow
          label="Marketplace"
          control={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void onSaveIndex()}>
                Save index
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void onBrowse()}>
                Browse index
              </Button>
            </div>
          }
        />
        {statusLine ? (
          <p className="px-4 pb-3 text-sm text-muted-foreground" data-testid="skill-status">
            {statusLine}
          </p>
        ) : null}
      </SettingsSection>

      {browsePackages.length > 0 ? (
        <SettingsSection title="Packages">
          {browsePackages.map((pkg) => {
            const runBlocked = viewerBlocksSkillRun(pkg);
            return (
              <div
                key={`${pkg.id}-${pkg.commit}`}
                className="space-y-2 border-t border-border px-4 py-3 first:border-t-0"
              >
                <div>
                  <h3 className="text-sm font-medium">{pkg.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {pkg.description} · id: {pkg.id} · kind: {pkg.kind}
                    {pkg.installed ? " · installed" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {pkg.permissions.map((perm) => (
                    <Chip key={perm} variant="plain">
                      {perm}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {pkg.kind === "skill" ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void onInstall(pkg)}>
                      Install
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Provider packages are not installed</span>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={runBlocked}
                    title={runBlocked ? VIEWER_WRITE_REASON : undefined}
                    onClick={() => void onRun(pkg)}
                  >
                    Run
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setUninstallTarget(pkg)}>
                    Uninstall
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingsSection>
      ) : null}

      <Suspense fallback={null}>
        <SkillPermissionsDialog
          open={permDialogOpen}
          pkg={permTarget}
          onOpenChange={setPermDialogOpen}
          busy={persistSettings.isPending}
          onAccept={() => void onAcceptPermissions()}
        />
      </Suspense>

      <AlertDialog open={uninstallTarget != null} onOpenChange={(open) => !open && setUninstallTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Uninstall skill?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove {uninstallTarget?.name ?? "this package"} from this machine.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => uninstallTarget && void onUninstall(uninstallTarget)}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
