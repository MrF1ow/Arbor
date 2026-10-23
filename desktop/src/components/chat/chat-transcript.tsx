import { Info } from "lucide-react";

import { EmptyState } from "~/components/app/empty-state";
import { ChatCitationChip } from "~/components/chat/chat-citation-chip";
import type { ChatLine } from "~/domain/chat";
import { courseDisplayName } from "~/domain/course";
import { renderAnswerHtml, unsupportedBanner, visibleTranscript } from "~/domain/chat";
import type { DigestInfo } from "~/domain/types";

export function ChatTranscript({
  course,
  lines,
  digests,
}: {
  course: string;
  lines: ChatLine[];
  digests: DigestInfo[];
}) {
  const transcript = visibleTranscript(lines);

  if (transcript.length === 0) {
    return (
      <EmptyState
        title={`Ask about ${courseDisplayName(course)}`}
        description="Answers cite digests in this course. Use Explain mode for step-by-step replies."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      {transcript.map((line, index) => {
        const key = `${line.ts ?? "line"}-${line.role}-${index}`;
        if (line.role === "user") {
          return (
            <div key={key} className="flex justify-end">
              <div className="max-w-reading rounded-sm bg-muted px-3 py-2 text-sm text-foreground">
                {line.content}
              </div>
            </div>
          );
        }
        if (line.role === "assistant") {
          const banner = unsupportedBanner(line.supported);
          return (
            <div key={key} className="flex w-full flex-col gap-2">
              <div
                data-testid="chat-assistant-prose"
                className="prose-arbor mx-0 w-full max-w-none text-sm"
                dangerouslySetInnerHTML={{ __html: renderAnswerHtml(line.content ?? "") }}
              />
              {banner ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-icon-sm shrink-0" aria-hidden />
                  <span>{banner}</span>
                </div>
              ) : null}
              {line.citations && line.citations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
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
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
