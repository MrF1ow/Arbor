import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Chip } from "~/components/app/chip";
import { EmptyState } from "~/components/app/empty-state";
import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { isValidMemberEmail } from "~/domain/library-members";
import { effectiveProvider, VIEWER_WRITE_REASON, type LibraryRole } from "~/domain/library-role";
import { PROVIDER_FALLBACK } from "~/domain/provider";
import type { KnowledgeRootEntry, LibraryShowResult, Settings } from "~/domain/types";
import { useChooseKnowledgeFolder } from "~/lib/hooks/use-choose-knowledge-folder";
import { pickActiveRoot } from "~/lib/knowledge-root";
import { qk } from "~/lib/queries/keys";
import {
  useCreateSharedLibraryMutation,
  useJoinLibraryMutation,
  useLibrary,
  useLibrarySetMembersMutation,
  useLibrarySetProviderMutation,
} from "~/lib/queries/library";
import { saveSettingsSerialized, usePersistSettingsMutation, useSettings } from "~/lib/queries/settings";
import { useSwitchActiveRootMutation } from "~/lib/queries/active-root";
import { FolderOpen } from "lucide-react";

const LibraryCreateDialog = lazy(() =>
  import("~/components/settings/library-create-dialog").then((m) => ({
    default: m.LibraryCreateDialog,
  })),
);

const LibraryJoinDialog = lazy(() =>
  import("~/components/settings/library-join-dialog").then((m) => ({
    default: m.LibraryJoinDialog,
  })),
);

const MEMBER_ROLES: { value: LibraryRole; label: string }[] = [
  { value: "owner", label: "owner" },
  { value: "editor", label: "editor" },
  { value: "viewer", label: "viewer" },
];

function rootEntryName(roots: KnowledgeRootEntry[], root: string): string {
  const entry = roots.find((e) => e.path === root);
  return entry?.name ?? root.replace(/\/+$/, "").split("/").pop() ?? root;
}

export function SettingsLibraryPanel() {
  const settings = useSettings();
  const activeRoot = pickActiveRoot(settings.data);
  const library = useLibrary(activeRoot);
  const queryClient = useQueryClient();
  const persistSettings = usePersistSettingsMutation();
  const setMembers = useLibrarySetMembersMutation(activeRoot);
  const setProvider = useLibrarySetProviderMutation(activeRoot);
  const createLibrary = useCreateSharedLibraryMutation();
  const joinLibrary = useJoinLibraryMutation();
  const switchRoot = useSwitchActiveRootMutation();
  const { chooseFolder, isPending: choosingFolder } = useChooseKnowledgeFolder();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [membersDraft, setMembersDraft] = useState<{ email: string; role: LibraryRole }[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<LibraryRole>("editor");
  const [memberEmailError, setMemberEmailError] = useState("");
  const [membersNote, setMembersNote] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [providerNote, setProviderNote] = useState("");

  const show = library.data;
  const isOwner = show?.present === true && show.role === "owner";
  const canEditProvider =
    show?.present === true && (show.role === "owner" || show.role === "editor");

  const lastLibrarySnapshot = useRef<string>("");
  const providerDraftRef = useRef({ id: "", model: "" });

  useEffect(() => {
    providerDraftRef.current = { id: providerId, model: providerModel };
  }, [providerId, providerModel]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- mirror library_show into editable draft fields */
    if (show?.present !== true) {
      lastLibrarySnapshot.current = "";
      setMembersDraft([]);
      setProviderId("");
      setProviderModel("");
      return;
    }
    const nextMembers = show.members.map((m) => ({ ...m }));
    const nextProviderId = show.provider?.id ?? "";
    const nextProviderModel = show.provider?.model ?? "";
    const snapshot = JSON.stringify({
      members: nextMembers,
      providerId: nextProviderId,
      providerModel: nextProviderModel,
    });
    if (lastLibrarySnapshot.current === snapshot) {
      return;
    }
    const previous = lastLibrarySnapshot.current
      ? (JSON.parse(lastLibrarySnapshot.current) as {
          members: typeof nextMembers;
          providerId: string;
          providerModel: string;
        })
      : null;
    setMembersDraft((prev) => {
      if (!previous) {
        return nextMembers;
      }
      if (JSON.stringify(prev) === JSON.stringify(previous.members)) {
        return nextMembers;
      }
      return prev;
    });
    const providerDraft = providerDraftRef.current;
    setProviderId((prev) => {
      if (!previous) {
        return nextProviderId;
      }
      if (
        prev === previous.providerId &&
        providerDraft.model === previous.providerModel
      ) {
        return nextProviderId;
      }
      return prev;
    });
    setProviderModel((prev) => {
      if (!previous) {
        return nextProviderModel;
      }
      if (
        providerDraft.id === previous.providerId &&
        prev === previous.providerModel
      ) {
        return nextProviderModel;
      }
      return prev;
    });
    lastLibrarySnapshot.current = snapshot;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [show]);

  const invalidateLibraryStack = async (root: string) => {
    const settings = queryClient.getQueryData<Settings>(qk.settings());
    const libraryShow = queryClient.getQueryData<LibraryShowResult>(qk.library(root));
    const effective = effectiveProvider({
      root,
      settingsProviderId: settings?.provider_id?.trim() || "codex",
      settingsModelId: settings?.model_id ?? null,
      overrides: settings?.provider_overrides ?? [],
      libraryProvider:
        libraryShow?.present === true ? libraryShow.provider : null,
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.settings() }),
      queryClient.invalidateQueries({ queryKey: qk.library(root) }),
      queryClient.invalidateQueries({ queryKey: qk.courses(root) }),
      queryClient.invalidateQueries({ queryKey: qk.sync(root) }),
    ]);
    void queryClient.invalidateQueries({ queryKey: qk.models(effective.providerId, root) });
  };

  const onCreateLibrary = async (name: string) => {
    if (!activeRoot) {
      return;
    }
    const trimmed = name.trim();
    const doc = await createLibrary.mutateAsync({
      root: activeRoot,
      name: trimmed ? trimmed : null,
    });
    await persistSettings.mutateAsync((current) => ({
      ...current,
      knowledge_roots: (current.knowledge_roots ?? []).map((entry) =>
        entry.path === activeRoot
          ? { ...entry, kind: "shared", name: doc.name }
          : entry,
      ),
    }));
    await invalidateLibraryStack(activeRoot);
    toast.success("Shared library created.");
    setCreateOpen(false);
  };

  const onJoinLibrary = async (url: string, dest: string) => {
    const result = await joinLibrary.mutateAsync({ url, dest });
    const path = String((result as { path?: string }).path ?? dest);
    const name = String((result as { name?: string }).name ?? "Joined library");
    await saveSettingsSerialized(queryClient, (current) => {
      const roots = current.knowledge_roots ?? [];
      const existing = roots.find((e) => e.path === path);
      const knowledge_roots = existing
        ? roots.map((e) => (e.path === path ? { ...e, kind: "shared" as const, name } : e))
        : [...roots, { path, kind: "shared" as const, name }];
      return { ...current, knowledge_roots };
    });
    await switchRoot.mutateAsync(path);
    await invalidateLibraryStack(path);
    toast.success("Joined library.");
    setJoinOpen(false);
  };

  const onSaveMembers = async () => {
    if (!activeRoot || !isOwner) {
      return;
    }
    if (!membersDraft.some((m) => m.role === "owner")) {
      setMembersNote("At least one owner is required.");
      return;
    }
    setMembersNote("");
    try {
      await setMembers.mutateAsync(membersDraft);
      toast.success("Members saved.");
      await invalidateLibraryStack(activeRoot);
    } catch (error) {
      setMembersNote(String(error));
    }
  };

  const onAddMember = () => {
    const email = memberEmail.trim();
    if (!isValidMemberEmail(email)) {
      setMemberEmailError("Enter a valid email address.");
      return;
    }
    setMemberEmailError("");
    setMembersDraft((prev) => [...prev, { email, role: memberRole }]);
    setMemberEmail("");
  };

  const onSaveProvider = async () => {
    if (!activeRoot || !canEditProvider) {
      return;
    }
    const id = providerId.trim();
    const model = providerModel.trim();
    if (!id || !model) {
      setProviderNote("Provider id and model are required.");
      return;
    }
    setProviderNote("");
    try {
      await setProvider.mutateAsync({ id, model });
      toast.success("Library provider saved.");
      await invalidateLibraryStack(activeRoot);
    } catch (error) {
      setProviderNote(String(error));
    }
  };

  const onClearProvider = async () => {
    if (!activeRoot || !canEditProvider) {
      return;
    }
    setProviderNote("");
    try {
      await setProvider.mutateAsync({ clear: true });
      setProviderId("");
      setProviderModel("");
      toast.success("Library provider cleared.");
      await invalidateLibraryStack(activeRoot);
    } catch (error) {
      setProviderNote(String(error));
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-library">
      {!settings.data ? (
        <Skeleton className="h-48 w-full" />
      ) : !activeRoot ? (
        <EmptyState
          icon={FolderOpen}
          title="Choose a knowledge folder"
          description="Pick a folder before managing library settings."
          actions={
            <Button type="button" disabled={choosingFolder} onClick={() => void chooseFolder()}>
              Choose
            </Button>
          }
        />
      ) : library.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : show?.present !== true ? (
        <SettingsSection title="Library & sharing">
          <SettingRow
            label="Create shared library"
            description="Turn this folder into a shared library with members and a recommended provider."
            control={
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                Create shared library
              </Button>
            }
          />
          <SettingRow
            label="Join a library"
            description="Clone a remote shared library into a new folder."
            control={
              <Button type="button" variant="secondary" size="sm" onClick={() => setJoinOpen(true)}>
                Join a library
              </Button>
            }
          />
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="Library & sharing">
            <SettingRow
              label="Your role"
              control={<Chip variant="plain">{show.role}</Chip>}
            />
            {show.role === "viewer" ? (
              <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="library-role-note-settings">
                {VIEWER_WRITE_REASON}
              </p>
            ) : null}
          </SettingsSection>

          <SettingsSection title="Members">
            {membersDraft.map((member, index) => (
              <SettingRow
                key={`${member.email}-${index}`}
                label={member.email}
                control={
                  isOwner ? (
                    <Select
                      value={member.role}
                      items={MEMBER_ROLES}
                      onValueChange={(role) => {
                        setMembersDraft((prev) =>
                          prev.map((m, i) =>
                            i === index ? { ...m, role: role as LibraryRole } : m,
                          ),
                        );
                      }}
                    >
                      <SelectTrigger className="w-28" size="sm" aria-label={`Role for ${member.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEMBER_ROLES.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{member.role}</span>
                  )
                }
              />
            ))}
            {!isOwner ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Only an owner can edit library members.
              </p>
            ) : (
              <>
                <SettingRow
                  label="Add member"
                  control={
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Member email"
                        type="email"
                        value={memberEmail}
                        onChange={(e) => setMemberEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-44"
                      />
                      <Select
                        value={memberRole}
                        items={MEMBER_ROLES}
                        onValueChange={(v) => setMemberRole(v as LibraryRole)}
                      >
                        <SelectTrigger className="w-28" size="sm" aria-label="Member role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEMBER_ROLES.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="secondary" size="sm" onClick={onAddMember}>
                        Add
                      </Button>
                    </div>
                  }
                />
                {memberEmailError ? (
                  <p className="px-4 pb-2 text-sm text-destructive">{memberEmailError}</p>
                ) : null}
                <div className="px-4 py-3">
                  <Button type="button" size="sm" disabled={setMembers.isPending} onClick={() => void onSaveMembers()}>
                    Save members
                  </Button>
                </div>
              </>
            )}
            {membersNote ? <p className="px-4 pb-3 text-sm text-destructive">{membersNote}</p> : null}
          </SettingsSection>

          <SettingsSection title="Library provider">
            <SettingRow
              label="Provider"
              control={
                canEditProvider ? (
                  <Select
                    value={providerId || undefined}
                    items={PROVIDER_FALLBACK.map((p) => ({ value: p.id, label: p.label }))}
                    onValueChange={(value) => setProviderId(value ?? "")}
                  >
                    <SelectTrigger className="w-36" size="sm" aria-label="Library provider">
                      <SelectValue placeholder="Provider id" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_FALLBACK.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm text-muted-foreground">{show.provider?.id ?? "—"}</span>
                )
              }
            />
            <SettingRow
              label="Model"
              control={
                canEditProvider ? (
                  <Input
                    aria-label="Library provider model"
                    value={providerModel}
                    onChange={(e) => setProviderModel(e.target.value)}
                    placeholder="model"
                    className="w-44"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">{show.provider?.model ?? "—"}</span>
                )
              }
            />
            {canEditProvider ? (
              <div className="flex flex-wrap gap-2 px-4 py-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => void onSaveProvider()}>
                  Save provider
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => void onClearProvider()}>
                  Clear provider
                </Button>
              </div>
            ) : null}
            {providerNote ? <p className="px-4 pb-3 text-sm text-destructive">{providerNote}</p> : null}
          </SettingsSection>
        </>
      )}

      <Suspense fallback={null}>
        {createOpen ? (
          <LibraryCreateDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            defaultName={activeRoot ? rootEntryName(settings.data?.knowledge_roots ?? [], activeRoot) : ""}
            busy={createLibrary.isPending}
            onConfirm={onCreateLibrary}
          />
        ) : null}
        {joinOpen ? (
          <LibraryJoinDialog
            open={joinOpen}
            onOpenChange={setJoinOpen}
            busy={joinLibrary.isPending}
            onConfirm={onJoinLibrary}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
