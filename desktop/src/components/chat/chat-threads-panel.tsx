import { ListCollapse, Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { groupThreadsByDay, threadMeta } from "~/components/chat/thread-groups";
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

function ThreadRow({
  root,
  course,
  thread,
  meta,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  root: string;
  course: string;
  thread: ChatThreadMeta;
  meta: string;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex w-full items-start rounded-lg transition-colors duration-fast ease-out-soft",
        active ? "bg-selected" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className={cn("text-small text-foreground", active && "font-semibold")}>{thread.title}</span>
        <span className="flex items-center gap-1.5 text-micro text-faint-foreground">
          {meta}
          <ThreadInFlightDot root={root} course={course} threadId={thread.id} />
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              icon={MoreHorizontal}
              label="Chat options"
              size="icon-xs"
              variant="ghost"
              className="absolute right-1.5 top-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            />
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
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
  const [now] = useState(() => new Date());

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
        "flex h-full min-h-0 w-65 shrink-0 flex-col gap-2 border-r border-border bg-background px-2.5 pb-3 pt-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1.5">
        <span className="text-heading text-foreground">Chats</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="xs" aria-label="New chat" onClick={onNewChat}>
            + New
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Hide chats"
            onClick={() => setChatThreadsOpen(false)}
          >
            Hide
          </Button>
        </div>
      </div>
      <Input
        value={filter}
        placeholder="Search chats…"
        aria-label="Search chats"
        className="h-7.5 bg-card"
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {threadsQuery.isLoading ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">
            {allThreads.length === 0 ? "No chats yet" : "No matching chats"}
          </p>
        ) : (
          groupThreadsByDay(threads, now).map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
              <h2 className="px-2.5 pb-1 pt-3 text-caption text-faint-foreground">{group.label}</h2>
              {group.threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  root={root}
                  course={course}
                  thread={thread}
                  meta={threadMeta(thread, now)}
                  active={activeThreadId === thread.id}
                  onSelect={() => onSelectThread(thread.id)}
                  onRename={() => {
                    setRenameTarget(thread);
                    setRenameValue(thread.title);
                  }}
                  onDelete={() => setDeleteTarget(thread)}
                />
              ))}
            </section>
          ))
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start px-2.5 font-normal"
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
