import { renderMarkdown } from "./markdown.ts";

function digestKey(path: string): string {
  const index = path.indexOf("digests/");
  if (index >= 0) {
    return path.slice(index);
  }
  if (
    !path.includes("/") &&
    !path.includes("\\") &&
    path !== "." &&
    path !== ".."
  ) {
    return `digests/${path}`;
  }
  return path;
}

export type ChatMode = "ask" | "explain" | "quiz";

export interface ChatLine {
  ts?: string;
  role: string;
  mode?: string;
  content?: string;
  supported?: boolean;
  citations?: ChatCitation[];
}

export interface ChatCitation {
  digest_path?: string;
  heading_id?: string;
  page_range?: string;
}

export function visibleTranscript(lines: ChatLine[]): ChatLine[] {
  let lastSession = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.role === "session") lastSession = index;
  }
  if (lastSession < 0) return lines.slice();
  return lines.slice(lastSession + 1);
}

export function workerHistory(lines: ChatLine[]): Array<{ role: string; content: string }> {
  return visibleTranscript(lines)
    .filter((line) => line.role === "user" || line.role === "assistant")
    .map((line) => ({
      role: line.role,
      content: line.content ?? "",
    }));
}

export function chatNotePath(course: string, digestPath: string): string {
  const norm = digestPath.replace(/\\/g, "/");
  if (norm === `${course}/course.md` || norm.endsWith("/course.md")) {
    return `${course}/course.md`;
  }
  return `${course}/${digestKey(digestPath)}`;
}

export function citationLabel(citation: ChatCitation): string {
  const path = citation.digest_path ?? "";
  const base = path.split("/").pop() ?? path;
  const parts: string[] = [base];
  if (citation.heading_id) parts.push(citation.heading_id);
  if (citation.page_range && citation.page_range.trim()) {
    parts.push(`p. ${citation.page_range}`);
  }
  return parts.join(" · ");
}

export function renderAnswerHtml(markdown: string): string {
  const scrubbed = markdown
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bonerror\b/gi, "");
  return renderMarkdown(scrubbed).html;
}

export function phaseLabel(eventType: string): string | null {
  if (eventType === "chat_retrieved") return "Answering";
  if (eventType === "chat_done") return "Done";
  return null;
}

export function unsupportedBanner(supported: boolean | undefined): string | null {
  if (supported === false) return "Not supported by this course";
  return null;
}

export function buildUserLine(mode: ChatMode, content: string): ChatLine {
  return {
    ts: new Date().toISOString(),
    role: "user",
    mode,
    content,
  };
}

export function buildAssistantLine(
  mode: ChatMode,
  content: string,
  supported: boolean,
  citations: ChatCitation[],
): ChatLine {
  return {
    ts: new Date().toISOString(),
    role: "assistant",
    mode,
    content,
    supported,
    citations,
  };
}

export function buildSessionLine(): ChatLine {
  return {
    ts: new Date().toISOString(),
    role: "session",
    content: "",
  };
}
