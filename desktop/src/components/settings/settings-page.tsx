import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** One settings page: the serif page heading and its one-line description, then the groups. */
export function SettingsPage({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid={testId}>
      <header className="flex flex-col gap-3">
        <h1 className="text-reading-title text-foreground">{title}</h1>
        <p className="text-small text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  );
}

/** A group label over a card of rows, as the design's Settings frames draw it. */
export function SettingsGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h2 className="text-label text-muted-foreground">
        {title}
      </h2>
      <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-card">
        {children}
      </div>
    </section>
  );
}
