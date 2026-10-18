export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(raw: string): { href: string; digest: string | null } | null {
  const href = raw.trim();
  if (/^(javascript|data|vbscript):/i.test(href)) return null;
  if (href.includes("..")) return null;
  const digestMatch = href.match(/^(?:\.\/)?(digests\/[^/#\s]+\.md)(?:#(.+))?$/i);
  if (digestMatch) {
    return { href: digestMatch[1], digest: digestMatch[1] };
  }
  if (/^https?:\/\//i.test(href) || href.startsWith("#")) {
    return { href, digest: null };
  }
  return null;
}

export function arborDigestTarget(href: string): string | null {
  return safeHref(href)?.digest ?? null;
}

function inlineFormat(text: string): string {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_full, label: string, url: string) => {
    const safe = safeHref(url);
    if (!safe) return label;
    const digestAttr = safe.digest === null ? "" : ` data-arbor-digest="${safe.digest}"`;
    return `<a href="${safe.href}"${digestAttr}>${label}</a>`;
  });
  const withCode = withLinks.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withBold.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

export function extractDigestTitle(source: string): string | null {
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim() || null;
    return null;
  }
  return null;
}

type ListKind = "ul" | "ol";

interface ListItemMatch {
  kind: ListKind;
  indent: number;
  content: string;
}

function matchListItem(line: string): ListItemMatch | null {
  const indentMatch = line.match(/^(\s*)(.*)$/);
  if (!indentMatch) return null;
  const indent = indentMatch[1].replace(/\t/g, "  ").length;
  const rest = indentMatch[2];
  const unordered = rest.match(/^[-*] (.+)$/);
  if (unordered) {
    return { kind: "ul", indent, content: unordered[1] };
  }
  const ordered = rest.match(/^\d+\. (.+)$/);
  if (ordered) {
    return { kind: "ol", indent, content: ordered[1] };
  }
  return null;
}

interface OpenList {
  kind: ListKind;
  indent: number;
  items: string[];
}

function renderItems(items: string[], pageAttr: () => string): string {
  return items.map((item) => `<li${pageAttr()}>${item}</li>`).join("");
}

function closeListsThrough(
  stack: OpenList[],
  indent: number,
  parts: string[],
  pageAttr: () => string,
): void {
  while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
    const closed = stack.pop();
    if (!closed) break;
    const html = `<${closed.kind}${pageAttr()}>${renderItems(closed.items, pageAttr)}</${closed.kind}>`;
    if (stack.length === 0) {
      parts.push(html);
    } else {
      const parent = stack[stack.length - 1];
      const last = parent.items.length - 1;
      parent.items[last] = `${parent.items[last]}${html}`;
    }
  }
}

function closeAllLists(stack: OpenList[], parts: string[], pageAttr: () => string): void {
  closeListsThrough(stack, -1, parts, pageAttr);
}

function appendListItem(
  stack: OpenList[],
  item: ListItemMatch,
  parts: string[],
  pageAttr: () => string,
): void {
  closeListsThrough(stack, item.indent, parts, pageAttr);
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (!top || top.indent < item.indent) {
    stack.push({ kind: item.kind, indent: item.indent, items: [inlineFormat(item.content)] });
    return;
  }
  if (top.kind !== item.kind) {
    closeListsThrough(stack, item.indent - 1, parts, pageAttr);
    stack.push({ kind: item.kind, indent: item.indent, items: [inlineFormat(item.content)] });
    return;
  }
  top.items.push(inlineFormat(item.content));
}

interface MarkdownTable {
  header: string[];
  rows: string[][];
}

function isPipeRow(line: string): boolean {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function renderTable(table: MarkdownTable, pageAttr: () => string): string {
  const header = table.header.map((cell) => `<th>${inlineFormat(cell)}</th>`).join("");
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineFormat(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table${pageAttr()}><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function isArborPagesOpen(line: string): string | null {
  const match = line.match(/^<!--\s*arbor-pages:([^>]+)\s*-->$/);
  return match ? match[1].trim() : null;
}

function isArborPagesClose(line: string): boolean {
  return /^<!--\s*\/arbor-pages:[^>]+\s*-->$/i.test(line);
}

export function renderMarkdown(source: string): {
  html: string;
  pageChip: string | null;
  pageChipRange: string | null;
} {
  let pageChip: string | null = null;
  let pageChipRange: string | null = null;
  const pageMatch = source.match(/<!--\s*arbor-pages:([^>]+)\s*-->/);
  if (pageMatch) {
    pageChipRange = pageMatch[1].trim();
    pageChip = pageChipRange.replace(/-/g, "–");
  }

  let currentPageRange: string | null = null;
  const pageAttr = () =>
    currentPageRange ? ` data-arbor-page="${escapeHtml(currentPageRange)}"` : "";

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let paragraph: string[] = [];
  const lists: OpenList[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p${pageAttr()}>${inlineFormat(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();
    const listItem = matchListItem(line);
    const nextLine = i + 1 < lines.length ? lines[i + 1].replace(/\s+$/, "") : "";

    const pagesOpen = isArborPagesOpen(trimmed);
    if (pagesOpen !== null) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      currentPageRange = pagesOpen;
      continue;
    }
    if (isArborPagesClose(trimmed)) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      currentPageRange = null;
      continue;
    }

    if (trimmed === "") {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      continue;
    }

    if (isPipeRow(line) && isTableSeparator(nextLine)) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      const header = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const bodyLine = lines[i].replace(/\s+$/, "");
        if (!isPipeRow(bodyLine)) break;
        rows.push(splitCells(bodyLine));
        i += 1;
      }
      i -= 1;
      parts.push(renderTable({ header, rows }, pageAttr));
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      parts.push(`<h1${pageAttr()}>${inlineFormat(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      const heading = trimmed.slice(3);
      parts.push(`<h2${pageAttr()} id="${headingId(heading)}">${inlineFormat(heading)}</h2>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      closeAllLists(lists, parts, pageAttr);
      const heading = trimmed.slice(4);
      parts.push(`<h3${pageAttr()} id="${headingId(heading)}">${inlineFormat(heading)}</h3>`);
      continue;
    }
    if (listItem) {
      flushParagraph();
      appendListItem(lists, listItem, parts, pageAttr);
      continue;
    }

    closeAllLists(lists, parts, pageAttr);
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeAllLists(lists, parts, pageAttr);

  return { html: parts.join("\n"), pageChip, pageChipRange };
}
