import { digestKey } from "~/domain/concepts";
import type {
  CardSource,
  CourseOverviewPayload,
  DigestInfo,
  StudyRecommendItem,
} from "~/domain/types";

export function digestSlugFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

/** Resolve a worker digest ref (`digests/foo.md` or stem) to the route slug. */
export function resolveDigestSlug(digestRef: string, digests: DigestInfo[]): string {
  const key = digestKey(digestRef);
  const match = digests.find((d) => digestKey(d.path) === key);
  if (match) {
    return digestSlugFromPath(match.path);
  }
  return digestSlugFromPath(digestRef);
}

/** Chip label for a flashcard source: digest title when known, else stem. */
export function formatFlashcardSourceLabel(source: CardSource, digests: DigestInfo[]): string {
  const key = digestKey(source.digest);
  const match = digests.find(
    (d) => digestKey(d.path) === key || digestSlugFromPath(d.path) === source.digest,
  );
  const digestLabel = match?.title ?? digestSlugFromPath(source.digest);
  const parts = [digestLabel];
  if (source.heading) {
    parts.push(source.heading);
  }
  if (source.page) {
    parts.push(`p. ${source.page}`);
  }
  return parts.join(" · ");
}

export function digestNotesPath(
  course: string,
  digestSlug: string,
  digests?: DigestInfo[],
): string {
  const match = digests?.find((d) => digestSlugFromPath(d.path) === digestSlug);
  if (match) {
    return match.path;
  }
  return `${course}/digests/${digestSlug}.md`;
}

export function firstParagraph(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const paragraph: string[] = [];
  let inParagraph = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("<!--")) {
      if (inParagraph && paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (/^#+\s/.test(line)) {
      if (inParagraph) {
        break;
      }
      continue;
    }
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line) || /^\|/.test(line)) {
      if (inParagraph) {
        break;
      }
      continue;
    }
    inParagraph = true;
    paragraph.push(line);
  }
  if (paragraph.length === 0) {
    return null;
  }
  return paragraph.join(" ").replace(/\s+/g, " ").trim() || null;
}

export type QuizAccuracy = { percent: number; answerCount: number } | null;

export function quizAccuracy(progress: unknown): QuizAccuracy {
  if (typeof progress !== "object" || progress === null || Array.isArray(progress)) {
    return null;
  }
  let correct = 0;
  let wrong = 0;
  for (const entry of Object.values(progress)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const c = Number((entry as { correct?: unknown }).correct);
    const w = Number((entry as { wrong?: unknown }).wrong);
    if (Number.isFinite(c) && c >= 0) {
      correct += c;
    }
    if (Number.isFinite(w) && w >= 0) {
      wrong += w;
    }
  }
  const total = correct + wrong;
  if (total === 0) {
    return null;
  }
  return {
    percent: Math.round((correct / total) * 100),
    answerCount: total,
  };
}

const EXAM_DATE_LINE = /Exam date:\s*(?:\*\*)?(\d{4}-\d{2}-\d{2})(?:\*\*)?/im;
const EXAM_DATE_LINE_FULL = /^\s*Exam date:\s*(?:\*\*)?\d{4}-\d{2}-\d{2}(?:\*\*)?\s*$/im;
const LEADING_H1_LINE = /^#\s+(?!#)/;

function normalizeNewlines(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n");
}

/** Remove a single leading ATX h1 (`# Title`), preserving the rest of the document. */
export function stripLeadingH1(markdown: string): string {
  const lines = normalizeNewlines(markdown).split("\n");
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  if (index < lines.length && LEADING_H1_LINE.test(lines[index].trim())) {
    lines.splice(index, 1);
    while (index < lines.length && lines[index].trim() === "") {
      lines.splice(index, 1);
    }
  }
  return lines.join("\n");
}

function removeFirstParagraph(markdown: string): string {
  const lines = normalizeNewlines(markdown).split("\n");
  const kept: string[] = [];
  let index = 0;
  let removedParagraph = false;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("<!--")) {
      if (!removedParagraph) {
        index += 1;
        continue;
      }
      kept.push(line);
      index += 1;
      continue;
    }
    if (/^#+\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || /^\|/.test(trimmed)) {
      kept.push(...lines.slice(index));
      break;
    }
    if (!removedParagraph) {
      removedParagraph = true;
      index += 1;
      while (index < lines.length && lines[index].trim() !== "") {
        index += 1;
      }
      while (index < lines.length && lines[index].trim() === "") {
        index += 1;
      }
      continue;
    }
    kept.push(...lines.slice(index));
    break;
  }

  return kept.join("\n");
}

/** Study plan body for the course overview (section title and exam input are rendered separately). */
export function studyPlanMarkdownForOverview(markdown: string): string {
  let body = stripLeadingH1(markdown);
  body = body.replace(EXAM_DATE_LINE_FULL, "");
  return body.replace(/^\n+/, "").trimEnd();
}

/** Course notes body for the overview when the lede already shows the opening paragraph. */
export function courseMarkdownForOverview(markdown: string, lede: string | null): string {
  if (!lede) {
    return markdown;
  }
  const withoutTitle = stripLeadingH1(markdown);
  const opening = firstParagraph(withoutTitle);
  if (opening !== lede) {
    return withoutTitle;
  }
  return removeFirstParagraph(withoutTitle);
}

export function examDateFromPlan(markdown: string): string | null {
  const match = markdown.match(EXAM_DATE_LINE);
  return match?.[1] ?? null;
}

export function daysUntil(dateIso: string, now: Date): number | null {
  const parts = dateIso.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffMs = targetDay.getTime() - today.getTime();
  return Math.round(diffMs / 86_400_000);
}

export type DigestFlag = "weak" | "new";

export function digestFlags(
  overview: CourseOverviewPayload,
  digests: DigestInfo[],
): Map<string, DigestFlag> {
  const flags = new Map<string, DigestFlag>();
  for (const topic of overview.weak.topics) {
    if (!topic.digest) {
      continue;
    }
    const key = digestKey(topic.digest);
    for (const digest of digests) {
      if (digestKey(digest.path) === key || digestSlugFromPath(digest.path) === topic.digest) {
        flags.set(digest.path, "weak");
      }
    }
  }
  for (const item of overview.recommend.items) {
    if (item.kind !== "unreviewed_digest" || !item.digest) {
      continue;
    }
    const key = digestKey(item.digest);
    for (const digest of digests) {
      if (digestKey(digest.path) === key || digestSlugFromPath(digest.path) === item.digest) {
        if (!flags.has(digest.path)) {
          flags.set(digest.path, "new");
        }
      }
    }
  }
  return flags;
}

export function examFocusCallout(input: {
  weakLabel: string | null;
  unreviewedTitle: string | null;
}): string | null {
  const { weakLabel, unreviewedTitle } = input;
  if (!weakLabel && !unreviewedTitle) {
    return null;
  }
  if (weakLabel && unreviewedTitle) {
    return `Exam focus: ${weakLabel} is your weakest topic and ${unreviewedTitle} hasn't been reviewed yet.`;
  }
  if (weakLabel) {
    return `Exam focus: ${weakLabel} is your weakest topic.`;
  }
  return `Exam focus: ${unreviewedTitle} hasn't been reviewed yet.`;
}

export function collapseSelectionText(text: string, maxLen: number): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length <= maxLen ? collapsed : collapsed.slice(0, maxLen);
}

export function headingForSelectionNode(node: Node | null, articleRoot: HTMLElement): string | null {
  if (!node) {
    return null;
  }
  let current: Node | null = node;
  while (current && current !== articleRoot) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName;
      if (tag === "H1" || tag === "H2" || tag === "H3") {
        const text = current.textContent?.trim() ?? "";
        return text || null;
      }
    }
    current = current.parentNode;
  }
  let nearest: string | null = null;
  for (const heading of articleRoot.querySelectorAll("h1, h2, h3")) {
    if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const text = heading.textContent?.trim() ?? "";
      if (text) {
        nearest = text;
      }
    }
  }
  return nearest;
}

export function pageForSelectionNode(node: Node | null, articleRoot: HTMLElement): string | null {
  let current: Node | null = node;
  while (current && current !== articleRoot) {
    if (current instanceof HTMLElement && current.dataset.arborPage) {
      return current.dataset.arborPage;
    }
    current = current.parentNode;
  }
  return null;
}

export function weakestRecommendTopic(
  items: StudyRecommendItem[],
): StudyRecommendItem | null {
  return items.find((item) => item.kind === "weakest_topic") ?? null;
}

export function unreviewedDigestRecommend(
  items: StudyRecommendItem[],
  digests: DigestInfo[],
): DigestInfo | null {
  const item = items.find((i) => i.kind === "unreviewed_digest" && i.digest);
  if (!item?.digest) {
    return null;
  }
  const key = digestKey(item.digest);
  return (
    digests.find(
      (d) => digestKey(d.path) === key || digestSlugFromPath(d.path) === item.digest,
    ) ?? null
  );
}
