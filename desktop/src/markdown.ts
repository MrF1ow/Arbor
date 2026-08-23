function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
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
  let listItems: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(`<p>${inlineFormat(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems || listItems.length === 0) return;
    parts.push(`<ul>${listItems.map((li) => `<li>${inlineFormat(li)}</li>`).join("")}</ul>`);
    listItems = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      parts.push(`<h1>${inlineFormat(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      parts.push(`<h2>${inlineFormat(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      parts.push(`<h3>${inlineFormat(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushParagraph();
      if (!listItems) listItems = [];
      listItems.push(trimmed.slice(2));
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return { html: parts.join("\n"), pageChip };
}
