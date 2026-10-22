import { ListCollapse, Loader2, MessageSquarePlus, MoreHorizontal, PanelLeftClose } from "lucide-react";
import { useState } from "react";

import { ListRow } from "~/components/app/list-row";
import { SectionLabel } from "~/components/app/section-label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button, IconButton } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { courseDisplayName } from "~/domain/course";
import { relativeTime } from "~/domain/jobs";
import type { ChatThreadMeta } from "~/lib/queries/chat";
import {
  useChatThreads,
  useDeleteAllChatThreads,
  useDeleteChatThread,
  useRenameChatThread,
} from "~/lib/queries/chat";
import {
  chatLiveKey,
  isChatLiveInFlight,
  subscribeChatLive,
} from "~/stores/chat-live-store";
import { useUiStore } from "~/stores/ui-store";
import { cn } from "~/lib/utils";
import { useSyncExternalStore } from "react";

function ThreadInFlightDot({
  root,
  course,
  threadId,
}: {
  root: string;
  course: string;
  threadId: string;
}) {
  const key = chatLiveKey(root, course, threadId);
  const inFlight = useSyncExternalStore(subscribeChatLive, () => isChatLiveInFlight(key));
  if (!inFlight) {
    return null;
  }
  return <Loader2 className="size-icon-sm shrink-0 animate-spin text-muted-foreground" aria-hidden />;
}

export function ChatThreadsPanel({
  root,
  course,
  activeThreadId,
  onSelectThread,
  onNewChat,
  className,
}: {
  root: string;
  course: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  className?: string;
}) {
  const setChatThreadsOpen = useUiStore((s) => s.setChatThreadsOpen);
  const threadsQuery = useChatThreads(root, course);
  const renameThread = useRenameChatThread(root, course);
  const deleteThread = useDeleteChatThread(root, course);
  const deleteAll = useDeleteAllChatThreads(root, course);
  const [filter, setFilter] = useState("");
  const [renameTarget, setRenameTarget] = useState<ChatThreadMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatThreadMeta | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const allThreads = threadsQuery.data ?? [];
  const needle = filter.trim().toLowerCase();
  const threads = needle
    ? allThreads.filter((row) => row.title.toLowerCase().includes(needle))
    : allThreads;

  const saveRename = async () => {
    if (!renameTarget) {
      return;
    }
    const title = renameValue.trim();
    if (!title) {
      return;
    }
    await renameThread.mutateAsync({ thread: renameTarget.id, title });
    setRenameTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    await deleteThread.mutateAsync(deleteTarget.id);
    if (activeThreadId === deleteTarget.id) {
      onNewChat();
    }
    setDeleteTarget(null);
  };

  return (
    <nav
      aria-label="Chat threads"
      className={cn(
        "flex h-full min-h-0 w-index shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-background px-2 py-2",
        className,
      )}
    >
      <SectionLabel
        className="px-1"
        action={
          <div className="flex items-center gap-0.5">
            <IconButton
              icon={MessageSquarePlus}
              label="New chat"
              size="icon-xs"
              variant="ghost"
              onClick={onNewChat}
            />
            <IconButton
              icon={PanelLeftClose}
              label="Hide chats"
              size="icon-xs"
              variant="ghost"
              onClick={() => setChatThreadsOpen(false)}
            />
          </div>
        }
      >
        Chats
      </SectionLabel>
      <Input
        value={filter}
        placeholder="Search chats…"
        aria-label="Search chats"
        className="mx-1 h-8"
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {threadsQuery.isLoading ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {allThreads.length === 0 ? "No chats yet" : "No matching chats"}
          </p>
        ) : (
          threads.map((thread) => (
            <div key={thread.id} className="group relative flex w-full items-center">
              <ListRow
                title={thread.title}
                meta={relativeTime(thread.updated_at, nowMs)}
                twoLine
                active={activeThreadId === thread.id}
                className="w-full pr-8"
                trailing={
                  <ThreadInFlightDot root={root} course={course} threadId={thread.id} />
                }
                onSelect={() => onSelectThread(thread.id)}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      icon={MoreHorizontal}
                      label="Chat options"
                      size="icon-xs"
                      variant="ghost"
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    />
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameTarget(thread);
                      setRenameValue(thread.title);
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(thread)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mx-1 mt-2 text-destructive"
        disabled={(threadsQuery.data?.length ?? 0) === 0}
        onClick={() => setDeleteAllOpen(true)}
      >
        Delete all chats
      </Button>

      <Dialog open={renameTarget != null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogTitle>Rename chat</DialogTitle>
          <Input
            value={renameValue}
            aria-label="Chat title"
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveRename();
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveRename()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete all chats for {courseDisplayName(course)}? This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void deleteAll.mutateAsync().then(() => {
                  onNewChat();
                  setDeleteAllOpen(false);
                });
              }}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </nav>
  );
}

export function ChatThreadsPanelShowButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      icon={ListCollapse}
      label="Show chats"
      size="icon-sm"
      variant="ghost"
      className="shrink-0"
      onClick={onClick}
    />
  );
}
