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

function inlineFormat(text: string): string {
  const escaped = escapeHtml(text);
  const withCode = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
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

function renderItems(items: string[]): string {
  return items.map((item) => `<li>${item}</li>`).join("");
}

function closeListsThrough(stack: OpenList[], indent: number, parts: string[]): void {
  while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
    const closed = stack.pop();
    if (!closed) break;
    const html = `<${closed.kind}>${renderItems(closed.items)}</${closed.kind}>`;
    if (stack.length === 0) {
      parts.push(html);
    } else {
      const parent = stack[stack.length - 1];
      const last = parent.items.length - 1;
      parent.items[last] = `${parent.items[last]}${html}`;
    }
  }
}

function closeAllLists(stack: OpenList[], parts: string[]): void {
  closeListsThrough(stack, -1, parts);
}

function appendListItem(stack: OpenList[], item: ListItemMatch, parts: string[]): void {
  closeListsThrough(stack, item.indent, parts);
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (!top || top.indent < item.indent) {
    stack.push({ kind: item.kind, indent: item.indent, items: [inlineFormat(item.content)] });
    return;
  }
  if (top.kind !== item.kind) {
    closeListsThrough(stack, item.indent - 1, parts);
    stack.push({ kind: item.kind, indent: item.indent, items: [inlineFormat(item.content)] });
    return;
  }
  top.items.push(inlineFormat(item.content));
}

export function renderMarkdown(source: string): { html: string; pageChip: string | null } {
  let pageChip: string | null = null;
  const pageMatch = source.match(/<!--\s*arbor-pages:([^>]+)\s*-->/);
  if (pageMatch) {
    pageChip = pageMatch[1].replace(/-/g, "–");
    source = source.replace(/<!--\s*arbor-pages:[^>]+-->\s*/g, "");
  }

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let paragraph: string[] = [];
  const lists: OpenList[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${inlineFormat(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    const listItem = matchListItem(line);

    if (trimmed === "") {
      flushParagraph();
      closeAllLists(lists, parts);
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      closeAllLists(lists, parts);
      parts.push(`<h1>${inlineFormat(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      closeAllLists(lists, parts);
      const heading = trimmed.slice(3);
      parts.push(`<h2 id="${headingId(heading)}">${inlineFormat(heading)}</h2>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      closeAllLists(lists, parts);
      const heading = trimmed.slice(4);
      parts.push(`<h3 id="${headingId(heading)}">${inlineFormat(heading)}</h3>`);
      continue;
    }
    if (listItem) {
      flushParagraph();
      appendListItem(lists, listItem, parts);
      continue;
    }

    closeAllLists(lists, parts);
    paragraph.push(trimmed);
  }

  flushParagraph();
  closeAllLists(lists, parts);

  return { html: parts.join("\n"), pageChip };
}
