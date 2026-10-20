import { digestKey, notePathForStudyDigest } from "./concepts.ts";
import { renderMarkdown } from "./markdown.ts";
import { signedOutJobMessage } from "./provider.ts";
import type { DigestInfo } from "./types.ts";

function digestSlugFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

export type ChatMode = "ask" | "explain" | "quiz";

const CHAT_MODES: ChatMode[] = ["ask", "explain", "quiz"];

export function isChatMode(value: string | undefined): value is ChatMode {
  return value != null && CHAT_MODES.includes(value as ChatMode);
}

export function chatAuthErrorMessage(providerLabel: string, error: unknown): string {
  const text = String(error);
  if (text.includes("authenticated") || text.includes("auth")) {
    return signedOutJobMessage(providerLabel, text);
  }
  return text;
}

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
  return notePathForStudyDigest(course, digestPath);
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

function isCourseOverviewCitation(digestPath: string, course: string): boolean {
  const norm = digestPath.replace(/\\/g, "/");
  return norm === `${course}/course.md` || norm.endsWith("/course.md");
}

export function formatChatCitationLabel(
  citation: ChatCitation,
  course: string,
  digests: DigestInfo[],
): string {
  const digestPath = citation.digest_path ?? "";
  if (isCourseOverviewCitation(digestPath, course)) {
    const parts = ["Course overview"];
    if (citation.heading_id) {
      parts.push(citation.heading_id);
    }
    if (citation.page_range?.trim()) {
      parts.push(`p. ${citation.page_range}`);
    }
    return parts.join(" · ");
  }
  const key = digestKey(digestPath);
  const match = digests.find(
    (d) => digestKey(d.path) === key || digestSlugFromPath(d.path) === digestPath,
  );
  if (!match) {
    return citationLabel(citation);
  }
  const parts = [match.title ?? digestSlugFromPath(digestPath)];
  if (citation.heading_id) {
    parts.push(citation.heading_id);
  }
  if (citation.page_range?.trim()) {
    parts.push(`p. ${citation.page_range}`);
  }
  return parts.join(" · ");
}

export function renderAnswerHtml(markdown: string): string {
  return renderMarkdown(markdown).html;
}

export function phaseLabel(eventType: string): string | null {
  if (eventType === "chat_retrieved") return "Answering";
  if (eventType === "chat_done") return "Done";
  return null;
}

export function unsupportedBanner(supported: boolean | undefined): string | null {
  if (supported === true) return null;
  return "Not supported by this course";
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
