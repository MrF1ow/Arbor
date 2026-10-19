import { digestKey } from "~/domain/concepts";
import type { CourseOverviewPayload, DigestInfo, StudyRecommendItem } from "~/domain/types";

export function digestSlugFromPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

export function digestNotesPath(course: string, digestSlug: string): string {
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
