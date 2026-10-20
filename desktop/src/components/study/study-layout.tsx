import type { ReactNode } from "react";

export function StudyViewShell({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="notes-reading-pane flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8"
    >
      {children}
    </div>
  );
}

export function StudyColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "mx-auto flex w-full max-w-flashcards flex-col items-center gap-3.5"
      }
    >
      {children}
    </div>
  );
}
