import { Info } from "lucide-react";

import markDark from "~/assets/arbor-mark-dark.png";
import markLight from "~/assets/arbor-mark.png";
import { EmptyState } from "~/components/app/empty-state";
import { ChatCitationChip } from "~/components/chat/chat-citation-chip";
import { Button } from "~/components/ui/button";
import type { ChatLine } from "~/domain/chat";
import { courseDisplayName } from "~/domain/course";
import { renderAnswerHtml, unsupportedBanner } from "~/domain/chat";
import type { DigestInfo } from "~/domain/types";

export type AnswerStudyKind = "flashcards" | "quiz";

/** What the actions under an answer do; without it a transcript is read-only (and has no Copy). */
export type AnswerActions = {
  /** False while a job cannot start, or when the answer has no lecture to anchor cards to. */
  canStudy: (line: ChatLine) => boolean;
  onStudy: (kind: AnswerStudyKind, line: ChatLine) => void;
  onCopy: (line: ChatLine) => void;
};

/** The "Arbor" label above an answer: the mark, the name and the mode it was answered in. */
export function AnswerByline({ mode, status }: { mode?: string; status?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-caption text-muted-foreground">
      <img src={markLight} alt="" className="size-4 shrink-0 dark:hidden" />
      <img src={markDark} alt="" className="hidden size-4 shrink-0 dark:block" />
      <span className="text-small font-semibold text-foreground">Arbor</span>
      {mode ? <span>{mode === "explain" ? "Explain" : "Ask"}</span> : null}
      {status}
    </div>
  );
}

export function ChatTranscript({
  course,
  lines,
  digests,
  actions,
}: {
  course: string;
  lines: ChatLine[];
  digests: DigestInfo[];
  actions?: AnswerActions;
}) {
  if (lines.length === 0) {
    return (
      <EmptyState
        title={`Ask about ${courseDisplayName(course)}`}
        description="Answers cite digests in this course. Use Explain mode for step-by-step replies."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      {lines.map((line, index) => {
        const key = `${line.ts ?? "line"}-${line.role}-${index}`;
        if (line.role === "user") {
          return (
            <div key={key} className="flex justify-end">
              <div className="max-w-reading rounded-lg bg-muted px-4 py-3 text-body text-foreground">
                {line.content}
              </div>
            </div>
          );
        }
        if (line.role === "assistant") {
          const banner = unsupportedBanner(line.supported);
          return (
            <div key={key} className="flex w-full flex-col gap-2.5">
              <AnswerByline mode={line.mode} />
              <div
                data-testid="chat-assistant-prose"
                className="prose-arbor mx-0 w-full max-w-none"
                dangerouslySetInnerHTML={{ __html: renderAnswerHtml(line.content ?? "") }}
              />
              {banner ? (
                <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  <Info className="size-icon-sm shrink-0" aria-hidden />
                  <span>{banner}</span>
                </div>
              ) : null}
              {line.citations && line.citations.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-label text-faint-foreground">Sources</span>
                  {line.citations.map((citation, citeIndex) => (
                    <ChatCitationChip
                      key={`${citation.digest_path ?? citeIndex}-${citeIndex}`}
                      course={course}
                      citation={citation}
                      digests={digests}
                    />
                  ))}
                </div>
              ) : null}
              {actions ? <AnswerActionRow line={line} actions={actions} /> : null}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function AnswerActionRow({ line, actions }: { line: ChatLine; actions: AnswerActions }) {
  const canStudy = actions.canStudy(line);
  const why = canStudy ? undefined : "Needs a lecture: cite one, or tick lectures first.";
  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!canStudy}
        title={why}
        onClick={() => actions.onStudy("flashcards", line)}
      >
        Make cards from this
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={!canStudy}
        title={why}
        onClick={() => actions.onStudy("quiz", line)}
      >
        Quiz me on this
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => actions.onCopy(line)}>
        Copy
      </Button>
    </div>
  );
}
