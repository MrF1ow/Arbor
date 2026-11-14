const BLOCK_START = /^<(p|ul|ol|table|h[1-6]|blockquote|pre)\b[^>]*>/;
const PAGE_ATTR = /\bdata-arbor-page="([^"]+)"/;

/** "slide 6", "slides 12–18"; PDFs and Word files are paged, slide decks are slides. */
export function citationLabel(range: string, sourcePath: string | null | undefined): string {
  const slides = /\.pptx?$/i.test(sourcePath ?? "");
  const noun = slides ? "slide" : "page";
  const shown = range.replace(/-/g, "–");
  return `${noun}${range.includes("-") ? "s" : ""} ${shown}`;
}

function chip(label: string): string {
  return (
    `<div><span data-arbor-cite class="inline-flex items-center rounded-xs border border-info px-1 font-sans text-micro text-info">` +
    `${label}</span></div>`
  );
}

/**
 * Put a citation chip ("slide 6") after each run of blocks that came from the same slides or
 * pages, as the design's reading view shows. The renderer marks each block with
 * `data-arbor-page`; a run ends where the range changes or the markers stop.
 */
export function withCitationChips(html: string, sourcePath: string | null | undefined): string {
  const out: string[] = [];
  let current: string | null = null;
  for (const line of html.split("\n")) {
    const block = BLOCK_START.exec(line);
    if (block) {
      const range = PAGE_ATTR.exec(block[0])?.[1] ?? null;
      if (current !== null && range !== current) {
        out.push(chip(citationLabel(current, sourcePath)));
      }
      current = range;
    }
    out.push(line);
  }
  if (current !== null) {
    out.push(chip(citationLabel(current, sourcePath)));
  }
  return out.join("\n");
}

/**
 * Drop the digest's own leading `<h1>`: the reading view prints the lecture title itself. This
 * goes by structure, not by comparing text, because the list's title is the raw markdown line
 * while the rendered heading is escaped and has its inline markup applied.
 */
export function stripLeadingH1(html: string): string {
  return html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, "");
}

/**
 * Every page range the rendered digest cites, in order ("3-4, 7-9"): the `data-arbor-page` of each
 * block, so a digest built in windows counts all its marker blocks. Null when no block has one.
 */
export function citedRanges(html: string): string | null {
  const ranges: string[] = [];
  for (const match of html.matchAll(/\bdata-arbor-page="([^"]+)"/g)) {
    if (!ranges.includes(match[1])) {
      ranges.push(match[1]);
    }
  }
  return ranges.length > 0 ? ranges.join(", ") : null;
}

/**
 * How many pages or slides a range like "12-18, 22-24" covers (10); null when it is not one. A
 * page that two ranges name counts once.
 */
export function pageCount(range: string): number | null {
  const pages = new Set<number>();
  for (const part of range.split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) {
      return null;
    }
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) {
      return null;
    }
    for (let page = from; page <= to; page += 1) {
      pages.add(page);
    }
  }
  return pages.size > 0 ? pages.size : null;
}

/**
 * "lecture-07.pdf · cites 10 pages": the source file and how many of its pages or slides the
 * digest cites. The count is the cited ranges, not the file's length, so it says "cites".
 */
export function sourceSummary(name: string | null, range: string | null, sourcePath: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const count = range ? pageCount(range) : null;
  if (count === null) {
    return name;
  }
  const noun = /\.pptx?$/i.test(sourcePath ?? "") ? "slide" : "page";
  return `${name} · cites ${count} ${noun}${count === 1 ? "" : "s"}`;
}
